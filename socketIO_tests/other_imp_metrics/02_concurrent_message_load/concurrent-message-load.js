import { performance } from 'node:perf_hooks';
import {
  DELIVERY_TIMEOUT_MS,
  WARMUP_OPERATIONS,
  delay,
  emitAck,
  loadFixtures,
  runBenchmark,
  summarizeLatencies,
  validateDirectConversation,
  waitUntil,
} from '../benchmark-common.js';

const profiles = {
  baseline: { clients: 10, senders: 5, messagesPerSender: 20 },
  light: { clients: 20, senders: 10, messagesPerSender: 30 },
  moderate: { clients: 50, senders: 25, messagesPerSender: 30 },
  heavy: { clients: 100, senders: 50, messagesPerSender: 30 },
  ultra: { clients: 500, senders: 250, messagesPerSender: 50 }
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

const delayMinMs = Number(process.env.MESSAGE_DELAY_MIN_MS || 100);
const delayMaxMs = Number(process.env.MESSAGE_DELAY_MAX_MS || 300);
if (
  !Number.isInteger(delayMinMs) ||
  !Number.isInteger(delayMaxMs) ||
  delayMinMs < 100 ||
  delayMaxMs > 300 ||
  delayMinMs > delayMaxMs
) {
  throw new Error(
    'MESSAGE_DELAY_MIN_MS and MESSAGE_DELAY_MAX_MS must be integers within 100-300, with minimum <= maximum.',
  );
}

await runBenchmark({
  testName: 'concurrent-message-load',
  configuration: {
    profile: profileName,
    ...profile,
    messageDelayMs: { min: delayMinMs, max: delayMaxMs },
    warmupOperationsPerSender: WARMUP_OPERATIONS,
    deliveryTimeoutMs: DELIVERY_TIMEOUT_MS,
  },
  execute: async ({ report, connect, runId, target }) => {
    const fixtures = await loadFixtures({ direct: true });
    const directPairs = fixtures.directConversations.slice(0, profile.senders);
    if (directPairs.length !== profile.senders) {
      throw new Error(
        `Need ${profile.senders} direct conversations; found ${directPairs.length}. Run scripts/create-conversation-test-direct.mjs first.`,
      );
    }

    const pairs = directPairs.map((conversation, index) => {
      const sender = fixtures.tokenFor(conversation.userAUsername);
      const receiver = fixtures.tokenFor(conversation.userBUsername);
      if (
        sender.id !== conversation.userAId ||
        receiver.id !== conversation.userBId ||
        sender.id === receiver.id
      ) {
        throw new Error(
          `Direct conversation pair ${index + 1} has invalid or mismatched users.`,
        );
      }
      return { conversation, sender, receiver, index };
    });
    await Promise.all(
      pairs.map(({ conversation, sender, receiver }) =>
        validateDirectConversation(target, conversation, sender, receiver),
      ),
    );

    const userIds = pairs.flatMap(({ sender, receiver }) => [
      sender.id,
      receiver.id,
    ]);
    if (new Set(userIds).size !== userIds.length) {
      throw new Error('Direct-conversation pairs must use distinct users.');
    }

    const clients = await connect(
      pairs.flatMap(({ sender, receiver }) => [sender, receiver]),
    );
    report.summary.activeConnectionsDuringRun = clients.filter(
      (client) => client.socket.connected,
    ).length;

    const marker = `socketio-benchmark:${runId}:`;
    const received = [];
    for (const pair of pairs) {
      pair.receiverClient = clients.find(
        (client) => client.id === pair.receiver.id,
      );
      pair.senderClient = clients.find(
        (client) => client.id === pair.sender.id,
      );
      pair.receiverClient.socket.on('message:new', (message) => {
        if (
          typeof message?.content === 'string' &&
          message.content.startsWith(marker)
        ) {
          received.push({
            id: message.id,
            content: message.content,
            socketId: pair.receiverClient.socket.id,
            receivedAt: performance.now(),
          });
        }
      });
    }

    let sequence = 0;
    const sendOne = async (pair, warmup) => {
      sequence++;
      const content = `${marker}${warmup ? 'warmup' : 'measured'}:${sequence}`;
      const sendStart = performance.now();
      const result = await emitAck(pair.senderClient.socket, 'message:send', {
        conversationId: pair.conversation.id,
        content,
      });
      if (
        result.timedOut ||
        result.response?.ok !== true ||
        typeof result.response?.message?.id !== 'string' ||
        result.response.message.content !== content
      ) {
        if (warmup) {
          throw new Error(
            `Warm-up message failed for ${pair.sender.username}.`,
          );
        }
        return {
          success: false,
          timedOut: result.timedOut,
          latencyMs: result.latencyMs,
        };
      }
      return {
        success: true,
        id: result.response.message.id,
        sendStart,
        latencyMs: result.latencyMs,
        content,
      };
    };

    for (let warmup = 0; warmup < WARMUP_OPERATIONS; warmup++) {
      const warmupResults = await Promise.all(
        pairs.map((pair) => sendOne(pair, true)),
      );
      const warmupIds = new Set(warmupResults.map((result) => result.id));
      if (
        !(await waitUntil(() => {
          const delivered = new Set(
            received
              .filter((event) => event.content.includes(':warmup:'))
              .map((event) => event.id),
          );
          return [...warmupIds].every((id) => delivered.has(id));
        }, DELIVERY_TIMEOUT_MS))
      ) {
        throw new Error('Warm-up messages were not all delivered.');
      }
    }

    const ackLatencies = [];
    const measuredRecords = [];
    let failedAcknowledgements = 0;
    let acknowledgementTimeouts = 0;
    const workloadStarted = performance.now();
    await Promise.all(
      pairs.map(async (pair) => {
        for (
          let messageNumber = 0;
          messageNumber < profile.messagesPerSender;
          messageNumber++
        ) {
          const result = await sendOne(pair, false);
          if (result.latencyMs !== null) ackLatencies.push(result.latencyMs);
          if (result.success) {
            measuredRecords.push(result);
          } else {
            failedAcknowledgements++;
            if (result.timedOut) acknowledgementTimeouts++;
          }
          if (messageNumber + 1 < profile.messagesPerSender) {
            const randomDelay =
              delayMinMs +
              Math.floor(Math.random() * (delayMaxMs - delayMinMs + 1));
            await delay(randomDelay);
          }
        }
      }),
    );
    const workloadEnded = performance.now();

    const deliveryDeadline = performance.now() + DELIVERY_TIMEOUT_MS;
    const acknowledgedIds = new Set(measuredRecords.map((record) => record.id));
    let lastDeliveryAt = performance.now();
    let observedEventCount = received.length;
    while (performance.now() < deliveryDeadline) {
      const deliveredIds = new Set(
        received
          .filter((event) => acknowledgedIds.has(event.id))
          .map((event) => event.id),
      );
      if (
        acknowledgementTimeouts === 0 &&
        deliveredIds.size === measuredRecords.length &&
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

    const recordsById = new Map(
      measuredRecords.map((record) => [record.id, record]),
    );
    const deliveryLatencies = [];
    const measuredEvents = received.filter((event) =>
      event.content.includes(':measured:'),
    );
    const firstByDeliveryKey = new Set();
    for (const event of measuredEvents) {
      const key = `${event.id}:${event.socketId}`;
      if (firstByDeliveryKey.has(key)) continue;
      firstByDeliveryKey.add(key);
      const record = recordsById.get(event.id);
      if (record) deliveryLatencies.push(event.receivedAt - record.sendStart);
    }
    const uniqueDeliveryKeys = new Set(
      measuredEvents.map((event) => `${event.id}:${event.socketId}`),
    );
    const deliveredMessageIds = new Set(
      measuredEvents.map((event) => event.id),
    );
    const attemptedMessages = profile.senders * profile.messagesPerSender;
    const workloadSeconds = (workloadEnded - workloadStarted) / 1_000;

    report.summary = {
      profile: profileName,
      connectedClients: report.summary.activeConnectionsDuringRun,
      activeConnectionsDuringRun: report.summary.activeConnectionsDuringRun,
      senders: profile.senders,
      totalAttemptedMessages: attemptedMessages,
      successfulAcknowledgements: measuredRecords.length,
      failedAcknowledgements,
      acknowledgementTimeouts,
      messagesReceived: deliveredMessageIds.size,
      missingMessages: Math.max(
        0,
        attemptedMessages - deliveredMessageIds.size,
      ),
      duplicateMessages: Math.max(
        0,
        measuredEvents.length - uniqueDeliveryKeys.size,
      ),
      achievedMessagesPerSecond:
        workloadSeconds > 0
          ? Math.round((measuredRecords.length / workloadSeconds) * 100) / 100
          : null,
      workloadDurationSeconds: Math.round(workloadSeconds * 100) / 100,
    };
    report.latencyMs = {
      acknowledgement: summarizeLatencies(ackLatencies),
      recipientDelivery: summarizeLatencies(deliveryLatencies),
    };
  },
});
