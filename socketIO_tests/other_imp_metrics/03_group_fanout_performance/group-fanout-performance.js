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
} from '../benchmark-common.js';

const profiles = {
  baseline: { groupSize: 2, messages: 100 },
  small: { groupSize: 5, messages: 100 },
  medium: { groupSize: 10, messages: 100 },
  large: { groupSize: 25, messages: 100 },
  ultra: { groupSize: 50, messages: 500 }
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

await runBenchmark({
  testName: 'group-fanout-performance',
  configuration: {
    profile: profileName,
    ...profile,
    warmupOperations: WARMUP_OPERATIONS,
    deliveryTimeoutMs: DELIVERY_TIMEOUT_MS,
  },
  execute: async ({ report, connect, runId, target }) => {
    const fixtures = await loadFixtures({ groups: true });
    const group = requireGroup(fixtures, profile.groupSize);
    await validateGroupConversation(target, group, group.members);
    const senderUser = group.members.find(
      (member) => member.id === group.ownerId,
    );
    if (!senderUser) {
      throw new Error(
        `Group fixture owner is not a member of group ${group.id}.`,
      );
    }

    const clients = await connect(group.members);
    const sender = clients.find((client) => client.id === senderUser.id);
    const recipients = clients.filter((client) => client.id !== senderUser.id);
    if (!sender || recipients.length !== profile.groupSize - 1) {
      throw new Error(
        `Group ${group.id} has an unexpected connected membership.`,
      );
    }
    report.summary.activeConnectionsDuringRun = clients.filter(
      (client) => client.socket.connected,
    ).length;

    const marker = `socketio-benchmark:${runId}:`;
    const received = [];
    for (const recipient of recipients) {
      recipient.socket.on('message:new', (message) => {
        if (
          typeof message?.content === 'string' &&
          message.content.startsWith(marker)
        ) {
          received.push({
            id: message.id,
            content: message.content,
            socketId: recipient.socket.id,
            receivedAt: performance.now(),
          });
        }
      });
    }

    const measuredRecords = [];
    const ackLatencies = [];
    let acknowledgementTimeouts = 0;
    let failedAcknowledgements = 0;
    let sequence = 0;
    const sendOne = async (warmup) => {
      sequence++;
      const content = `${marker}${warmup ? 'warmup' : 'measured'}:${sequence}`;
      const sendStart = performance.now();
      const result = await emitAck(sender.socket, 'message:send', {
        conversationId: group.id,
        content,
      });
      if (!warmup && result.latencyMs !== null) {
        ackLatencies.push(result.latencyMs);
      }
      if (
        result.timedOut ||
        result.response?.ok !== true ||
        typeof result.response?.message?.id !== 'string' ||
        result.response.message.conversationId !== group.id ||
        result.response.message.content !== content
      ) {
        if (!warmup) {
          failedAcknowledgements++;
          if (result.timedOut) acknowledgementTimeouts++;
        } else {
          throw new Error('Group message warm-up failed.');
        }
        return null;
      }
      if (!warmup) {
        measuredRecords.push({
          id: result.response.message.id,
          sendStart,
        });
      }
      return result.response.message.id;
    };

    const warmupIds = [];
    for (let index = 0; index < WARMUP_OPERATIONS; index++) {
      const id = await sendOne(true);
      if (id) warmupIds.push(id);
    }
    if (warmupIds.length > 0) {
      const warmupDeadline = performance.now() + DELIVERY_TIMEOUT_MS;
      let allWarmupsDelivered = false;
      while (performance.now() < warmupDeadline) {
        const receivedWarmup = new Set(
          received
            .filter((event) => event.content.includes(':warmup:'))
            .map((event) => event.id),
        );
        if (warmupIds.every((id) => receivedWarmup.has(id))) {
          allWarmupsDelivered = true;
          break;
        }
        await delay(25);
      }
      if (!allWarmupsDelivered) {
        throw new Error('Group message warm-up deliveries timed out.');
      }
    }

    const workloadStarted = performance.now();
    for (let index = 0; index < profile.messages; index++) {
      await sendOne(false);
    }
    const workloadEnded = performance.now();

    const expectedRecipients = new Set(
      recipients.map((recipient) => recipient.socket.id),
    );
    const deliveryDeadline = performance.now() + DELIVERY_TIMEOUT_MS;
    const acknowledgedIds = new Set(measuredRecords.map((record) => record.id));
    let lastDeliveryAt = performance.now();
    let observedEventCount = received.length;
    while (performance.now() < deliveryDeadline) {
      const receivedKeys = new Set(
        received
          .filter((event) => acknowledgedIds.has(event.id))
          .map((event) => `${event.id}:${event.socketId}`),
      );
      if (
        acknowledgementTimeouts === 0 &&
        receivedKeys.size >= measuredRecords.length * expectedRecipients.size &&
        performance.now() - lastDeliveryAt >= 200
      ) {
        break;
      }
      if (received.length !== observedEventCount) {
        observedEventCount = received.length;
        lastDeliveryAt = performance.now();
      }
      await delay(25);
    }
    const deliveryEnded = performance.now();

    const recordsById = new Map(
      measuredRecords.map((record) => [record.id, record]),
    );
    const measuredEvents = received.filter((event) =>
      event.content.includes(':measured:'),
    );
    const uniqueDeliveryKeys = new Set(
      measuredEvents.map((event) => `${event.id}:${event.socketId}`),
    );
    const firstEventByRecipient = new Set();
    const deliveryLatencies = [];
    for (const event of measuredEvents) {
      const key = `${event.id}:${event.socketId}`;
      if (firstEventByRecipient.has(key)) continue;
      firstEventByRecipient.add(key);
      const record = recordsById.get(event.id);
      if (record && expectedRecipients.has(event.socketId)) {
        deliveryLatencies.push(event.receivedAt - record.sendStart);
      }
    }

    const expectedDeliveryEvents = profile.messages * (profile.groupSize - 1);
    const deliveredKeys = new Set(
      measuredEvents
        .filter((event) => expectedRecipients.has(event.socketId))
        .map((event) => `${event.id}:${event.socketId}`),
    );
    const deliverySeconds = (deliveryEnded - workloadStarted) / 1_000;

    report.summary = {
      profile: profileName,
      groupId: group.id,
      groupSize: profile.groupSize,
      senderSockets: 1,
      messagesAttempted: profile.messages,
      acknowledgedMessages: measuredRecords.length,
      failedAcknowledgements,
      acknowledgementTimeouts,
      expectedRecipientDeliveryEvents: expectedDeliveryEvents,
      actualReceivedDeliveryEvents: measuredEvents.length,
      uniqueExpectedDeliveryEvents: deliveredKeys.size,
      missingDeliveries: Math.max(
        0,
        expectedDeliveryEvents - deliveredKeys.size,
      ),
      duplicateDeliveries: Math.max(
        0,
        measuredEvents.length - uniqueDeliveryKeys.size,
      ),
      totalDeliveryEventsPerSecond:
        deliverySeconds > 0
          ? Math.round((measuredEvents.length / deliverySeconds) * 100) / 100
          : null,
      activeConnectionsDuringRun: clients.length,
      senderSocketExcludedFromFanout: true,
      additionalSenderDevices: 0,
      workloadDurationSeconds:
        Math.round(((workloadEnded - workloadStarted) / 1_000) * 100) / 100,
    };
    report.latencyMs = {
      acknowledgement: summarizeLatencies(ackLatencies),
      perRecipientDelivery: summarizeLatencies(deliveryLatencies),
    };
  },
});
