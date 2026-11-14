import { mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';

export const ACK_TIMEOUT_MS = readIntegerEnv(
  'ACK_TIMEOUT_MS',
  10_000,
  100,
  60_000,
);
export const CONNECT_TIMEOUT_MS = readIntegerEnv(
  'CONNECT_TIMEOUT_MS',
  10_000,
  100,
  60_000,
);
export const DELIVERY_TIMEOUT_MS = readIntegerEnv(
  'DELIVERY_TIMEOUT_MS',
  10_000,
  100,
  60_000,
);
export const WARMUP_OPERATIONS = readIntegerEnv('WARMUP_OPERATIONS', 0, 0, 5);

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const resultsDirectory = path.join(scriptDirectory, 'results');
const lockPath = path.join(scriptDirectory, '.benchmark.lock');

export function readIntegerEnv(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

export function getTargetUrl() {
  const target = process.env.API_BASE_URL ?? 'http://localhost:3000';
  let url;
  try {
    url = new URL(target);
  } catch {
    throw new Error('API_BASE_URL must be a valid local HTTP(S) URL.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  ) {
    throw new Error(
      'API_BASE_URL must point to a local host (localhost, 127.0.0.1, or ::1).',
    );
  }
  return url.origin;
}

async function readJson(filePath, label) {
  let contents;
  try {
    contents = await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`${label} not found: ${filePath}`);
    }
    throw error;
  }
  try {
    return JSON.parse(contents);
  } catch {
    throw new Error(`${label} is not valid JSON: ${filePath}`);
  }
}

export async function loadFixtures({ direct = false, groups = false } = {}) {
  const userFile = path.resolve(
    process.env.CONVERSATION_TEST_USERS_FILE ||
      'scripts/.conversation-test-users.json',
  );
  const tokenFile = path.resolve(
    process.env.TOKEN_POOL_FILE || 'scripts/.auth-token-pool.json',
  );
  const userData = await readJson(userFile, 'Conversation test-user data');
  if (
    !Array.isArray(userData?.users) ||
    userData.users.some((user) => {
      return (
        !user ||
        typeof user.id !== 'string' ||
        typeof user.username !== 'string'
      );
    })
  ) {
    throw new Error(
      `Conversation test-user data has an invalid format: ${userFile}`,
    );
  }

  const tokenPool = await readJson(tokenFile, 'Authentication token pool');
  if (
    !Array.isArray(tokenPool) ||
    tokenPool.some((entry) => {
      return (
        !entry ||
        typeof entry.username !== 'string' ||
        typeof entry.accessToken !== 'string'
      );
    })
  ) {
    throw new Error(
      `Authentication token pool has an invalid format: ${tokenFile}`,
    );
  }

  const usersByUsername = new Map(
    userData.users.map((user) => [user.username, user]),
  );
  const tokensByUsername = new Map(
    tokenPool.map((entry) => [entry.username, entry]),
  );
  const tokenFor = (username) => {
    const user = usersByUsername.get(username);
    const tokenEntry = tokensByUsername.get(username);
    if (!user || typeof tokenEntry?.accessToken !== 'string') {
      throw new Error(
        `Missing user ID or access token for ${username}. Refresh the local token pool and test-user data.`,
      );
    }
    const payloadPart = tokenEntry.accessToken.split('.')[1];
    let payload;
    try {
      payload = JSON.parse(
        Buffer.from(payloadPart, 'base64url').toString('utf8'),
      );
    } catch {
      throw new Error(`Access token for ${username} is not a valid JWT.`);
    }
    if (
      !Number.isSafeInteger(payload?.exp) ||
      payload.exp * 1_000 < Date.now() + CONNECT_TIMEOUT_MS + 60_000
    ) {
      throw new Error(
        `Access token for ${username} is expired or too close to expiry; refresh the token pool.`,
      );
    }
    if (
      tokenEntry.sessionExpiresAt !== undefined &&
      tokenEntry.sessionExpiresAt !== null
    ) {
      const sessionExpiresAt =
        typeof tokenEntry.sessionExpiresAt === 'string'
          ? Date.parse(tokenEntry.sessionExpiresAt)
          : Number.NaN;
      if (
        !Number.isFinite(sessionExpiresAt) ||
        sessionExpiresAt < Date.now() + CONNECT_TIMEOUT_MS + 60_000
      ) {
        throw new Error(
          `Auth session for ${username} is expired or too close to expiry; refresh the token pool.`,
        );
      }
    }
    return { ...user, token: tokenEntry.accessToken };
  };

  let directData;
  if (direct) {
    const directFile = path.resolve(
      process.env.CONVERSATION_DIRECT_FILE ||
        'scripts/.conversation-test-direct.json',
    );
    directData = await readJson(directFile, 'Direct-conversation fixture data');
    if (
      !Array.isArray(directData?.conversations) ||
      directData.conversations.some(
        (conversation) =>
          !conversation ||
          typeof conversation.id !== 'string' ||
          typeof conversation.userAUsername !== 'string' ||
          typeof conversation.userBUsername !== 'string',
      )
    ) {
      throw new Error(
        `Direct-conversation fixture data is invalid: ${directFile}`,
      );
    }
  }

  let groupData;
  if (groups) {
    const groupFile = path.resolve(
      process.env.SOCKETIO_GROUP_FIXTURE_FILE ||
        'scripts/.socketio-performance-groups.json',
    );
    groupData = await readJson(groupFile, 'Socket.IO group fixture data');
    if (
      !Array.isArray(groupData?.groups) ||
      groupData.groups.some(
        (group) =>
          !group ||
          typeof group.id !== 'string' ||
          group.type !== 'GROUP' ||
          group.joinPolicy !== 'OPEN' ||
          typeof group.ownerId !== 'string' ||
          !Number.isInteger(group.size) ||
          !Array.isArray(group.members) ||
          group.members.some(
            (member) =>
              !member ||
              typeof member.userId !== 'string' ||
              typeof member.username !== 'string',
          ),
      )
    ) {
      throw new Error(`Socket.IO group fixture data is invalid: ${groupFile}`);
    }
  }

  return {
    usersByUsername,
    tokenFor,
    directConversations: directData?.conversations ?? [],
    groups: groupData?.groups ?? [],
  };
}

export function requireDirectPair(fixtures, index = 0) {
  const conversation = fixtures.directConversations[index];
  if (!conversation) {
    throw new Error(
      'The required direct conversation is missing. Run scripts/create-conversation-test-direct.mjs first.',
    );
  }
  const first = fixtures.tokenFor(conversation.userAUsername);
  const second = fixtures.tokenFor(conversation.userBUsername);
  if (first.id !== conversation.userAId || second.id !== conversation.userBId) {
    throw new Error(
      `Direct-conversation fixture ${index + 1} does not match the test-user ID map.`,
    );
  }
  return { conversation, first, second };
}

async function getConversation(target, conversationId, token) {
  let response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS);
  try {
    response = await fetch(
      `${target}/conversations/${encodeURIComponent(conversationId)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      },
    );
  } catch {
    throw new Error(
      `Could not validate conversation ${conversationId} against the local API.`,
    );
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new Error(
      `Conversation ${conversationId} validation failed (HTTP ${response.status}).`,
    );
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`Conversation ${conversationId} returned non-JSON data.`);
  }
}

export async function validateDirectConversation(
  target,
  conversation,
  first,
  second,
) {
  const detail = await getConversation(target, conversation.id, first.token);
  const memberIds = new Set(
    Array.isArray(detail?.members)
      ? detail.members.map((member) => member.userId)
      : [],
  );
  if (
    detail?.id !== conversation.id ||
    detail.type !== 'DIRECT' ||
    memberIds.size !== 2 ||
    !memberIds.has(first.id) ||
    !memberIds.has(second.id)
  ) {
    throw new Error(
      `Direct conversation ${conversation.id} does not have the expected two members.`,
    );
  }
}

export async function validateGroupConversation(target, group, members) {
  const owner = members.find((member) => member.id === group.ownerId);
  if (!owner) {
    throw new Error(
      `Group fixture owner is not a member of group ${group.id}.`,
    );
  }
  const detail = await getConversation(target, group.id, owner.token);
  const actualMemberIds = new Set(
    Array.isArray(detail?.members)
      ? detail.members.map((member) => member.userId)
      : [],
  );
  const expectedMemberIds = new Set(members.map((member) => member.id));
  if (
    detail?.id !== group.id ||
    detail.type !== 'GROUP' ||
    detail.joinPolicy !== 'OPEN' ||
    detail.createdById !== group.ownerId ||
    actualMemberIds.size !== expectedMemberIds.size ||
    [...expectedMemberIds].some((id) => !actualMemberIds.has(id))
  ) {
    throw new Error(
      `Group ${group.id} is missing, is not OPEN, or has unexpected membership.`,
    );
  }
}

export function requireGroup(fixtures, size) {
  const group = fixtures.groups.find((entry) => entry.size === size);
  if (
    !group ||
    group.members.length !== size ||
    new Set(group.members.map((member) => member.userId)).size !== size ||
    group.members.some(
      (member) => !fixtures.usersByUsername.has(member.username),
    )
  ) {
    throw new Error(
      `An OPEN group with exactly ${size} fixture members is required. Run scripts/create-socketio-performance-groups.mjs first.`,
    );
  }
  const members = group.members.map((member) => {
    const user = fixtures.tokenFor(member.username);
    if (user.id !== member.userId) {
      throw new Error(`Group fixture user ID mismatch for ${member.username}.`);
    }
    return user;
  });
  return { ...group, members };
}

export function summarizeLatencies(values) {
  if (values.length === 0) {
    return {
      min: null,
      average: null,
      p50: null,
      p90: null,
      p95: null,
      p99: null,
      max: null,
    };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (fraction) =>
    sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)];
  return {
    min: round(sorted[0]),
    average: round(
      values.reduce((sum, value) => sum + value, 0) / values.length,
    ),
    p50: round(percentile(0.5)),
    p90: round(percentile(0.9)),
    p95: round(percentile(0.95)),
    p99: round(percentile(0.99)),
    max: round(sorted.at(-1)),
  };
}

export function round(value) {
  return Math.round(value * 100) / 100;
}

export function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function waitUntil(predicate, timeoutMs, pollMs = 20) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (predicate()) return true;
    await delay(pollMs);
  }
  return Boolean(predicate());
}

export function connectClients(target, users, onSocketCreated) {
  const pending = users.map(
    (user) =>
      new Promise((resolve, reject) => {
        const socket = io(target, {
          autoConnect: false,
          auth: { token: user.token },
          transports: ['websocket'],
          reconnection: false,
          timeout: CONNECT_TIMEOUT_MS,
          forceNew: true,
        });
        let settled = false;
        const timeout = setTimeout(() => {
          finish(new Error(`Connection timed out for ${user.username}.`));
        }, CONNECT_TIMEOUT_MS);
        const finish = (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          socket.off('connect', onConnect);
          socket.off('connect_error', onError);
          socket.off('disconnect', onPreConnectDisconnect);
          if (error) {
            socket.disconnect();
            reject(error);
          } else {
            resolve({ ...user, socket });
          }
        };
        const onConnect = () => finish();
        const onError = (error) =>
          finish(
            new Error(
              `Socket connection failed for ${user.username}: ${error.message}`,
            ),
          );
        const onPreConnectDisconnect = (reason) =>
          finish(
            new Error(
              `Socket disconnected before connecting for ${user.username}: ${reason}`,
            ),
          );
        socket.once('connect', onConnect);
        socket.once('connect_error', onError);
        socket.once('disconnect', onPreConnectDisconnect);
        onSocketCreated?.({ ...user, socket });
        socket.connect();
      }),
  );
  return Promise.all(pending).catch((error) => {
    for (const attempt of pending) {
      attempt.then((client) => client.socket.disconnect()).catch(() => {});
    }
    throw error;
  });
}

export function emitAck(socket, event, payload) {
  const startedAt = performance.now();
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      finish({ timedOut: true, latencyMs: null, response: null });
    }, ACK_TIMEOUT_MS + 100);
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    socket.timeout(ACK_TIMEOUT_MS).emit(event, payload, (error, response) => {
      finish({
        timedOut: Boolean(error),
        latencyMs: error ? null : round(performance.now() - startedAt),
        response: error ? null : response,
      });
    });
  });
}

export function startResourceMonitoring() {
  const initial = process.memoryUsage();
  let peakRss = initial.rss;
  let peakHeapUsed = initial.heapUsed;
  const cpuStart = process.cpuUsage();
  const eventLoop = monitorEventLoopDelay({ resolution: 20 });
  eventLoop.enable();
  const sampler = setInterval(() => {
    const memory = process.memoryUsage();
    peakRss = Math.max(peakRss, memory.rss);
    peakHeapUsed = Math.max(peakHeapUsed, memory.heapUsed);
  }, 100);
  sampler.unref();
  return () => {
    clearInterval(sampler);
    eventLoop.disable();
    const final = process.memoryUsage();
    const cpu = process.cpuUsage(cpuStart);
    const asMilliseconds = (value) =>
      Number.isFinite(value) ? round(value / 1e6) : null;
    return {
      loadGenerator: {
        rssBytes: { initial: initial.rss, peak: peakRss, final: final.rss },
        heapUsedBytes: {
          initial: initial.heapUsed,
          peak: peakHeapUsed,
          final: final.heapUsed,
        },
        cpuUsageMs: {
          user: round(cpu.user / 1_000),
          system: round(cpu.system / 1_000),
          total: round((cpu.user + cpu.system) / 1_000),
        },
        eventLoopDelayMs: {
          p95: asMilliseconds(eventLoop.percentile(95)),
          max: asMilliseconds(eventLoop.max),
        },
        totalSystemMemoryBytes: os.totalmem(),
      },
    };
  };
}

export async function runBenchmark({ testName, configuration, execute }) {
  let lock;
  const runId = `${Date.now()}-${process.pid}`;
  const startedAt = new Date();
  const report = {
    testName,
    runId,
    timestamp: startedAt.toISOString(),
    environment: {
      target: null,
      nodeVersion: process.version,
      transport: 'websocket',
      reconnection: false,
    },
    configuration: {
      connectTimeoutMs: CONNECT_TIMEOUT_MS,
      ackTimeoutMs: ACK_TIMEOUT_MS,
      deliveryTimeoutMs: DELIVERY_TIMEOUT_MS,
      ...configuration,
    },
    summary: {},
    latencyMs: {},
    resourceMetrics: {},
    errors: [],
  };
  let stopResources;
  let thrown;
  const clients = [];
  const connectedSockets = new WeakSet();
  const intentionalDisconnects = new WeakSet();
  const unexpectedDisconnects = [];
  let activeConnections = 0;
  let peakActiveConnections = 0;
  let cleanupStarted = false;

  try {
    try {
      lock = await open(lockPath, 'wx');
    } catch (error) {
      if (error.code === 'EEXIST') {
        throw new Error(
          `Another benchmark is running (lock file: ${lockPath}).`,
        );
      }
      throw error;
    }
    report.environment.target = getTargetUrl();
    stopResources = startResourceMonitoring();
    const connect = async (users, onSocketCreated) => {
      const connected = await connectClients(
        report.environment.target,
        users,
        (client) => {
          client.socket.on('connect', () => {
            connectedSockets.add(client.socket);
            activeConnections++;
            peakActiveConnections = Math.max(
              peakActiveConnections,
              activeConnections,
            );
          });
          client.socket.on('disconnect', (reason) => {
            if (connectedSockets.delete(client.socket)) {
              activeConnections = Math.max(0, activeConnections - 1);
              if (
                !cleanupStarted &&
                !intentionalDisconnects.has(client.socket)
              ) {
                unexpectedDisconnects.push({
                  username: client.username,
                  reason,
                  timestamp: new Date().toISOString(),
                });
              }
            }
          });
          onSocketCreated?.(client);
        },
      );
      clients.push(...connected);
      return connected;
    };
    const disconnect = async (client) => {
      intentionalDisconnects.add(client.socket);
      client.socket.disconnect();
      await delay(50);
    };
    await execute({
      report,
      target: report.environment.target,
      runId,
      connect,
      disconnect,
      clients,
    });
  } catch (error) {
    thrown = error;
    report.errors.push({
      message: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    });
  } finally {
    try {
      cleanupStarted = true;
      if (unexpectedDisconnects.length > 0) {
        report.errors.push({
          message: `${unexpectedDisconnects.length} unexpected client disconnect(s) occurred during the benchmark.`,
          timestamp: new Date().toISOString(),
        });
        thrown ??= new Error('Unexpected client disconnect(s) occurred.');
      }
      report.summary.unexpectedDisconnects = unexpectedDisconnects;
      report.summary.peakActiveConnections = peakActiveConnections;
      report.summary.cleanup = await disconnectClients(clients);
      report.summary.activeConnectionsBeforeCleanup =
        report.summary.cleanup.connectedBeforeCleanup;
      report.summary.activeConnectionsAfterCleanup =
        report.summary.cleanup.connectedAfterCleanup;
      if (stopResources) report.resourceMetrics = stopResources();
      await mkdir(resultsDirectory, { recursive: true });
      const timestamp = startedAt.toISOString().replace(/[:.]/g, '-');
      const file = path.join(
        resultsDirectory,
        `${testName}-${timestamp}-${process.pid}.json`,
      );
      await writeFile(file, `${JSON.stringify(report, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      console.log(`Report saved to ${file}`);
    } catch (error) {
      thrown ??= error;
      console.error(`Could not save benchmark report: ${error.message}`);
    } finally {
      if (lock) {
        await lock.close();
        await unlink(lockPath).catch((error) => {
          thrown ??= error;
          console.error(`Could not remove benchmark lock: ${error.message}`);
        });
      }
    }
  }

  if (thrown) {
    console.error(`${testName} did not complete: ${thrown.message}`);
    process.exitCode = 1;
  }
}

export async function disconnectClients(clients) {
  const connectedBeforeCleanup = clients.filter(
    (client) => client.socket.connected,
  ).length;
  for (const client of clients) client.socket.disconnect();
  await delay(250);
  return {
    connectedBeforeCleanup,
    connectedAfterCleanup: clients.filter((client) => client.socket.connected)
      .length,
  };
}
