
import { io } from 'socket.io-client';

const BASE_URL = (
  process.env.API_BASE_URL ?? 'http://localhost:3000'
).replace(/\/$/, '');

const TOKEN_A = process.env.USER_A_ACCESS_TOKEN;
const TOKEN_B = process.env.USER_B_ACCESS_TOKEN;
const TIMEOUT_MS = Number(process.env.TEST_TIMEOUT_MS ?? 7000);

if (!TOKEN_A || !TOKEN_B) {
  console.error(
    'Set USER_A_ACCESS_TOKEN and USER_B_ACCESS_TOKEN first.',
  );
  process.exit(1);
}

async function getCurrentUser(token, label) {
  const response = await fetch(`${BASE_URL}/user/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      `${label}: GET /user/me failed (${response.status}): ` +
      JSON.stringify(body),
    );
  }

  if (!body?.id) {
    throw new Error(`${label}: response did not contain a user ID.`);
  }

  return body;
}

function connectSocket(socket, label) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      socket.off('connect', onConnect);
      socket.off('connect_error', onConnectError);
    };

    const onConnect = () => {
      cleanup();
      resolve();
    };

    const onConnectError = (error) => {
      cleanup();
      reject(
        new Error(`${label} connection failed: ${error.message}`),
      );
    };

    const timer = setTimeout(() => {
      cleanup();
      socket.disconnect();
      reject(new Error(`${label} connection timed out.`));
    }, TIMEOUT_MS);

    socket.once('connect', onConnect);
    socket.once('connect_error', onConnectError);

    // Starts the Socket.IO connection and sends the auth token.
    socket.connect();
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.timeout(TIMEOUT_MS).emit(
      event,
      payload,
      (error, response) => {
        if (error) {
          reject(
            new Error(`No acknowledgement received for "${event}".`),
          );
          return;
        }

        resolve(response);
      },
    );
  });
}

function waitForMessage(socket) {
  let timer;
  let handler;

  const promise = new Promise((resolve, reject) => {
    handler = (message) => {
      clearTimeout(timer);
      resolve(message);
    };

    // Listen before sending, so we don't miss a fast response.
    socket.once('message:new', handler);

    timer = setTimeout(() => {
      socket.off('message:new', handler);
      reject(
        new Error('Client B did not receive message:new in time.'),
      );
    }, TIMEOUT_MS);
  });

  return {
    promise,
    cancel() {
      clearTimeout(timer);
      if (handler) {
        socket.off('message:new', handler);
      }
    },
  };
}

async function main() {
  let clientA;
  let clientB;

  try {
    // Fetch each identity using its own access token.
    const [userA, userB] = await Promise.all([
      getCurrentUser(TOKEN_A, 'User A'),
      getCurrentUser(TOKEN_B, 'User B'),
    ]);

    if (userA.id === userB.id) {
      throw new Error(
        'Both tokens belong to the same user. Use two different accounts.',
      );
    }

    console.log('User A:', userA.username, userA.id);
    console.log('User B:', userB.username, userB.id);

    // Each socket authenticates as the user represented by its token.
    clientA = io(BASE_URL, {
      autoConnect: false,
      auth: { token: TOKEN_A },
    });

    clientB = io(BASE_URL, {
      autoConnect: false,
      auth: { token: TOKEN_B },
    });

    await Promise.all([
      connectSocket(clientA, 'Client A'),
      connectSocket(clientB, 'Client B'),
    ]);

    console.log('PASS: both sockets connected and authenticated.');

    for (const [label, socket] of [
        ['Client A', clientA],
        ['Client B', clientB],
        ]) {
        socket.on('exception', (error) => {
            console.error(`[${label}] WebSocket exception:`, error);
        });

        socket.on('disconnect', (reason) => {
            console.log(`[${label}] Disconnected:`, reason);
        });

        socket.on('connect_error', (error) => {
            console.error(`[${label}] Connection error:`, error.message);
        });
    }

    // Set up the recipient listener BEFORE sending the message.
    const messageWaiter = waitForMessage(clientB);

    // Avoid an unhandled rejection if the ACK fails first.
    messageWaiter.promise.catch(() => {});

    try {
      const content =
        `WebSocket test message ${new Date().toISOString()}`;

      // No senderId is sent. The server gets it from the JWT.
      const ack = await emitAck(clientA, 'message:send', {
        recipientId: userB.id,
        content,
      });

      console.log('Sender acknowledgement:', ack);

      if (!ack?.ok || !ack.message?.id) {
        throw new Error(
          ack?.error ?? 'The server did not confirm message creation.',
        );
      }

      console.log('PASS: server acknowledged the message.');

      const received = await messageWaiter.promise;

      console.log('Recipient received:', received);

      if (received.id !== ack.message.id) {
        throw new Error(
          'The received message ID does not match the acknowledged message.',
        );
      }

      console.log('PASS: recipient received the correct message.');

      // Verify that the message is available through REST history too.
      const historyResponse = await fetch(
        `${BASE_URL}/messages/between/${encodeURIComponent(userB.id)}`,
        {
          headers: {
            Authorization: `Bearer ${TOKEN_A}`,
          },
        },
      );

      const history = await historyResponse
        .json()
        .catch(() => null);

      if (!historyResponse.ok) {
        throw new Error(
          `Conversation history failed (${historyResponse.status}): ` +
          JSON.stringify(history),
        );
      }

      if (
        !Array.isArray(history) ||
        !history.some((message) => message.id === ack.message.id)
      ) {
        throw new Error(
          'The message was not found in conversation history.',
        );
      }

      console.log('PASS: message is persisted and appears in history.');
      console.log('\nAll chat integration checks passed.');
    } catch (error) {
      messageWaiter.cancel();
      throw error;
    }
  } finally {
    // Always close both test connections.
    clientA?.disconnect();
    clientB?.disconnect();
  }
}

main().catch((error) => {
  console.error('\nChat integration test failed:', error.message);
  process.exitCode = 1;
});
