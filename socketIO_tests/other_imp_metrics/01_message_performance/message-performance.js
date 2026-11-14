import { performance } from 'node:perf_hooks';
import {
  DELIVERY_TIMEOUT_MS,
  WARMUP_OPERATIONS,
  delay,
  emitAck,
  loadFixtures,
  requireDirectPair,
  runBenchmark,
  summarizeLatencies,
  validateDirectConversation,
  waitUntil,
} from '../benchmark-common.js';

const profiles = {
  baseline: { messages: 100, delayMs: 500 },
  light: { messages: 300, delayMs: 200 },
  moderate: { messages: 500, delayMs: 100 },
  heavy: { messages: 1_000, delayMs: 50 },
  ultra: { messages: 4_000, delayMs: 20 }
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
  testName: 'message-performance',
  configuration: {
    profile: profileName,
    ...profile,
    warmupOperations: WARMUP_OPERATIONS,
    ackTimeoutMs: Number(process.env.ACK_TIMEOUT_MS || 10_000),
    deliveryTimeoutMs: DELIVERY_TIMEOUT_MS,
  },
  execute: async ({ report, connect, runId, target }) => {
    const fixtures = await loadFixtures({ direct: true });
    const { conversation, first, second } = requireDirectPair(fixtures);
    await validateDirectConversation(target, conversation, first, second);
    const [sender, recipient] = await connect([first, second]);
    const marker = `socketio-benchmark:${runId}:`;
    const received = [];

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

    const ackLatencies = [];
    const sendRecords = [];
    let acknowledgementTimeouts = 0;
    let successfulAcknowledgements = 0;
    let failedAcknowledgements = 0;
    let sequence = 0;

    const sendOne = async (warmup) => {
      sequence++;
      const content = `${marker}${warmup ? 'warmup' : 'measured'}:${sequence}`;
      const sendStart = performance.now();
      const result = await emitAck(sender.socket, 'message:send', {
        conversationId: conversation.id,
        content,
      });
      if (!warmup && result.latencyMs !== null) {
        ackLatencies.push(result.latencyMs);
      }
      if (result.timedOut) {
        if (!warmup) {
          acknowledgementTimeouts++;
          failedAcknowledgements++;
        } else {
          throw new Error('Message warm-up acknowledgement timed out.');
        }
      } else if (
        result.response?.ok === true &&
        typeof result.response?.message?.id === 'string' &&
        result.response.message.conversationId === conversation.id &&
        result.response.message.content === content
      ) {
        if (!warmup) {
          successfulAcknowledgements++;
          sendRecords.push({
            id: result.response.message.id,
            content,
            sendStart,
          });
        }
        return result.response.message.id;
      } else {
        if (!warmup) {
          failedAcknowledgements++;
          report.errors.push({
            message: `message:send returned an unsuccessful or malformed acknowledgement for sequence ${sequence}.`,
            timestamp: new Date().toISOString(),
          });
        } else {
          throw new Error(
            'Message warm-up returned an unsuccessful acknowledgement.',
          );
        }
      }
    };

    const warmupIds = [];
    for (let index = 0; index < WARMUP_OPERATIONS; index++) {
      warmupIds.push(await sendOne(true));
    }
    if (
      warmupIds.length > 0 &&
      !(await waitUntil(() => {
        const receivedIds = new Set(received.map((event) => event.id));
        return warmupIds.every((id) => receivedIds.has(id));
      }, DELIVERY_TIMEOUT_MS))
    ) {
      throw new Error('Message warm-up deliveries timed out.');
    }

    const workloadStarted = performance.now();
    for (let index = 0; index < profile.messages; index++) {
      await sendOne(false);
      if (index + 1 < profile.messages) await delay(profile.delayMs);
    }
    const workloadEnded = performance.now();

    const deliveryDeadline = performance.now() + DELIVERY_TIMEOUT_MS;
    let lastDeliveryAt = performance.now();
    let observedEventCount = received.length;
    const acknowledgedIds = new Set(sendRecords.map((record) => record.id));
    while (performance.now() < deliveryDeadline) {
      const deliveredAcknowledgedIds = new Set(
        received
          .filter((event) => acknowledgedIds.has(event.id))
          .map((event) => event.id),
      );
      if (
        acknowledgementTimeouts === 0 &&
        deliveredAcknowledgedIds.size === sendRecords.length &&
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

    const firstEventById = new Map();
    for (const event of received) {
      if (!firstEventById.has(event.id)) firstEventById.set(event.id, event);
    }
    const acknowledgedRecords = new Map(
      sendRecords.map((record) => [record.id, record]),
    );
    const deliveryLatencies = [];
    for (const [id, event] of firstEventById) {
      const record = acknowledgedRecords.get(id);
      if (record) deliveryLatencies.push(event.receivedAt - record.sendStart);
    }

    const measuredEvents = received.filter((event) =>
      event.content.includes(':measured:'),
    );
    const measuredDeliveryKeys = new Set(
      measuredEvents.map((event) => `${event.id}:${event.socketId}`),
    );
    const deliveredMessageIds = new Set(
      measuredEvents.map((event) => event.id),
    );
    const workloadSeconds = (workloadEnded - workloadStarted) / 1_000;
    report.summary = {
      profile: profileName,
      totalAttemptedMessages: profile.messages,
      successfulAcknowledgements,
      failedAcknowledgements,
      acknowledgementTimeouts,
      messagesReceived: deliveredMessageIds.size,
      missingMessages: Math.max(0, profile.messages - deliveredMessageIds.size),
      duplicateMessages: Math.max(
        0,
        measuredEvents.length - measuredDeliveryKeys.size,
      ),
      actualMessageThroughputPerSecond:
        workloadSeconds > 0
          ? Math.round((successfulAcknowledgements / workloadSeconds) * 100) /
            100
          : null,
      conversationId: conversation.id,
      activeConnectionsDuringRun: 2,
    };
    report.latencyMs = {
      acknowledgement: summarizeLatencies(ackLatencies),
      recipientDelivery: summarizeLatencies(deliveryLatencies),
    };
  },
});
