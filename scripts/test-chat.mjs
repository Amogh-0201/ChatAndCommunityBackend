import { io } from 'socket.io-client';

const [userA, userB] = process.argv.slice(2);

if (!userA || !userB) {
  console.error(
    'Usage: node scripts/test-chat.mjs <userA-uuid> <userB-uuid>',
  );
  process.exit(1);
}

const baseURL = 'http://localhost:3000';

const clientA = io(baseURL, {autoConnect: false});
const clientB = io(baseURL, {autoConnect: false});

function connect(socket) {
    return new Promise((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
        socket.connect();
    });
}

function emitAck(socket, event, payload) {
    return new Promise((resolve, reject) => {
    socket.timeout(5000).emit(
        event,
        payload,
        (error, response) => {
            if (error) reject(error);
            else resolve(response);
        }
    );
  });
}

async function main() {
    try {
        await Promise.all([
            connect(clientA),
            connect(clientB)
        ]);

        console.log(
            'Client A joined:',
            await emitAck(clientA, 'user:join', {
                userId: userA
            })
        );

        console.log(
            'Client B joined:',
            await emitAck(clientB, 'user:join', {
                userId: userB
            })
        );

        const receivedPromise = new Promise((resolve, reject) => {
            const timer = setTimeout(
                () => reject(new Error('Recipient timed out')),
                5000,
            );

            clientB.once('message:new', (message) => {
                clearTimeout(timer);
                resolve(message);
            });
        });

        const result = await emitAck(clientA, 'message:send', {
            recipientId: userB,
            content: "Hello from web socket"
        });

        console.log('Sender ACK:', result);

        if (!result.ok) {
            throw new Error(result.error);
        }

        console.log(
            'Client B received:',
            await receivedPromise,
        );

    } catch(error) {
        console.error(error);
        process.exitCode = 1;
    } finally {
        clientA.disconnect();
        clientB.disconnect();
    }
}

main();