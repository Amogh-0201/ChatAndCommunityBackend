import { performance } from 'node:perf_hooks';
import {
  DELIVERY_TIMEOUT_MS,
  WARMUP_OPERATIONS,
  delay,
  emitAck,
  loadFixtures,
  requireGroup,
  runBenchmark,
  summarizeLatencies,
  validateGroupConversation,
  waitUntil,
} from '../benchmark-common.js';

const profiles = {
  baseline: { clients: 10, workload: 100 },
  light: { clients: 25, workload: 250 },
  moderate: { clients: 50, workload: 500 },
};
const profileName = (
  process.env.PROFILE ||
  process.argv[2] ||
  'baseline'
).toLowerCase();
const profile = profiles[profileName];
if (!profile) {
  throw new Error(
    `PROFILE must be one of: ${Object.keys(profiles).join(', ')}.`,
  );
}

const scenario = (process.env.SCENARIO || 'typing').toLowerCase();
const scenarios = [
  'typing',
  'join-leave',
  'presence-snapshots',
  'presence-transitions',
];
if (!scenarios.includes(scenario)) {
  throw new Error(`SCENARIO must be one of: ${scenarios.join(', ')}.`);
}

function installSnapshotListener({ socket }) {
  const record = { events: [], connectionStartedAt: performance.now() };
  socket.on('presence:snapshot', (payload) => {
    record.events.push({
      payload,
      receivedAt: performance.now(),
    });
  });
  return record;
}

function snapshotLatencySummary(clients, records) {
  const initialLatencies = [];
  for (const client of clients) {
    const record = records.get(client.socket);
    if (record?.events[0]) {
      initialLatencies.push(
        record.events[0].receivedAt - record.connectionStartedAt,
      );
    }
  }
  return {
    received: initialLatencies.length,
    missing: Math.max(0, clients.length - initialLatencies.length),
    latencyMs: summarizeLatencies(initialLatencies),
  };
}

async function connectGroupUsers(connect, users) {
  const snapshots = new Map();
  const clients = await connect(users, (client) => {
    snapshots.set(client.socket, installSnapshotListener(client));
  });
  await waitUntil(
    () =>
      clients.every((client) => snapshots.get(client.socket)?.events.length),
    DELIVERY_TIMEOUT_MS,
  );
  return { clients, snapshots };
}

async function sendRoomOperation({ client, event, conversationId, snapshots }) {
  const record = snapshots.get(client.socket);
  const previousSnapshotCount = record.events.length;
  const startedAt = performance.now();
  const result = await emitAck(client.socket, event, { conversationId });
  await waitUntil(
    () => record.events.length > previousSnapshotCount,
    DELIVERY_TIMEOUT_MS,
  );
  const snapshot = record.events[previousSnapshotCount];
  return {
    result,
    snapshotLatencyMs: snapshot ? snapshot.receivedAt - startedAt : null,
  };
}

