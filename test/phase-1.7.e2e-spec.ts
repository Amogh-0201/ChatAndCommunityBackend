import { randomInt, randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/lib/database/prisma.service';

type UserKey = 'alice' | 'bob' | 'charlie';

type TestUser = {
  id: string;
  username: string;
  accessToken: string;
  refreshToken: string;
};

type AuthResponse = {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    username: string;
    name: string;
    phoneNumber: string;
  };
};

type Conversation = {
  id: string;
  type: 'DIRECT' | 'GROUP';
};

type ChatMessage = {
  id: string;
  senderId: string;
  conversationId: string;
  content: string;
};

type Ack<T> = {
  ok: boolean;
  error?: string;
  message?: T;
};

const socketTimeoutMs = 5000;

describe('Phase 1.7: REST and Socket.IO integration', () => {
  let app: INestApplication;
  let apiUrl: string;
  let prisma: PrismaService;
  let directConversation: Conversation;
  let groupConversation: Conversation;
  const users = new Map<UserKey, TestUser>();
  const registrationResponses = new Map<UserKey, AuthResponse>();
  const createdUserIds: string[] = [];
  const sockets = new Set<Socket>();

  const getUser = (key: UserKey): TestUser => {
    const user = users.get(key);
    if (!user) {
      throw new Error(`Test user ${key} was not initialized.`);
    }
    return user;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.listen(0, '127.0.0.1');

    const address = app.getHttpServer().address() as AddressInfo | null;
    if (!address || typeof address === 'string') {
      throw new Error(
        'Could not determine the integration-test server address.',
      );
    }
    apiUrl = `http://127.0.0.1:${address.port}`;
    prisma = app.get(PrismaService);

    const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
    const phoneSuffix = randomInt(100000000, 1000000000);
    const userData: Array<{
      key: UserKey;
      name: string;
      username: string;
      phoneNumber: string;
    }> = [
      {
        key: 'alice',
        name: 'Integration Alice',
        username: `phase17_a_${suffix}`,
        phoneNumber: `+1${phoneSuffix}1`,
      },
      {
        key: 'bob',
        name: 'Integration Bob',
        username: `phase17_b_${suffix}`,
        phoneNumber: `+1${phoneSuffix}2`,
      },
      {
        key: 'charlie',
        name: 'Integration Charlie',
        username: `phase17_c_${suffix}`,
        phoneNumber: `+1${phoneSuffix}3`,
      },
    ];

    for (const data of userData) {
      const response = await request(app.getHttpServer())
        .post('/auth/register')
        .send({
          name: data.name,
          username: data.username,
          phoneNumber: data.phoneNumber,
          password: 'integration-test-password',
        });

      if (response.status !== 201) {
        throw new Error(
          `Could not register ${data.key} for integration tests: ${JSON.stringify(response.body)}`,
        );
      }

      const auth = response.body as AuthResponse;
      createdUserIds.push(auth.user.id);
      registrationResponses.set(data.key, auth);
      users.set(data.key, {
        id: auth.user.id,
        username: auth.user.username,
        accessToken: auth.accessToken,
        refreshToken: auth.refreshToken,
      });
    }

    const alice = getUser('alice');
    const bob = getUser('bob');
    const charlie = getUser('charlie');

    const directResponse = await request(app.getHttpServer())
      .post(`/conversations/direct/${bob.id}`)
      .set('Authorization', `Bearer ${alice.accessToken}`);
    if (directResponse.status !== 201) {
      throw new Error(
        `Could not create the direct test conversation: ${JSON.stringify(directResponse.body)}`,
      );
    }
    directConversation = directResponse.body as Conversation;

    const groupResponse = await request(app.getHttpServer())
      .post('/conversations/groups')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ name: `Integration group ${suffix}`, joinPolicy: 'OPEN' });
    if (groupResponse.status !== 201) {
      throw new Error(
        `Could not create the group test conversation: ${JSON.stringify(groupResponse.body)}`,
      );
    }
    groupConversation = groupResponse.body as Conversation;

    for (const user of [bob, charlie]) {
      const joinResponse = await request(app.getHttpServer())
        .post(`/conversations/${groupConversation.id}/join`)
        .set('Authorization', `Bearer ${user.accessToken}`);
      if (joinResponse.status !== 201) {
        throw new Error(
          `Could not add a test user to the group: ${JSON.stringify(joinResponse.body)}`,
        );
      }
    }
  }, 30000);

  afterAll(async () => {
    for (const socket of sockets) {
      socket.disconnect();
    }

    try {
      if (createdUserIds.length > 0) {
        const ownedConversations = await prisma.conversation.findMany({
          where: { createdById: { in: createdUserIds } },
          select: { id: true },
        });
        const conversationIds = ownedConversations.map(
          (conversation) => conversation.id,
        );

        await prisma.message.deleteMany({
          where: {
            OR: [
              { senderId: { in: createdUserIds } },
              { conversationId: { in: conversationIds } },
            ],
          },
        });
        await prisma.conversation.deleteMany({
          where: { id: { in: conversationIds } },
        });
        await prisma.user.deleteMany({
          where: { id: { in: createdUserIds } },
        });
      }
    } finally {
      await app?.close();
    }
  }, 30000);

  it('covers registration, login, protected user endpoints, and conversation REST APIs', async () => {
    for (const key of ['alice', 'bob', 'charlie'] as const) {
      const registered = registrationResponses.get(key);
      expect(registered).toBeDefined();
      expect(registered?.user.id).toBe(getUser(key).id);
      expect(registered?.user.username).toBe(getUser(key).username);
      expect(registered).not.toHaveProperty('user.passwordHash');
    }

    const alice = getUser('alice');
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: alice.username, password: 'integration-test-password' })
      .expect(200);
    expect(login.body.user.id).toBe(alice.id);
    expect(login.body.accessToken).toEqual(expect.any(String));

    const refreshed = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: alice.refreshToken })
      .expect(200);
    expect(refreshed.body.accessToken).toEqual(expect.any(String));
    expect(refreshed.body.refreshToken).not.toBe(alice.refreshToken);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username: alice.username, password: 'incorrect-password' })
      .expect(401);

    await request(app.getHttpServer()).get('/user/me').expect(401);
    await request(app.getHttpServer()).get('/conversations').expect(401);
    await request(app.getHttpServer())
      .get(`/conversations/${directConversation.id}/messages`)
      .expect(401);

    const profile = await request(app.getHttpServer())
      .get('/user/me')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .expect(200);
    expect(profile.body).toMatchObject({
      id: alice.id,
      username: alice.username,
    });

    const userList = await request(app.getHttpServer())
      .get('/user')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .expect(200);
    expect(userList.body.map((user: { id: string }) => user.id)).toContain(
      alice.id,
    );

    const directRepeat = await request(app.getHttpServer())
      .post(`/conversations/direct/${getUser('bob').id}`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .expect(201);
    expect(directRepeat.body.id).toBe(directConversation.id);

    const bobDetails = await request(app.getHttpServer())
      .get(`/conversations/${directConversation.id}`)
      .set('Authorization', `Bearer ${getUser('bob').accessToken}`)
      .expect(200);
    expect(bobDetails.body.type).toBe('DIRECT');

    await request(app.getHttpServer())
      .get(`/conversations/${directConversation.id}`)
      .set('Authorization', `Bearer ${getUser('charlie').accessToken}`)
      .expect(403);

    const groupDetails = await request(app.getHttpServer())
      .get(`/conversations/${groupConversation.id}`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .expect(200);
    expect(groupDetails.body.type).toBe('GROUP');
    expect(groupDetails.body.members).toHaveLength(3);

    const aliceConversations = await request(app.getHttpServer())
      .get('/conversations')
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .expect(200);
    expect(
      aliceConversations.body.map(
        (conversation: { id: string }) => conversation.id,
      ),
    ).toEqual(
      expect.arrayContaining([directConversation.id, groupConversation.id]),
    );

    const emptyHistory = await request(app.getHttpServer())
      .get(`/conversations/${directConversation.id}/messages`)
      .set('Authorization', `Bearer ${getUser('bob').accessToken}`)
      .expect(200);
    expect(emptyHistory.body.messages).toEqual([]);
    expect(emptyHistory.body.hasMore).toBe(false);
  });

  it('authenticates three clients, enforces direct-chat membership, persists messages, and reconnects', async () => {
    const alice = await connectSocket(getUser('alice').accessToken);
    const aliceSecondSocket = await connectSocket(getUser('alice').accessToken);
    const bob = await connectSocket(getUser('bob').accessToken);
    const charlie = await connectSocket(getUser('charlie').accessToken);

    for (const socket of [alice, aliceSecondSocket, bob]) {
      const joined = await emitAck<Ack<never>>(socket, 'conversation:join', {
        conversationId: directConversation.id,
      });
      expect(joined).toMatchObject({ ok: true });
    }

    const deniedJoin = await emitAck<Ack<never>>(charlie, 'conversation:join', {
      conversationId: directConversation.id,
    });
    expect(deniedJoin.ok).toBe(false);

    const directContent = `direct-${randomUUID()}`;
    const spoofedContent = `spoofed-${randomUUID()}`;
    const bobDelivery = waitForEvent<ChatMessage>(bob, 'message:new');
    const aliceOtherDeviceDelivery = waitForEvent<ChatMessage>(
      aliceSecondSocket,
      'message:new',
    );
    void bobDelivery.promise.catch(() => undefined);
    void aliceOtherDeviceDelivery.promise.catch(() => undefined);

    const sent = await emitAck<Ack<ChatMessage>>(
      alice,
      'message:send',
      {
        conversationId: directConversation.id,
        content: directContent,
      },
      'direct message send',
    );
    expect(sent.ok).toBe(true);
    expect(sent.message).toMatchObject({
      senderId: getUser('alice').id,
      conversationId: directConversation.id,
      content: directContent,
    });

    const [deliveredToBob, deliveredToAlice] = await Promise.all([
      bobDelivery.promise,
      aliceOtherDeviceDelivery.promise,
    ]);
    expect(deliveredToBob.id).toBe(sent.message?.id);
    expect(deliveredToAlice.id).toBe(sent.message?.id);

    const spoofException = waitForEvent<{
      cause?: { pattern?: string };
    }>(alice, 'exception');
    alice.emit('message:send', {
      conversationId: directConversation.id,
      content: spoofedContent,
      senderId: getUser('bob').id,
    });
    await expect(spoofException.promise).resolves.toMatchObject({
      cause: { pattern: 'message:send' },
    });

    const unauthorizedContent = `unauthorized-${randomUUID()}`;
    const deniedSend = await emitAck<Ack<ChatMessage>>(
      charlie,
      'message:send',
      {
        conversationId: directConversation.id,
        content: unauthorizedContent,
      },
      'unauthorized direct message send',
    );
    expect(deniedSend.ok).toBe(false);

    const bobHistory = await request(app.getHttpServer())
      .get(`/conversations/${directConversation.id}/messages`)
      .set('Authorization', `Bearer ${getUser('bob').accessToken}`)
      .expect(200);
    expect(
      bobHistory.body.messages.some(
        (message: ChatMessage) => message.id === sent.message?.id,
      ),
    ).toBe(true);
    expect(
      bobHistory.body.messages.some(
        (message: ChatMessage) =>
          message.content === unauthorizedContent ||
          message.content === spoofedContent,
      ),
    ).toBe(false);

    await request(app.getHttpServer())
      .get(`/conversations/${directConversation.id}/messages`)
      .set('Authorization', `Bearer ${getUser('charlie').accessToken}`)
      .expect(403);

    const disconnected = waitForSocketDisconnect(bob);
    bob.disconnect();
    await disconnected;
    await reconnectSocket(bob);
    const rejoined = await emitAck<Ack<never>>(bob, 'conversation:join', {
      conversationId: directConversation.id,
    });
    expect(rejoined.ok).toBe(true);

    const afterReconnectDelivery = waitForEvent<ChatMessage>(
      bob,
      'message:new',
    );
    void afterReconnectDelivery.promise.catch(() => undefined);
    const afterReconnectContent = `reconnected-${randomUUID()}`;
    const afterReconnectAck = await emitAck<Ack<ChatMessage>>(
      alice,
      'message:send',
      {
        conversationId: directConversation.id,
        content: afterReconnectContent,
      },
      'message send after reconnect',
    );
    expect(afterReconnectAck.ok).toBe(true);
    await expect(afterReconnectDelivery.promise).resolves.toMatchObject({
      id: afterReconnectAck.message?.id,
      content: afterReconnectContent,
    });
  }, 30000);

  it('delivers group messages to all three members and rejects unauthenticated sockets', async () => {
    const alice = await connectSocket(getUser('alice').accessToken);
    const bob = await connectSocket(getUser('bob').accessToken);
    const charlie = await connectSocket(getUser('charlie').accessToken);

    for (const socket of [alice, bob, charlie]) {
      const joined = await emitAck<Ack<never>>(socket, 'conversation:join', {
        conversationId: groupConversation.id,
      });
      expect(joined.ok).toBe(true);
    }

    const bobDelivery = waitForEvent<ChatMessage>(bob, 'message:new');
    const charlieDelivery = waitForEvent<ChatMessage>(charlie, 'message:new');
    void bobDelivery.promise.catch(() => undefined);
    void charlieDelivery.promise.catch(() => undefined);

    const content = `group-${randomUUID()}`;
    const ack = await emitAck<Ack<ChatMessage>>(
      alice,
      'message:send',
      {
        conversationId: groupConversation.id,
        content,
      },
      'group message send',
    );
    expect(ack.ok).toBe(true);
    expect(ack.message?.senderId).toBe(getUser('alice').id);

    const [bobMessage, charlieMessage] = await Promise.all([
      bobDelivery.promise,
      charlieDelivery.promise,
    ]);
    expect(bobMessage.id).toBe(ack.message?.id);
    expect(charlieMessage.id).toBe(ack.message?.id);

    const history = await request(app.getHttpServer())
      .get(`/conversations/${groupConversation.id}/messages`)
      .set('Authorization', `Bearer ${getUser('charlie').accessToken}`)
      .expect(200);
    expect(
      history.body.messages.some(
        (message: ChatMessage) => message.id === ack.message?.id,
      ),
    ).toBe(true);

    await expectRejectedSocketConnection();
  }, 30000);

  async function connectSocket(token: string): Promise<Socket> {
    const socket = io(apiUrl, {
      autoConnect: false,
      auth: { token },
      reconnection: false,
      timeout: socketTimeoutMs,
      transports: ['websocket'],
    });
    sockets.add(socket);
    await waitForSocketConnect(socket);
    return socket;
  }

  function waitForSocketConnect(socket: Socket): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Socket.IO connection timed out.'));
      }, socketTimeoutMs);
      const onConnect = () => {
        cleanup();
        resolve();
      };
      const onConnectError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const cleanup = () => {
        clearTimeout(timer);
        socket.off('connect', onConnect);
        socket.off('connect_error', onConnectError);
      };

      socket.once('connect', onConnect);
      socket.once('connect_error', onConnectError);
      socket.connect();
    });
  }

  async function reconnectSocket(socket: Socket): Promise<void> {
    await waitForSocketConnect(socket);
  }

  function waitForSocketDisconnect(socket: Socket): Promise<void> {
    if (!socket.connected) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      socket.once('disconnect', () => resolve());
    });
  }

  async function expectRejectedSocketConnection(): Promise<void> {
    const socket = io(apiUrl, {
      autoConnect: false,
      auth: {},
      reconnection: false,
      timeout: socketTimeoutMs,
      transports: ['websocket'],
    });
    sockets.add(socket);

    try {
      const error = await new Promise<Error>((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error('Expected unauthenticated socket rejection.'));
        }, socketTimeoutMs);
        const onConnect = () => {
          cleanup();
          reject(new Error('Socket connected without an access token.'));
        };
        const onConnectError = (connectError: Error) => {
          cleanup();
          resolve(connectError);
        };
        const cleanup = () => {
          clearTimeout(timer);
          socket.off('connect', onConnect);
          socket.off('connect_error', onConnectError);
        };

        socket.once('connect', onConnect);
        socket.once('connect_error', onConnectError);
        socket.connect();
      });

      expect(error.message).toContain('Unauthorized');
    } finally {
      socket.disconnect();
    }
  }

  function emitAck<T>(
    socket: Socket,
    event: string,
    payload?: unknown,
    description = event,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      socket
        .timeout(socketTimeoutMs)
        .emit(event, payload, (error: Error | null, response: T) => {
          if (error) {
            reject(
              new Error(
                `No acknowledgement for ${description} ("${event}"): ${error.message}`,
              ),
            );
            return;
          }
          resolve(response);
        });
    });
  }

  function waitForEvent<T>(
    socket: Socket,
    event: string,
  ): { promise: Promise<T>; cancel: () => void } {
    let timer: ReturnType<typeof setTimeout>;
    let handler: (payload: T) => void;

    const promise = new Promise<T>((resolve, reject) => {
      handler = (payload: T) => {
        clearTimeout(timer);
        resolve(payload);
      };
      socket.once(event, handler);
      timer = setTimeout(() => {
        socket.off(event, handler);
        reject(new Error(`Timed out waiting for "${event}".`));
      }, socketTimeoutMs);
    });

    return {
      promise,
      cancel: () => {
        clearTimeout(timer);
        socket.off(event, handler);
      },
    };
  }
});
