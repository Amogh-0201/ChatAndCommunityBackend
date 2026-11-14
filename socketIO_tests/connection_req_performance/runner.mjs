import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { io } from 'socket.io-client';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const MAX_CONNECTION_ATTEMPTS = 11_000;
const CONNECT_TIMEOUT_MS = 10_000;
const DEFAULT_HOLD_SECONDS = 4;
const DEFAULT_MAX_CLIENT_RSS_MB = 512;
const SAFETY_POLL_MS = 250;
const DISPATCH_POLL_MS = 8;
const CLIENT_DISCONNECT_TIMEOUT_MS = 5_000;
const SERVER_DISCONNECT_GRACE_MS = 1_000;
const MEGABYTE = 1024 * 1024;

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
    if (entry.sessionExpiresAt !== undefined) {
      const sessionExpiresAt = new Date(entry.sessionExpiresAt).getTime();
      if (!Number.isFinite(sessionExpiresAt)) {
        throw new Error(
          'The token pool contains an invalid test-user session expiry.',
        );
      }
      if (sessionExpiresAt < now + minimumLifetimeMs) {
        throw new Error(
          `Test-user sessions must remain valid for the estimated run duration. Refresh the first ${count} test-user tokens immediately before testing.`,
        );
      }
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

function round(value) {
  return Math.round(value * 100) / 100;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function validateProfile(profile) {
  if (!profile || !/^[a-z-]+$/.test(profile.name)) {
    throw new Error('Profile must have a simple lowercase name.');
  }
  if (!Array.isArray(profile.rounds) || profile.rounds.length === 0) {
    throw new Error('Profile must define at least one request round.');
  }

  const plannedAttempts = profile.rounds.reduce((total, requestRound) => {
    if (
      !Number.isSafeInteger(requestRound.attempts) ||
      requestRound.attempts < 1 ||
      !Number.isSafeInteger(requestRound.requestsPerSecond) ||
      requestRound.requestsPerSecond < 1 ||
      requestRound.attempts > MAX_CONNECTION_ATTEMPTS
    ) {
      throw new Error(
        'Each round must request 1-11,000 connections at a positive integer rate.',
      );
    }
    return total + requestRound.attempts;
  }, 0);

  if (plannedAttempts !== MAX_CONNECTION_ATTEMPTS) {
    throw new Error(
      `Profile must schedule exactly ${MAX_CONNECTION_ATTEMPTS} total attempts before the cap.`,
    );
  }
}

function buildRounds(profile, maxAttempts, holdSecondsOverride) {
  let remaining = maxAttempts;
  const rounds = [];

  for (const [index, requestRound] of profile.rounds.entries()) {
    if (remaining === 0) break;
    const attempts = Math.min(remaining, requestRound.attempts);
    rounds.push({
      round: index + 1,
      attempts,
      requestsPerSecond: requestRound.requestsPerSecond,
      plannedDispatchDurationMs:
        (attempts / requestRound.requestsPerSecond) * 1_000,
      holdSeconds: holdSecondsOverride ?? requestRound.holdSeconds,
    });
    remaining -= attempts;
  }

  return rounds;
}

export async function runProfile(profile) {
  validateProfile(profile);

  const apiUrl = getLocalApiUrl();
  const maxAttempts = readIntegerEnv(
    'MAX_ATTEMPTS',
    MAX_CONNECTION_ATTEMPTS,
    1,
    MAX_CONNECTION_ATTEMPTS,
  );
  const holdSecondsOverride =
    process.env.OBSERVATION_SECONDS === undefined
      ? null
      : readIntegerEnv('OBSERVATION_SECONDS', DEFAULT_HOLD_SECONDS, 1, 300);
  const maxClientRssMb = readIntegerEnv(
    'MAX_CLIENT_RSS_MB',
    DEFAULT_MAX_CLIENT_RSS_MB,
    128,
    2_048,
  );
  const rounds = buildRounds(profile, maxAttempts, holdSecondsOverride);
  const minimumTokenLifetimeMs =
    rounds.reduce(
      (total, requestRound) =>
        total +
        requestRound.plannedDispatchDurationMs +
        CONNECT_TIMEOUT_MS +
        requestRound.holdSeconds * 1_000,
      0,
    ) + 120_000;
  const tokenPoolPath = path.resolve(
    process.env.TOKEN_POOL_FILE || 'scripts/.auth-token-pool.json',
  );
  const tokens = await loadTokens(
    tokenPoolPath,
    maxAttempts,
    minimumTokenLifetimeMs,
  );

  const report = {
    profile: profile.name,
    description: profile.description,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    config: {
      apiUrl,
      maxConnectionAttempts: maxAttempts,
      userTokensAvailable: maxAttempts,
      connectTimeoutMs: CONNECT_TIMEOUT_MS,
      dispatchPollMs: DISPATCH_POLL_MS,
      observationSeconds: holdSecondsOverride ?? DEFAULT_HOLD_SECONDS,
      maxClientRssMb,
      totalSystemMemoryBytes: os.totalmem(),
      platform: process.platform,
      nodeVersion: process.version,
      transport: 'websocket',
      automaticReconnection: false,
      applicationEventsSent: 0,
      rounds: rounds.map(
        ({
          round: roundNumber,
          attempts,
          requestsPerSecond,
          plannedDispatchDurationMs,
          holdSeconds,
        }) => ({
          round: roundNumber,
          attempts,
          targetRequestsPerSecond: requestsPerSecond,
          plannedDispatchDurationMs: round(plannedDispatchDurationMs),
          holdSeconds,
        }),
      ),
    },
    rounds: [],
    stopReason: null,
    interrupted: false,
    cleanup: null,
    connectionAttempts: [],
    unexpectedDisconnects: [],
    processMetrics: {
      initialMemoryUsage: process.memoryUsage(),
      finalMemoryUsage: null,
      cpuUsageMicros: null,
      eventLoopDelayMs: null,
    },
  };

  const clients = [];
  const attempts = [];
  const unexpectedDisconnects = [];
  const cpuUsageStart = process.cpuUsage();
  const runStarted = performance.now();
  const eventLoopMonitor = monitorEventLoopDelay({ resolution: 20 });
  eventLoopMonitor.enable();
  let stopRequested = false;
  let stopReason = null;
  let activeConnections = 0;
  let peakActiveConnections = 0;
  let pendingAttempts = 0;
  let peakPendingAttempts = 0;

  const closeClients = () => {
    for (const socket of clients) socket.disconnect();
  };
  const closeClientsAndWait = async () => {
    const connectedBeforeCleanup = clients.filter(
      (socket) => socket.connected,
    ).length;
    const socketsToClose = clients.filter(
      (socket) => socket.connected || socket.active,
    );
    const results = await Promise.all(
      socketsToClose.map(
        (socket) =>
          new Promise((resolve) => {
            let settled = false;
            const finish = (disconnected) => {
              if (settled) return;
              settled = true;
              clearTimeout(timeout);
              socket.off('disconnect', onDisconnect);
              resolve(disconnected);
            };
            const onDisconnect = () => finish(true);
            const timeout = setTimeout(
              () => finish(false),
              CLIENT_DISCONNECT_TIMEOUT_MS,
            );

            socket.once('disconnect', onDisconnect);
            socket.disconnect();
            if (!socket.connected && !socket.active) finish(true);
          }),
      ),
    );
    const alreadyClosed = clients.length - socketsToClose.length;

    if (clients.length > 0) {
      await delay(SERVER_DISCONNECT_GRACE_MS);
    }

    const connectedAfterCleanup = clients.filter(
      (socket) => socket.connected,
    ).length;
    const unconfirmedDisconnects = results.filter(
      (disconnected) => !disconnected,
    ).length;

    return {
      connectedBeforeCleanup,
      disconnectsConfirmed:
        alreadyClosed + results.length - unconfirmedDisconnects,
      unconfirmedDisconnects,
      connectedAfterCleanup,
      allClientSocketsDisconnected:
        unconfirmedDisconnects === 0 && connectedAfterCleanup === 0,
      serverDisconnectGraceMs:
        clients.length > 0 ? SERVER_DISCONNECT_GRACE_MS : 0,
    };
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
  process.on('SIGTERM', onInterrupt);

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

  function connectOne(token, connectionNumber, roundInfo, waveStart) {
    const scheduledOffsetMs =
      (connectionNumber - roundInfo.firstConnectionNumber) *
      (1_000 / roundInfo.requestsPerSecond);
    const launchLagMs = round(
      Math.max(0, performance.now() - waveStart - scheduledOffsetMs),
    );
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
      round: roundInfo.round,
      targetRequestsPerSecond: roundInfo.requestsPerSecond,
      scheduledOffsetMs: round(scheduledOffsetMs),
      launchLagMs,
      startedAt: new Date().toISOString(),
      latencyMs: null,
      completedAt: null,
      status: 'pending',
      error: null,
    };
    const started = performance.now();
    attempts.push(attempt);
    clients.push(socket);
    pendingAttempts++;
    peakPendingAttempts = Math.max(peakPendingAttempts, pendingAttempts);
    roundInfo.peakPendingAttempts = Math.max(
      roundInfo.peakPendingAttempts,
      pendingAttempts,
    );

    return new Promise((resolve) => {
      let settled = false;
      let wasConnected = false;
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
        pendingAttempts--;
        attempt.latencyMs = round(performance.now() - started);
        attempt.completedAt = new Date().toISOString();
        attempt.status = status;
        attempt.error = error ?? null;
        resolve(attempt);
      };
      const onDisconnect = (reason) => {
        if (wasConnected) {
          activeConnections--;
          wasConnected = false;
        }
        if (!stopRequested) {
          const disconnect = {
            connectionNumber,
            round: roundInfo.round,
            observedAt: new Date().toISOString(),
            reason,
          };
          unexpectedDisconnects.push(disconnect);
          requestStop(
            'Unexpected disconnect(s) observed; investigate before continuing.',
          );
        }
      };
      const onConnect = () => {
        wasConnected = true;
        activeConnections++;
        peakActiveConnections = Math.max(
          peakActiveConnections,
          activeConnections,
        );
        roundInfo.peakActiveConnections = Math.max(
          roundInfo.peakActiveConnections,
          activeConnections,
        );
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

  function clientSnapshot() {
    const memory = process.memoryUsage();
    return {
      timestamp: new Date().toISOString(),
      activeConnections,
      pendingConnectionAttempts: pendingAttempts,
      clientRssBytes: memory.rss,
      clientHeapUsedBytes: memory.heapUsed,
    };
  }

  async function dispatchRound(roundPlan) {
    const roundStart = performance.now();
    const roundStartedAt = new Date().toISOString();
    const firstConnectionNumber = attempts.length + 1;
    const roundInfo = {
      round: roundPlan.round,
      requestsPerSecond: roundPlan.requestsPerSecond,
      firstConnectionNumber,
      peakActiveConnections: activeConnections,
      peakPendingAttempts: pendingAttempts,
    };
    const startAttemptIndex = attempts.length;
    const disconnectIndex = unexpectedDisconnects.length;
    const promises = [];
    let launched = 0;
    let lastLaunchTime = null;
    const activeBeforeRound = activeConnections;
    while (launched < roundPlan.attempts && !stopRequested) {
      const elapsedMs = performance.now() - roundStart;
      const due = Math.min(
        roundPlan.attempts,
        Math.floor((elapsedMs * roundPlan.requestsPerSecond) / 1_000) + 1,
      );

      while (launched < due && !stopRequested) {
        const launchTime = performance.now();
        lastLaunchTime = launchTime;
        const connectionNumber = attempts.length + 1;
        promises.push(
          connectOne(
            tokens[connectionNumber - 1],
            connectionNumber,
            roundInfo,
            roundStart,
          ),
        );
        launched++;
      }

      if (launched < roundPlan.attempts && !stopRequested) {
        await delay(DISPATCH_POLL_MS);
      }
    }

    const dispatchWasComplete = launched === roundPlan.attempts;
    const dispatchElapsedMs =
      lastLaunchTime === null
        ? 0
        : dispatchWasComplete
          ? Math.max(
              roundPlan.plannedDispatchDurationMs,
              lastLaunchTime - roundStart,
            )
          : Math.max(1, lastLaunchTime - roundStart);
    await Promise.all(promises);
    const resultsReadyAt = performance.now();
    const resultAttempts = attempts.slice(startAttemptIndex);
    const resolved = resultAttempts.filter(
      (attempt) =>
        attempt.status === 'connected' || attempt.status === 'failed',
    );
    const connected = resultAttempts.filter(
      (attempt) => attempt.status === 'connected',
    );
    const failed = resultAttempts.filter(
      (attempt) => attempt.status === 'failed',
    );
    const interrupted = resultAttempts.filter(
      (attempt) => attempt.status === 'interrupted',
    );
    const beforeHold = clientSnapshot();
    const holdStarted = performance.now();
    const holdDurationMs = roundPlan.holdSeconds * 1_000;

    while (!stopRequested && performance.now() - holdStarted < holdDurationMs) {
      if (unexpectedDisconnects.length > disconnectIndex) break;
      if (process.memoryUsage().rss >= rssLimitBytes) {
        requestStop(
          `Client process RSS reached its safety limit (${Math.round(process.memoryUsage().rss / MEGABYTE)} MB).`,
        );
        break;
      }
      await delay(SAFETY_POLL_MS);
    }

    const observedHoldSeconds = round(
      (performance.now() - holdStarted) / 1_000,
    );
    const afterHold = clientSnapshot();
    const disconnects = unexpectedDisconnects.slice(disconnectIndex);
    const resolvedCount = resolved.length;
    const failureRate =
      resolvedCount === 0 ? 0 : (failed.length / resolvedCount) * 100;
    const dispatchElapsedSeconds = dispatchElapsedMs / 1_000;
    const completionElapsedSeconds = (resultsReadyAt - roundStart) / 1_000;
    const result = {
      round: roundPlan.round,
      startedAt: roundStartedAt,
      targetRequestsPerSecond: roundPlan.requestsPerSecond,
      plannedDispatchDurationMs: round(roundPlan.plannedDispatchDurationMs),
      actualDispatchDurationMs: round(dispatchElapsedMs),
      dispatchedAttempts: launched,
      connected: connected.length,
      failed: failed.length,
      interrupted: interrupted.length,
      connectionSuccessRatePercent:
        resolvedCount === 0
          ? 0
          : round((connected.length / resolvedCount) * 100),
      connectionFailureRatePercent: round(failureRate),
      actualAttemptRatePerSecond:
        dispatchElapsedSeconds === 0
          ? null
          : round(launched / dispatchElapsedSeconds),
      successfulConnectionsPerSecond:
        completionElapsedSeconds === 0
          ? null
          : round(connected.length / completionElapsedSeconds),
      failedConnectionsPerSecond:
        completionElapsedSeconds === 0
          ? null
          : round(failed.length / completionElapsedSeconds),
      connectionAttemptLatencyMs: summarizeLatencies(
        resolved.map((attempt) => attempt.latencyMs),
      ),
      connectionEstablishmentLatencyMs: summarizeLatencies(
        connected.map((attempt) => attempt.latencyMs),
      ),
      failedAttemptLatencyMs: summarizeLatencies(
        failed.map((attempt) => attempt.latencyMs),
      ),
      averageLaunchLagMs:
        resultAttempts.length === 0
          ? null
          : round(
              resultAttempts.reduce(
                (sum, attempt) => sum + attempt.launchLagMs,
                0,
              ) / resultAttempts.length,
            ),
      maxLaunchLagMs:
        resultAttempts.length === 0
          ? null
          : Math.max(...resultAttempts.map((attempt) => attempt.launchLagMs)),
      activeBeforeRound,
      activeBeforeHold: beforeHold.activeConnections,
      activeAfterHold: afterHold.activeConnections,
      peakActiveConnections: roundInfo.peakActiveConnections,
      peakPendingConnectionAttempts: roundInfo.peakPendingAttempts,
      unexpectedDisconnects: disconnects.length,
      disconnectDetails: disconnects,
      observedHoldSeconds,
      failureReasons: failed.reduce((counts, attempt) => {
        const reason = attempt.error || 'Unknown connection failure';
        counts[reason] = (counts[reason] || 0) + 1;
        return counts;
      }, {}),
      clientBeforeHold: beforeHold,
      clientAfterHold: afterHold,
      roundDurationSeconds: round((performance.now() - roundStart) / 1_000),
    };
    report.rounds.push(result);

    console.log(
      `Round ${result.round}: ${result.dispatchedAttempts} initiated at ` +
        `${result.actualAttemptRatePerSecond ?? 'n/a'} attempts/s; ` +
        `${result.connected} connected, ${result.failed} failed; ` +
        `${result.activeAfterHold} still active after ${result.observedHoldSeconds}s hold.`,
    );

    if (!stopRequested && disconnects.length > 0) {
      requestStop(
        'Unexpected disconnect(s) during the hold; investigate before continuing.',
      );
    }
  }

  try {
    console.log(
      `Socket.IO ${profile.name} request-rate profile: ${apiUrl}; maximum ${maxAttempts} attempts.`,
    );
    console.log(
      'Each round dispatches requests at its configured rate without waiting for individual handshakes, then observes connected sockets for 15 seconds.',
    );
    console.log(
      'Watch server/database CPU and memory. Stop if resource use stays near 90% or the server/database becomes unstable.',
    );

    for (const roundPlan of rounds) {
      if (stopRequested) break;
      await dispatchRound(roundPlan);
    }
  } catch (error) {
    stopReason = `Test error: ${error.message}`;
    throw error;
  } finally {
    clearInterval(memoryMonitor);
    const activeConnectionsBeforeCleanup = activeConnections;
    stopRequested = true;
    const cleanup = await closeClientsAndWait();
    report.cleanup = cleanup;
    if (!cleanup.allClientSocketsDisconnected) {
      const cleanupError =
        `Could not confirm disconnection of ${cleanup.unconfirmedDisconnects} client socket(s); ` +
        `${cleanup.connectedAfterCleanup} remain connected after cleanup.`;
      console.error(`Cleanup error: ${cleanupError}`);
      stopReason ??= cleanupError;
    }
    process.off('SIGINT', onInterrupt);
    process.off('SIGTERM', onInterrupt);
    eventLoopMonitor.disable();

    report.finishedAt = new Date().toISOString();
    report.stopReason =
      stopReason ??
      (attempts.length >= maxAttempts
        ? `Configured attempt cap (${maxAttempts}) reached.`
        : 'Profile completed.');
    report.interrupted = stopReason === 'Interrupted by user (Ctrl+C).';
    report.unexpectedDisconnects = unexpectedDisconnects;
    report.connectionAttempts = attempts;
    report.processMetrics.finalMemoryUsage = process.memoryUsage();
    report.processMetrics.cpuUsageMicros = process.cpuUsage(cpuUsageStart);
    const eventLoopMetric = (nanoseconds) =>
      Number.isFinite(nanoseconds) ? round(nanoseconds / 1e6) : null;
    report.processMetrics.eventLoopDelayMs = {
      min: eventLoopMetric(eventLoopMonitor.min),
      max: eventLoopMetric(eventLoopMonitor.max),
      mean: eventLoopMetric(eventLoopMonitor.mean),
      p95: eventLoopMetric(eventLoopMonitor.percentile(95)),
    };

    const totalAttempts = attempts.length;
    const resolvedAttempts = attempts.filter(
      (attempt) =>
        attempt.status === 'connected' || attempt.status === 'failed',
    );
    const connected = resolvedAttempts.filter(
      (attempt) => attempt.status === 'connected',
    );
    const failed = resolvedAttempts.filter(
      (attempt) => attempt.status === 'failed',
    );
    const durationSeconds = round((performance.now() - runStarted) / 1_000);
    report.overall = {
      totalAttempts,
      resolvedAttempts: resolvedAttempts.length,
      connected: connected.length,
      failed: failed.length,
      interrupted: attempts.filter(
        (attempt) => attempt.status === 'interrupted',
      ).length,
      successRatePercent:
        resolvedAttempts.length === 0
          ? 0
          : round((connected.length / resolvedAttempts.length) * 100),
      failureRatePercent:
        resolvedAttempts.length === 0
          ? 0
          : round((failed.length / resolvedAttempts.length) * 100),
      unexpectedDisconnects: unexpectedDisconnects.length,
      activeConnectionsBeforeCleanup,
      peakActiveConnections,
      peakPendingConnectionAttempts: peakPendingAttempts,
      durationSeconds,
      averageAttemptRatePerSecond:
        durationSeconds === 0 ? null : round(totalAttempts / durationSeconds),
      averageSuccessfulConnectionsPerSecond:
        durationSeconds === 0
          ? null
          : round(connected.length / durationSeconds),
      averageFailedConnectionsPerSecond:
        durationSeconds === 0 ? null : round(failed.length / durationSeconds),
      connectionAttemptLatencyMs: summarizeLatencies(
        resolvedAttempts.map((attempt) => attempt.latencyMs),
      ),
      connectionEstablishmentLatencyMs: summarizeLatencies(
        connected.map((attempt) => attempt.latencyMs),
      ),
      failedAttemptLatencyMs: summarizeLatencies(
        failed.map((attempt) => attempt.latencyMs),
      ),
    };

    const resultsDirectory = path.join(SCRIPT_DIR, 'results');
    await mkdir(resultsDirectory, { recursive: true });
    const fileTimestamp = report.startedAt.replace(/[:.]/g, '-');
    const reportPath = path.join(
      resultsDirectory,
      `connection-request-${profile.name}-${fileTimestamp}.json`,
    );
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    console.log(`\nReport saved to ${reportPath}`);
    if (report.interrupted) {
      process.exitCode = 130;
    } else if (stopReason) {
      process.exitCode = 1;
    }
  }
}