async function runTyping({ report, connect, target }) {
  const fixtures = await loadFixtures({ groups: true });
  const group = requireGroup(fixtures, profile.clients);
  await validateGroupConversation(target, group, group.members);
  const { clients, snapshots } = await connectGroupUsers(
    connect,
    group.members,
  );
  const joined = await Promise.all(
    clients.map((client) =>
      emitAck(client.socket, 'conversation:join', {
        conversationId: group.id,
      }),
    ),
  );
  if (
    joined.some((result) => result.timedOut || result.response?.ok !== true)
  ) {
    throw new Error(
      'All clients must join the group before typing measurements.',
    );
  }

  let activeOperation = null;
  for (const recipient of clients) {
    for (const event of ['typing:started', 'typing:stopped']) {
      recipient.socket.on(event, (payload) => {
        const operation = activeOperation;
        if (
          !operation ||
          operation.event !== event ||
          operation.senderId !== payload?.userId ||
          payload?.conversationId !== group.id
        ) {
          return;
        }
        operation.eventCount++;
        if (!operation.receivedBySocket.has(recipient.socket.id)) {
          operation.receivedBySocket.add(recipient.socket.id);
          operation.deliveryLatencies.push(
            performance.now() - operation.startedAt,
          );
        }
      });
    }
  }

  const measured = [];
  const ackLatencies = { start: [], stop: [] };
  let failedAcknowledgements = 0;
  let acknowledgementTimeouts = 0;
  const sendTyping = async (client, event, warmup) => {
    const startedAt = performance.now();
    const operation = {
      event: event === 'typing:start' ? 'typing:started' : 'typing:stopped',
      senderId: client.id,
      startedAt,
      eventCount: 0,
      receivedBySocket: new Set(),
      deliveryLatencies: [],
    };
    activeOperation = operation;
    const result = await emitAck(client.socket, event, {
      conversationId: group.id,
    });
    await waitUntil(
      () => operation.receivedBySocket.size >= clients.length - 1,
      DELIVERY_TIMEOUT_MS,
    );
    activeOperation = null;
    if (warmup) {
      if (result.timedOut || result.response?.ok !== true) {
        throw new Error(`${event} warm-up failed.`);
      }
      if (operation.receivedBySocket.size < clients.length - 1) {
        throw new Error(`${event} warm-up delivery timed out.`);
      }
      return;
    }
    const kind = event === 'typing:start' ? 'start' : 'stop';
    if (result.latencyMs !== null) ackLatencies[kind].push(result.latencyMs);
    if (result.timedOut || result.response?.ok !== true) {
      failedAcknowledgements++;
      if (result.timedOut) acknowledgementTimeouts++;
    }
    measured.push({ ...operation, kind });
  };

  for (let index = 0; index < WARMUP_OPERATIONS; index++) {
    const sender = clients[index % clients.length];
    await sendTyping(sender, 'typing:start', true);
    await sendTyping(sender, 'typing:stop', true);
  }

  const workloadStarted = performance.now();
  for (let pair = 0; pair < profile.workload; pair++) {
    const sender = clients[pair % clients.length];
    await sendTyping(sender, 'typing:start', false);
    await sendTyping(sender, 'typing:stop', false);
  }
  const workloadSeconds = (performance.now() - workloadStarted) / 1_000;

  const startDeliveries = measured
    .filter((operation) => operation.kind === 'start')
    .flatMap((operation) => operation.deliveryLatencies);
  const stopDeliveries = measured
    .filter((operation) => operation.kind === 'stop')
    .flatMap((operation) => operation.deliveryLatencies);
  const expectedEvents = measured.length * (clients.length - 1);
  const actualEvents = measured.reduce(
    (total, operation) => total + operation.eventCount,
    0,
  );
  const uniqueEvents = measured.reduce(
    (total, operation) => total + operation.receivedBySocket.size,
    0,
  );
  const initialSnapshots = snapshotLatencySummary(clients, snapshots);
  report.summary = {
    scenario,
    profile: profileName,
    connectedClients: clients.length,
    typingPairsAttempted: profile.workload,
    typingStartStopEventsAttempted: measured.length,
    successfulAcknowledgements: measured.length - failedAcknowledgements,
    failedAcknowledgements,
    acknowledgementTimeouts,
    expectedReceiverEvents: expectedEvents,
    actualReceiverEvents: actualEvents,
    missingReceiverEvents: Math.max(0, expectedEvents - uniqueEvents),
    duplicateReceiverEvents: Math.max(0, actualEvents - uniqueEvents),
    operationsPerSecond:
      workloadSeconds > 0
        ? Math.round((measured.length / workloadSeconds) * 100) / 100
        : null,
    activeConnectionsDuringRun: clients.length,
    groupId: group.id,
    initialPresenceSnapshotsReceived: initialSnapshots.received,
    missingInitialPresenceSnapshots: initialSnapshots.missing,
  };
  report.latencyMs = {
    typingStartAcknowledgement: summarizeLatencies(ackLatencies.start),
    typingStopAcknowledgement: summarizeLatencies(ackLatencies.stop),
    typingStartedDelivery: summarizeLatencies(startDeliveries),
    typingStoppedDelivery: summarizeLatencies(stopDeliveries),
  };
  report.latencyMs.initialSnapshotFromConnectStart = initialSnapshots.latencyMs;
}

