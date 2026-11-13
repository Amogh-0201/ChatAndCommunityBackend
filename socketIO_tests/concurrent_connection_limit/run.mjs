import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { io } from 'socket.io-client';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const MAX_CONNECTIONS_HARD_LIMIT = 11000;
const DEFAULT_MAX_CONNECTIONS = 11000;
const DEFAULT_OBSERVATION_SECONDS = 15;
const CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_BATCH_DELAY_MS = 200;
const DEFAULT_MAX_CLIENT_RSS_MB = 512;
const MEGABYTE = 1024 * 1024;
const STAGE_MILESTONES = [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 11000];

function readIntegerEnv(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

function getLocalApiUrl() {
  const baseUrl = process.env.API_BASE_URL ?? 'http://localhost:3000';
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error('API_BASE_URL must be a valid local HTTP(S) URL.');
  }

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  ) {
    throw new Error(
      'API_BASE_URL must point to this machine (localhost, 127.0.0.1, or ::1).',
    );
  }

  return url.origin;
}

function getStageTargets(maxConnections) {
  const targets = STAGE_MILESTONES.filter((target) => target <= maxConnections);
  if (targets.at(-1) !== maxConnections) targets.push(maxConnections);
  return targets;
}

function getTokenExpiry(token) {
  try {
    const payloadPart = token.split('.')[1];
    if (!payloadPart) throw new Error();
    const payload = JSON.parse(
      Buffer.from(payloadPart, 'base64url').toString('utf8'),
    );
    if (!Number.isSafeInteger(payload.exp)) throw new Error();
    return payload.exp * 1_000;
  } catch {
    throw new Error('A token in the selected pool is not a valid JWT.');
  }
}