async function runJoinLeave({ report, connect, target }) {
  const fixtures = await loadFixtures({ groups: true });
  const group = requireGroup(fixtures, profile.clients);
  await validateGroupConversation(target, group, group.members);
  const { clients, snapshots } = await connectGroupUsers(
    connect,
    group.members,
  );
  const actor = clients[0];
  const joinLatencies = [];
  const leaveLatencies = [];
  const joinSnapshotLatencies = [];
  let successfulJoins = 0;
  let failedJoins = 0;
  let joinTimeouts = 0;
  let successfulLeaves = 0;
  let failedLeaves = 0;
  let leaveTimeouts = 0;
  let missingJoinSnapshots = 0;

  const cycle = async (warmup) => {
    const join = await sendRoomOperation({
      client: actor,
      event: 'conversation:join',
      conversationId: group.id,
      snapshots,
    });
    if (!warmup) {
      if (join.result.latencyMs !== null)
        joinLatencies.push(join.result.latencyMs);
      if (join.result.timedOut || join.result.response?.ok !== true) {
        failedJoins++;
        if (join.result.timedOut) joinTimeouts++;
      } else {
        successfulJoins++;
      }
      if (join.snapshotLatencyMs === null) {
        missingJoinSnapshots++;
      } else {
        joinSnapshotLatencies.push(join.snapshotLatencyMs);
      }
    } else if (join.result.timedOut || join.result.response?.ok !== true) {
      throw new Error('Conversation join warm-up failed.');
    } else if (join.snapshotLatencyMs === null) {
      throw new Error('Conversation join warm-up snapshot timed out.');
    }

    const leave = await emitAck(actor.socket, 'conversation:leave', {
      conversationId: group.id,
    });
    if (!warmup) {
      if (leave.latencyMs !== null) leaveLatencies.push(leave.latencyMs);
      if (leave.timedOut || leave.response?.ok !== true) {
        failedLeaves++;
        if (leave.timedOut) leaveTimeouts++;
      } else {
        successfulLeaves++;
      }
    } else if (leave.timedOut || leave.response?.ok !== true) {
      throw new Error('Conversation leave warm-up failed.');
    }
  };

  for (let index = 0; index < WARMUP_OPERATIONS; index++) {
    await cycle(true);
  }

  const workloadStarted = performance.now();
  for (let index = 0; index < profile.workload; index++) {
    await cycle(false);
  }
  const workloadSeconds = (performance.now() - workloadStarted) / 1_000;
  const attemptedOperations = profile.workload * 2;
  const initialSnapshots = snapshotLatencySummary(clients, snapshots);
  report.summary = {
    scenario,
    profile: profileName,
    connectedClients: clients.length,
    joinLeaveCyclesAttempted: profile.workload,
    joinAttempts: profile.workload,
    successfulJoins,
    failedJoins,
    joinTimeouts,
    leaveAttempts: profile.workload,
    successfulLeaves,
    failedLeaves,
    leaveTimeouts,
    joinPresenceSnapshotsReceived: joinSnapshotLatencies.length,
    missingJoinPresenceSnapshots: missingJoinSnapshots,
    totalJoinLeaveOperationsPerSecond:
      workloadSeconds > 0
        ? Math.round((attemptedOperations / workloadSeconds) * 100) / 100
        : null,
    activeConnectionsDuringRun: clients.length,
    groupId: group.id,
    initialPresenceSnapshotsReceived: initialSnapshots.received,
    missingInitialPresenceSnapshots: initialSnapshots.missing,
  };
  report.latencyMs = {
    joinAcknowledgement: summarizeLatencies(joinLatencies),
    leaveAcknowledgement: summarizeLatencies(leaveLatencies),
    joinPresenceSnapshot: summarizeLatencies(joinSnapshotLatencies),
    initialSnapshotFromConnectStart: initialSnapshots.latencyMs,
  };
}

async function runPresenceSnapshots({ report, connect, target }) {
  const fixtures = await loadFixtures({ groups: true });
  const group = requireGroup(fixtures, profile.clients);
  await validateGroupConversation(target, group, group.members);
  const { clients, snapshots } = await connectGroupUsers(
    connect,
    group.members,
  );
  const responseLatencies = [];
  const acknowledgementLatencies = [];
  let successfulSnapshots = 0;
  let failedSnapshots = 0;
  let snapshotTimeouts = 0;
  let missingResponses = 0;

  const requestSnapshot = async (index, warmup) => {
    const client = clients[index % clients.length];
    const record = snapshots.get(client.socket);
    const previousCount = record.events.length;
    const startedAt = performance.now();
    const result = await emitAck(client.socket, 'presence:get-snapshot');
    await waitUntil(
      () => record.events.length > previousCount,
      DELIVERY_TIMEOUT_MS,
    );
    const event = record.events[previousCount];
    if (warmup) {
      if (result.timedOut || result.response?.ok !== true || !event) {
        throw new Error('Presence snapshot warm-up failed.');
      }
      return;
    }
    if (result.latencyMs !== null) {
      acknowledgementLatencies.push(result.latencyMs);
    }
    if (result.timedOut || result.response?.ok !== true) {
      failedSnapshots++;
      if (result.timedOut) snapshotTimeouts++;
    } else {
      successfulSnapshots++;
    }
    if (event) {
      responseLatencies.push(event.receivedAt - startedAt);
    } else {
      missingResponses++;
    }
  };

  for (let index = 0; index < WARMUP_OPERATIONS; index++) {
    await requestSnapshot(index, true);
  }
  const workloadStarted = performance.now();
  for (let index = 0; index < profile.workload; index++) {
    await requestSnapshot(index, false);
  }
  const workloadSeconds = (performance.now() - workloadStarted) / 1_000;
  const initialSnapshots = snapshotLatencySummary(clients, snapshots);

  report.summary = {
    scenario,
    profile: profileName,
    connectedClients: clients.length,
    snapshotRequestsAttempted: profile.workload,
    successfulSnapshotAcknowledgements: successfulSnapshots,
    failedSnapshotAcknowledgements: failedSnapshots,
    snapshotTimeouts,
    snapshotResponsesReceived: responseLatencies.length,
    missingSnapshotResponses: missingResponses,
    snapshotOperationsPerSecond:
      workloadSeconds > 0
        ? Math.round((profile.workload / workloadSeconds) * 100) / 100
        : null,
    activeConnectionsDuringRun: clients.length,
    groupId: group.id,
    initialPresenceSnapshotsReceived: initialSnapshots.received,
    missingInitialPresenceSnapshots: initialSnapshots.missing,
  };
  report.latencyMs = {
    snapshotResponse: summarizeLatencies(responseLatencies),
    snapshotAcknowledgement: summarizeLatencies(acknowledgementLatencies),
    initialSnapshotFromConnectStart: initialSnapshots.latencyMs,
  };
}