async function loadTokens(tokenPoolPath, count, minimumLifetimeMs) {
  let pool;
  try {
    pool = JSON.parse(await readFile(tokenPoolPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(
        `Token pool not found at ${tokenPoolPath}. Refresh the local test-user pool first.`,
      );
    }
    if (error instanceof SyntaxError) {
      throw new Error(`Token pool is not valid JSON: ${tokenPoolPath}`);
    }
    throw error;
  }

  if (!Array.isArray(pool) || pool.length < count) {
    throw new Error(
      `The token pool must contain at least ${count} test users; it contains ${Array.isArray(pool) ? pool.length : 0}.`,
    );
  }

  const selected = pool.slice(0, count);
  const usernames = new Set();
  const accessTokens = new Set();
  const now = Date.now();

  for (const entry of selected) {
    if (
      !entry ||
      typeof entry.username !== 'string' ||
      typeof entry.accessToken !== 'string' ||
      !entry.accessToken
    ) {
      throw new Error('The token pool contains an invalid test-user entry.');
    }
    if (usernames.has(entry.username) || accessTokens.has(entry.accessToken)) {
      throw new Error(
        'The selected token-pool entries must have unique users and access tokens.',
      );
    }
    usernames.add(entry.username);
    accessTokens.add(entry.accessToken);

    if (getTokenExpiry(entry.accessToken) < now + minimumLifetimeMs) {
      throw new Error(
        `Access tokens must remain valid for the estimated run duration. Refresh the first ${count} test-user tokens immediately before testing.`,
      );
    }

    if (
      entry.sessionExpiresAt &&
      new Date(entry.sessionExpiresAt).getTime() < now + minimumLifetimeMs
    ) {
      throw new Error(
        `Test-user sessions must remain valid for the estimated run duration. Refresh the first ${count} test-user tokens immediately before testing.`,
      );
    }
  }

  return selected.map((entry) => entry.accessToken);
}

function percentile(sortedValues, fraction) {
  if (sortedValues.length === 0) return null;
  return sortedValues[
    Math.max(0, Math.ceil(fraction * sortedValues.length) - 1)
  ];
}

function summarizeLatencies(values) {
  if (values.length === 0) {
    return {
      min: null,
      max: null,
      average: null,
      median: null,
      p90: null,
      p95: null,
      p99: null,
    };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];

  return {
    min: sorted[0],
    max: sorted.at(-1),
    average: values.reduce((sum, value) => sum + value, 0) / values.length,
    median,
    p90: percentile(sorted, 0.9),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
  };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function roundMilliseconds(value) {
  return Math.round(value * 100) / 100;
}

async function main() {
  const apiUrl = getLocalApiUrl();
  const maxConnections = readIntegerEnv(
    'MAX_CONNECTIONS',
    DEFAULT_MAX_CONNECTIONS,
    STAGE_MILESTONES[0],
    MAX_CONNECTIONS_HARD_LIMIT,
  );
  const observationSeconds = readIntegerEnv(
    'OBSERVATION_SECONDS',
    DEFAULT_OBSERVATION_SECONDS,
    DEFAULT_OBSERVATION_SECONDS,
    300,
  );
  const batchSize = readIntegerEnv(
    'CONNECT_BATCH_SIZE',
    DEFAULT_BATCH_SIZE,
    1,
    10,
  );
  const batchDelayMs = readIntegerEnv(
    'CONNECT_BATCH_DELAY_MS',
    DEFAULT_BATCH_DELAY_MS,
    250,
    5_000,
  );
  const maxClientRssMb = readIntegerEnv(
    'MAX_CLIENT_RSS_MB',
    DEFAULT_MAX_CLIENT_RSS_MB,
    128,
    2_048,
  );
  const targets = getStageTargets(maxConnections);
  const expectedDurationMs =
    targets.length * (observationSeconds * 1_000 + CONNECT_TIMEOUT_MS) +
    Math.ceil(maxConnections / batchSize) * batchDelayMs;
  const tokenPoolPath = path.resolve(
    process.env.TOKEN_POOL_FILE || 'scripts/.auth-token-pool.json',
  );
  const tokens = await loadTokens(
    tokenPoolPath,
    maxConnections,
    expectedDurationMs,
  );

  const report = {
    startedAt: new Date().toISOString(),
    finishedAt: null,
    config: {
      apiUrl,
      maxConnections,
      observationSeconds,
      connectTimeoutMs: CONNECT_TIMEOUT_MS,
      batchSize,
      batchDelayMs,
      maxClientRssMb,
    },
    stages: [],
    stopReason: null,
    interrupted: false,
  };
  const clients = [];
  const attempts = [];
  const unexpectedDisconnects = [];
  let stopRequested = false;
  let stopReason = null;

  const closeClients = () => {
    for (const client of clients) client.socket.disconnect();
  };
  const requestStop = (reason) => {
    if (stopRequested) return;
    stopRequested = true;
    stopReason = reason;
    console.warn(`Stopping: ${reason}`);
    closeClients();
  };
  const onInterrupt = () => requestStop('Interrupted by user (Ctrl+C).');
  process.on('SIGINT', onInterrupt);

  const rssLimitBytes = Math.min(maxClientRssMb * MEGABYTE, os.totalmem() / 2);
  const memoryMonitor = setInterval(() => {
    const rssBytes = process.memoryUsage().rss;
    if (rssBytes >= rssLimitBytes) {
      requestStop(
        `Client process RSS reached its safety limit (${Math.round(rssBytes / MEGABYTE)} MB).`,
      );
    }
  }, 1_000);
  memoryMonitor.unref();

  function connectOne(token, connectionNumber, target) {
    const socket = io(apiUrl, {
      autoConnect: false,
      auth: { token },
      transports: ['websocket'],
      reconnection: false,
      timeout: CONNECT_TIMEOUT_MS,
      forceNew: true,
    });
    const attempt = {
      connectionNumber,
      stageTarget: target,
      startedAt: new Date().toISOString(),
      durationMs: null,
      status: 'pending',
      error: null,
    };
    const started = performance.now();
    attempts.push(attempt);
    clients.push({ socket, attempt });

    return new Promise((resolve) => {
      let settled = false;
      const cleanupAttemptListeners = () => {
        clearTimeout(timeout);
        socket.off('connect', onConnect);
        socket.off('connect_error', onConnectError);
        socket.off('disconnect', onPreConnectDisconnect);
      };
      const finish = (status, error) => {
        if (settled) return;
        settled = true;
        cleanupAttemptListeners();
        attempt.durationMs = roundMilliseconds(performance.now() - started);
        attempt.status = status;
        attempt.error = error ?? null;
        resolve(attempt);
      };
      const onDisconnect = (reason) => {
        if (!stopRequested) {
          unexpectedDisconnects.push({
            connectionNumber,
            stageTarget: target,
            observedAt: new Date().toISOString(),
            reason,
          });
        }
      };
      const onConnect = () => {
        socket.off('disconnect', onPreConnectDisconnect);
        socket.on('disconnect', onDisconnect);
        finish('connected');
      };
      const onConnectError = (error) => {
        finish('failed', error.message || 'Socket.IO connection error');
        socket.disconnect();
      };
      const onPreConnectDisconnect = (reason) => {
        finish(
          stopRequested ? 'interrupted' : 'failed',
          stopRequested ? null : `Disconnected before connect: ${reason}`,
        );
      };
      const timeout = setTimeout(() => {
        finish('failed', 'Connection timed out after 10 seconds.');
        socket.disconnect();
      }, CONNECT_TIMEOUT_MS);

      socket.once('connect', onConnect);
      socket.once('connect_error', onConnectError);
      socket.once('disconnect', onPreConnectDisconnect);
      socket.connect();
    });
  }

  try {
    console.log(
      `Local Socket.IO capacity test: ${apiUrl}; maximum ${maxConnections} connections.`,
    );
    console.log(
      `Each stage observes for ${observationSeconds}s; press Ctrl+C to stop safely.`,
    );
    console.log(
      'Watch server CPU, memory, and database health while this runs.',
    );

    let previousTarget = 0;
    for (const target of targets) {
      if (stopRequested) break;
      const stageStartAttemptIndex = attempts.length;
      const stageStartDisconnectIndex = unexpectedDisconnects.length;
      const additionalConnections = target - previousTarget;
      console.log(
        `\nStage ${target}: opening ${additionalConnections} additional connection(s).`,
      );

      let nextConnectionNumber = previousTarget + 1;
      let pauseOpening = false;
      while (
        nextConnectionNumber <= target &&
        !stopRequested &&
        !pauseOpening
      ) {
        const batchEnd = Math.min(target, nextConnectionNumber + batchSize - 1);
        const batch = [];
        while (nextConnectionNumber <= batchEnd) {
          const number = nextConnectionNumber;
          batch.push(connectOne(tokens[number - 1], number, target));
          nextConnectionNumber++;
        }
        await Promise.all(batch);
        const completedAttempts = attempts.slice(stageStartAttemptIndex);
        const completedFailures = completedAttempts.filter(
          (attempt) => attempt.status === 'failed',
        ).length;
        const completedCount = completedAttempts.filter(
          (attempt) => attempt.status !== 'interrupted',
        ).length;
        if (
          completedFailures >= 2 &&
          completedFailures / completedCount > 0.01
        ) {
          pauseOpening = true;
          console.warn(
            'Pausing new connection attempts after the failure threshold; observing existing connections before stopping.',
          );
        }
        if (nextConnectionNumber <= target && !stopRequested) {
          if (!pauseOpening) await delay(batchDelayMs);
        }
      }

      const connectedBeforeObservation = clients.filter(
        ({ socket }) => socket.connected,
      ).length;
      const observationStarted = performance.now();
      while (
        !stopRequested &&
        performance.now() - observationStarted < observationSeconds * 1_000
      ) {
        await delay(250);
      }

      const stageAttempts = attempts.slice(stageStartAttemptIndex);
      const attempted = stageAttempts.filter(
        (attempt) => attempt.status !== 'interrupted',
      );
      const succeeded = stageAttempts.filter(
        (attempt) => attempt.status === 'connected',
      );
      const failed = stageAttempts.filter(
        (attempt) => attempt.status === 'failed',
      );
      const activeAfterObservation = clients.filter(
        ({ socket }) => socket.connected,
      ).length;
      const stageDisconnects = unexpectedDisconnects.slice(
        stageStartDisconnectIndex,
      );
      const failureRate =
        attempted.length === 0 ? 0 : (failed.length / attempted.length) * 100;
      const stageResult = {
        target,
        additionalAttempts: attempted.length,
        connected: succeeded.length,
        failed: failed.length,
        interrupted: stageAttempts.filter(
          (attempt) => attempt.status === 'interrupted',
        ).length,
        connectionSuccessRatePercent:
          attempted.length === 0
            ? 0
            : roundMilliseconds((succeeded.length / attempted.length) * 100),
        connectionFailureRatePercent: roundMilliseconds(failureRate),
        connectedBeforeObservation,
        activeAfterObservation,
        unexpectedDisconnects: stageDisconnects.length,
        disconnectDetails: stageDisconnects,
        observedSeconds: roundMilliseconds(
          (performance.now() - observationStarted) / 1_000,
        ),
        connectionEstablishmentLatencyMs: summarizeLatencies(
          succeeded.map((attempt) => attempt.durationMs),
        ),
        failureReasons: failed.reduce((counts, attempt) => {
          const reason = attempt.error || 'Unknown connection failure';
          counts[reason] = (counts[reason] || 0) + 1;
          return counts;
        }, {}),
      };
      report.stages.push(stageResult);

      console.log(
        `Target ${target}: ${stageResult.connected} connected, ` +
          `${stageResult.failed} failed, ${activeAfterObservation} active after ` +
          `${stageResult.observedSeconds}s observation.`,
      );

      if (stopRequested) break;
      if (stageDisconnects.length > 0) {
        requestStop(
          'Unexpected disconnect(s) during observation; investigate before continuing.',
        );
      } else if (failed.length >= 2 && failureRate > 1) {
        requestStop(
          'At least two connection failures and a failure rate above 1%; investigate before continuing.',
        );
      } else {
        if (failed.length > 0) {
          console.warn(
            'A connection attempt failed. Review its recorded reason; one failure alone is not treated as a capacity boundary.',
          );
        }
        previousTarget = target;
      }
    }
  } catch (error) {
    stopReason = `Test error: ${error.message}`;
    throw error;
  } finally {
    clearInterval(memoryMonitor);
    for (const client of clients) client.socket.disconnect();
    process.off('SIGINT', onInterrupt);

    report.finishedAt = new Date().toISOString();
    report.stopReason =
      stopReason ??
      (report.stages.length === targets.length
        ? 'Configured maximum reached.'
        : 'Test ended before the next stage.');
    report.interrupted = stopReason === 'Interrupted by user (Ctrl+C).';
    report.connectionAttempts = attempts.map(
      ({ connectionNumber, ...entry }) => ({
        connectionNumber,
        ...entry,
      }),
    );

    const resultsDirectory = path.join(SCRIPT_DIR, 'results');
    await mkdir(resultsDirectory, { recursive: true });
    const fileTimestamp = report.startedAt.replace(/[:.]/g, '-');
    const reportPath = path.join(
      resultsDirectory,
      `concurrent-connections-${fileTimestamp}.json`,
    );
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    console.log(`\nReport saved to ${reportPath}`);
    if (stopRequested && report.interrupted) process.exitCode = 130;
  }
}

main().catch((error) => {
  console.error(`Socket.IO capacity test could not complete: ${error.message}`);
  process.exitCode = 1;
});