async function runPresenceTransitions({ report, connect, disconnect, target }) {
  const fixtures = await loadFixtures({ groups: true });
  const group = requireGroup(fixtures, 2);
  await validateGroupConversation(target, group, group.members);
  const [actor, observer] = group.members;
  const events = [];
  const snapshots = new Map();
  const installObserverListeners = (client) => {
    snapshots.set(client.socket, installSnapshotListener(client));
    if (client.id === observer.id) {
      for (const event of ['presence:online', 'presence:offline']) {
        client.socket.on(event, (payload) => {
          if (payload?.userId === actor.id) {
            events.push({
              event,
              receivedAt: performance.now(),
            });
          }
        });
      }
    }
  };

  const observerClient = (
    await connect([observer], installObserverListeners)
  )[0];
  const observerSnapshot = snapshots.get(observerClient.socket);
  await waitUntil(
    () => observerSnapshot.events.length > 0,
    DELIVERY_TIMEOUT_MS,
  );
  if (!observerSnapshot.events[0]) {
    throw new Error('Observer did not receive its initial presence snapshot.');
  }
  if (observerSnapshot.events[0].payload?.onlineUserIds?.includes(actor.id)) {
    throw new Error(
      'The transition-test user is already online; use an isolated test session.',
    );
  }

  const onlineRequestedAt = performance.now();
  const firstActorSocket = (
    await connect([actor], installObserverListeners)
  )[0];
  const onlineConnectedAt = performance.now();
  await waitUntil(
    () => events.some((entry) => entry.event === 'presence:online'),
    DELIVERY_TIMEOUT_MS,
  );
  const onlineEvent = events.find((entry) => entry.event === 'presence:online');
  const secondActorSocket = (
    await connect([actor], installObserverListeners)
  )[0];
  await delay(250);

  await disconnect(firstActorSocket);
  await delay(250);
  const offlineBeforeFinalDisconnect = events.filter(
    (entry) => entry.event === 'presence:offline',
  ).length;

  const offlineStartedAt = performance.now();
  await disconnect(secondActorSocket);
  await waitUntil(
    () =>
      events.filter((entry) => entry.event === 'presence:offline').length >
      offlineBeforeFinalDisconnect,
    DELIVERY_TIMEOUT_MS,
  );
  const offlineEvents = events.filter(
    (entry) => entry.event === 'presence:offline',
  );

  const onlineEvents = events.filter(
    (entry) => entry.event === 'presence:online',
  );
  const finalOfflineEvent = offlineEvents.at(-1);
  const unexpectedDuplicateTransitions =
    Math.max(0, onlineEvents.length - 1) +
    Math.max(0, offlineEvents.length - 1) +
    offlineBeforeFinalDisconnect;
  const initialSnapshotLatency = snapshotLatencySummary(
    [observerClient],
    snapshots,
  );
  report.summary = {
    scenario,
    transitionUser: actor.username,
    observerUser: observer.username,
    firstSocketOnlineTransitions: onlineEvents.length,
    offlineTransitionsAfterFirstSocketDisconnect: offlineBeforeFinalDisconnect,
    offlineTransitionsAfterFinalSocketDisconnect: offlineEvents.length,
    unexpectedDuplicateTransitions,
    activeConnectionsDuringRun: 3,
    groupId: group.id,
    onlineEventBeforeConnectCallback:
      onlineEvent !== undefined && onlineEvent.receivedAt < onlineConnectedAt,
    firstSocketConnectDurationMs:
      Math.round((onlineConnectedAt - onlineRequestedAt) * 100) / 100,
    observerInitialSnapshotReceived: initialSnapshotLatency.received,
    observerInitialSnapshotMissing: initialSnapshotLatency.missing,
  };
  report.latencyMs = {
    onlineTransition: summarizeLatencies(
      onlineEvent && onlineEvent.receivedAt >= onlineConnectedAt
        ? [onlineEvent.receivedAt - onlineConnectedAt]
        : [],
    ),
    offlineTransition: summarizeLatencies(
      finalOfflineEvent && offlineBeforeFinalDisconnect === 0
        ? [finalOfflineEvent.receivedAt - offlineStartedAt]
        : [],
    ),
    observerInitialSnapshotFromConnectStart: initialSnapshotLatency.latencyMs,
  };
}

await runBenchmark({
  testName: `realtime-events-${scenario}`,
  configuration: {
    scenario,
    ...(scenario === 'presence-transitions'
      ? {
          profile: 'controlled',
          peakConnectedSockets: 3,
          observerSockets: 1,
          targetUserSockets: 2,
          transitionSequences: 1,
        }
      : { profile: profileName, ...profile }),
    warmupOperations:
      scenario === 'presence-transitions' ? 0 : WARMUP_OPERATIONS,
    deliveryTimeoutMs: DELIVERY_TIMEOUT_MS,
  },
  execute: async (context) => {
    if (scenario === 'typing') {
      await runTyping(context);
    } else if (scenario === 'join-leave') {
      await runJoinLeave(context);
    } else if (scenario === 'presence-snapshots') {
      await runPresenceSnapshots(context);
    } else {
      await runPresenceTransitions(context);
    }
  },
});
