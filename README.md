# Chat & Community Backend

> A progressively built, real-time chat and community backend for learning **NestJS, WebSockets, backend architecture, distributed messaging, microservices, event-driven systems, and deployment**—one working version at a time.

**Current milestone:** Version 1 — Functional Chat Application (in progress)  

---

## Project Goal

Build a usable chat application **first**, then evolve it into a reliable, scalable, service-oriented system. Every version should introduce new engineering concepts for a clear reason, while preserving the working functionality from earlier versions.

The planned evolution is:

```text
V1  Functional chat application
       ↓
V2  Reliable and scalable real-time messaging
       ↓
V3  Microservices + GraphQL + gRPC
       ↓
V4  Event-driven processing with RabbitMQ + Kafka
       ↓
V5  Containerization, Kubernetes, observability and load testing
```

> **Roadmap policy:** This is a learning and implementation plan, not a fixed specification. The order of individual tasks may change when dependencies or practical requirements make a different sequence more sensible. A new version begins only after the previous version's core functionality works and has been tested.

## Technology Roadmap

| Layer / concern | Technology | Planned introduction |
| --- | --- | --- |
| Backend language and framework | TypeScript, NestJS | V1 |
| Primary relational persistence | PostgreSQL, Prisma | V1 |
| HTTP APIs | REST | V1 |
| Real-time transport | Socket.IO (WebSockets with optional fallback) | V1 |
| Authentication | Password hashing, JWT, guards | V1 |
| Distributed socket coordination | Redis, Socket.IO Redis adapter | V2 |
| Alternative client-facing API | GraphQL, alongside REST | V3 |
| Internal service-to-service RPC | gRPC | V3 |
| Background task queue | RabbitMQ | V4 |
| Event streaming | Kafka | V4 |
| Containerization and orchestration | Docker, Kubernetes | V5 |
| Tracing and metrics | OpenTelemetry, Prometheus | V5 |

Tools will be added when their responsibilities are needed—not simply to increase the number of technologies in the project.

## Current Progress

**Status as of November 4, 2026**

- [x] Initialize NestJS + TypeScript application.
- [x] Configure PostgreSQL and Prisma.
- [x] Build user REST APIs for listing users and viewing the authenticated profile.
- [x] Build direct-message history retrieval and real-time message sending.
- [x] Add a Socket.IO gateway for real-time, one-to-one messaging.
- [x] Test two connected clients, message acknowledgements, delivery events, and database persistence.
- [x] Secure users and messaging with authentication and authorization.
- [x] Introduce first-class conversations and group chats.
- [x] Complete and validate the V1 end-to-end feature set. **← NEXT**

### Current architecture

```text
                   Authenticated client
                    |             |
                HTTP REST      Socket.IO
                    |             |
          +---------v-------------v----------+
          |       NestJS application          |
          | Auth / User / Conversation /      |
          | Message controllers and services |
          |      MessageGateway              |
          |              |                   |
          |          Prisma                  |
          +--------------|-------------------+
                         |
                    PostgreSQL
```

REST routes (except `GET /` and the explicitly public authentication routes) require a bearer access token. Socket.IO connections authenticate with an access token during the handshake; the server assigns the socket to the authenticated user's room.

### Current project structure

```text
prisma/
  schema.prisma
  migrations/
scripts/
  test-chat.mjs
src/
  app.module.ts
  main.ts
  generated/prisma/              # Generated Prisma client
  lib/database/                  # Prisma module and service
  modules/
    auth/                         # Registration, login, JWT and sessions
    conversation/                 # Groups, membership and join requests
    message/                      # Direct-message history and Socket.IO
    user/                         # User listing and profile
test/                             # End-to-end tests
```

### Local configuration and tests

The application reads these variables from the root `.env` file (or the process environment):

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection string used by Prisma. |
| `JWT_ACCESS_SECRET` | Yes | Secret used to sign access tokens. Keep it private and use a strong value. |
| `JWT_ISSUER` | Yes | Expected issuer for access tokens. |
| `JWT_AUDIENCE` | Yes | Expected audience for access tokens. |
| `PORT` | No | HTTP port; defaults to `3000`. |

Install dependencies, generate the Prisma client, apply local migrations, and start the application:

```powershell
npm install
npx prisma generate
npx prisma migrate dev
npm run start:dev
```

The easiest way to run the end-to-end suite is with Docker Desktop running:

```powershell
npm run test:e2e:docker
```

This command starts a temporary `postgres:17-alpine` container, waits for PostgreSQL's health check, applies all Prisma migrations, runs `npm run test:e2e`, and removes the container afterward (on success or failure). The test database is isolated from your `.env` database and is not persisted. Docker uses host port `55432`; if that port is occupied, choose another port:

```powershell
$env:TEST_DATABASE_PORT = "55433"
npm run test:e2e:docker
Remove-Item Env:TEST_DATABASE_PORT
```

The Docker workflow sets `DATABASE_URL` and `TEST_DATABASE_URL` only in its child process and uses temporary JWT test settings; no `.env.test` file or production credentials are needed. To run `npm run test:e2e` directly, set `TEST_DATABASE_URL` in your process environment or create an ignored `.env.test` file yourself, and apply the project migrations to that same test database before running tests. Never point integration tests at a production database.

`npm run test` runs the unit tests; `npm run test:e2e` runs `test/app.e2e-spec.ts` and `test/phase-1.7.e2e-spec.ts` against the dedicated database. The integration suite covers registration/login, protected REST routes, user and conversation APIs, three authenticated users, direct and group messaging, membership denials, server-derived sender identity, persisted message history, a second socket for one user, reconnecting a client, and rejecting a socket without a token. The suite uses Supertest and the existing Socket.IO client to verify correctness; it is not a load benchmark. k6 remains a good fit for the planned V5 load/performance scenarios against a separately running server.

### Implemented API reference

All REST routes below require `Authorization: Bearer <accessToken>` unless marked **Public**. Requests with DTOs are validated, transformed, and reject unknown fields.

#### REST endpoints

| Method | Route | Access | What it does |
| --- | --- | --- | --- |
| `GET` | `/` | Public | Returns the application's greeting. |
| `POST` | `/auth/register` | Public | Registers a user. Body: `{ "name": "...", "username": "...", "phoneNumber": "+...", "password": "..." }`. |
| `POST` | `/auth/login` | Public | Authenticates with username and password. Body: `{ "username": "...", "password": "..." }`. |
| `POST` | `/auth/refresh` | Public | Rotates the refresh token. Body: `{ "refreshToken": "..." }`. |
| `POST` | `/auth/logout` | Public | Revokes the session identified by the supplied refresh token. Body: `{ "refreshToken": "..." }`. |
| `POST` | `/auth/logout-all` | Authenticated | Revokes all of the current user's sessions and disconnects their sockets. |
| `GET` | `/user` | Authenticated | Lists up to 50 users (id, name, username, and createdAt), newest first. |
| `GET` | `/user/me` | Authenticated | Returns the current user's profile (id, name, username, phoneNumber, and createdAt). |
| `POST` | `/conversations/direct/:otherUserId` | Authenticated | Gets or creates the direct conversation between the current user and the specified user. The response includes the conversation id, type, creation time, and member ids/roles. |
| `POST` | `/conversations/groups` | Authenticated | Creates a group with the current user as owner. Body: `{ "name": "...", "joinPolicy": "OPEN" }`; `joinPolicy` is optional and defaults to `REQUEST`. |
| `GET` | `/conversations` | Authenticated | Lists the current user's conversations, newest-updated first, including member summaries/count and the latest message. |
| `GET` | `/conversations/:id` | Authenticated | Returns conversation details. Direct conversations require membership; authenticated users can view group details before joining. |
| `PATCH` | `/conversations/:id` | Authenticated, group owner | Updates a group's `name` and/or `joinPolicy` (`OPEN` or `REQUEST`). At least one field is required. |
| `POST` | `/conversations/:id/join` | Authenticated | Joins an `OPEN` group immediately or creates/reopens a pending request for a `REQUEST` group. |
| `DELETE` | `/conversations/:id/leave` | Authenticated member | Leaves a group. The owner cannot leave. |
| `GET` | `/conversations/:id/join-requests` | Authenticated, group owner | Lists pending join requests for the group. |
| `PATCH` | `/conversations/:id/join-requests/:requestId` | Authenticated, group owner | Approves or rejects a pending request. Body: `{ "action": "APPROVE" }` or `{ "action": "REJECT" }`. |
| `DELETE` | `/conversations/:id/join-requests/me` | Authenticated | Cancels the current user's pending request for the group. |
| `GET` | `/conversations/:conversationId/messages` | Authenticated member | Lists messages in chronological order. Query: `limit` (default `50`, range `1`-`100`) and optional `cursor` (a message id from this conversation). Returns `{ "messages": [...], "nextCursor": "... or null", "hasMore": true }`; use `nextCursor` for the next page. |

`/auth/register`, `/auth/login`, and `/auth/refresh` return `accessToken`, `refreshToken`, `tokenType`, `expiresIn` (seconds), `refreshTokenExpiresAt`, `sessionExpiresAt`, and the user profile. Access tokens are short-lived; use `/auth/refresh` to rotate the refresh token. The `:id`, `:requestId`, `:otherUserId`, and `:conversationId` path parameters are UUIDs.

Direct conversations can be created explicitly with `POST /conversations/direct/:otherUserId`. Messages are sent over Socket.IO; there is no REST message-creation endpoint.

#### Socket.IO events

Connect to the Socket.IO server at the application origin and pass the access token in the handshake auth object:

```js
const socket = io(API_BASE_URL, {
  auth: { token: accessToken },
});
```

The server validates the access token and its active session, joins the socket to a server-selected `user:<userId>` room, and disconnects it when the access token expires. There is no client `user:join` event. Message delivery targets each conversation member's user room, so clients do not need to join a conversation room to send or receive messages. `conversation:join` is required for conversation-scoped presence snapshots and typing events; only members can join.

| Direction | Event | Payload / acknowledgement | What it does |
| --- | --- | --- | --- |
| Client → server | `conversation:join` | `{ "conversationId": "<conversation UUID>" }`; acknowledges `{ "ok": true, "conversationId": "..." }` or `{ "ok": false, "error": "..." }` | Checks membership and joins this socket to the conversation room. Also emits a `presence:snapshot` to this socket containing the online IDs of the conversation's other members. |
| Client → server | `conversation:leave` | `{ "conversationId": "<conversation UUID>" }`; acknowledges `{ "ok": true, "conversationId": "..." }` | Leaves the conversation room for this socket. |
| Client → server | `message:send` | `{ "conversationId": "<conversation UUID>", "content": "..." }`; acknowledge with `{ "ok": true, "message": { ... } }` or `{ "ok": false, "error": "..." }` | Persists a message in a conversation where the authenticated user is a member. `content` is trimmed and must contain 1-2000 characters. The sender id is taken from the authenticated socket, not supplied by the client. |
| Server → client | `message:new` | Message object with `id`, `senderId`, `conversationId`, `content`, and `createdAt` | Announces a persisted message to every connected socket of the conversation's other members and the sender's other sockets, except the socket that sent it. The originating socket receives the message in its `message:send` acknowledgement. |
| Client → server | `presence:get-snapshot` | No payload; acknowledges `{ "ok": true }` | Requests an updated presence snapshot for the authenticated user's peers (users who share at least one conversation). The server also emits `presence:snapshot` to this socket. |
| Server → client | `presence:snapshot` | `{ "onlineUserIds": ["<user UUID>", ...] }` | Lists currently online peers. Emitted on connection, on `presence:get-snapshot`, and after successfully joining a conversation (the latter contains that conversation's other members). |
| Server → client | `presence:online` | `{ "userId": "<user UUID>" }` | Announces that a peer sharing a conversation has become online. Emitted when their first socket connects. |
| Server → client | `presence:offline` | `{ "userId": "<user UUID>" }` | Announces that a peer sharing a conversation has gone offline. Emitted when their last socket disconnects. |
| Client → server | `typing:start` | `{ "conversationId": "<conversation UUID>" }`; acknowledges `{ "ok": true }` or `{ "ok": false, "error": "..." }` | Emits `typing:started` to the other sockets in the conversation room. The user must be a member and this socket must have joined the room. |
| Client → server | `typing:stop` | `{ "conversationId": "<conversation UUID>" }`; acknowledges `{ "ok": true }` or `{ "ok": false, "error": "..." }` | Emits `typing:stopped` to the other sockets in the conversation room. The user must be a member and this socket must have joined the room. |
| Server → client | `typing:started`, `typing:stopped` | `{ "conversationId": "<conversation UUID>", "userId": "<user UUID>" }` | Notifies the other sockets in a joined conversation when a member starts or stops typing. These events are ephemeral and are not persisted. |

The standard Socket.IO `connect`, `connect_error`, and `disconnect` lifecycle events also apply. Connections are rejected without a valid active-session access token and disconnected when that token expires. Presence and typing events are ephemeral; they are not stored in the database.

---

# Version 1 — Functional Chat Application

**Objective:** Deliver a complete single-instance chat backend with authenticated users, one-to-one and group conversations, real-time messaging, and persisted history.

## Phase 1.1 — Project foundation ✅

- [x] Set up NestJS and TypeScript.
- [x] Connect PostgreSQL using Prisma.
- [x] Organize controllers, services, modules and database access.
- [x] Verify the application starts and can access the database.

**Milestone:** A running backend with working persistence.

## Phase 1.2 — Basic REST APIs ✅

- [x] Create users for local testing.
- [x] List users and fetch individual user details.
- [x] Persist a direct message between two users.
- [x] Retrieve the message history between two users.

The currently implemented routes are documented in the [Implemented API reference](#implemented-api-reference) above. The initial `/users` and `/messages` endpoints described in early development notes are not current routes.

**Milestone:** Messages can be created and fetched through REST, without WebSockets.

## Phase 1.3 — Real-time messaging ✅

- [x] Install and configure NestJS Socket.IO support.
- [x] Create a `MessageGateway`.
- [x] Authenticate Socket.IO connections and support `message:send` and `message:new` events.
- [x] Use Socket.IO rooms to target sender/recipient connections.
- [x] Reuse `MessageService` for persistence rather than duplicating database logic.
- [x] Return sender acknowledgements after successful message persistence.
- [x] Verify real-time delivery using two local Socket.IO clients.
- [x] Confirm received messages can be retrieved through REST.

**Milestone:** Client A sends a message; Client B receives it immediately; the message remains stored in PostgreSQL.

## Phase 1.4 — Authentication and authorization

- [x] Decide and implement the final user-registration fields and unique identifiers.
- [x] Implement password hashing and safe credential storage.
- [x] Implement `POST /auth/register` and `POST /auth/login`.
- [x] Issue and validate JWT access tokens.
- [x] Add NestJS guards to protected REST endpoints.
- [x] Resolve the current user from the verified JWT rather than trusting a client-supplied sender ID.
- [x] Authenticate Socket.IO connections and reject unauthorized clients.
- [x] Replace the insecure `user:join` identity mechanism with authenticated user-room assignment.
- [x] Verify users cannot send as someone else or access other users' private history.
- [x] Restrict or remove development-only user creation/listing endpoints as appropriate.

**Milestone:** REST and Socket.IO operations use the same verified user identity; identity spoofing and unauthorized history access are rejected.

## Phase 1.5 — Conversation model and group chats **← NEXT**

- [x] Introduce a `Conversation` model with a type such as `DIRECT` or `GROUP`.
- [x] Introduce conversation membership (e.g., `ConversationMember`) and ownership/admin rules where needed.
- [x] Relate stored messages to conversations; migrate the initial direct-message model as needed.
- [x] Create or retrieve a direct conversation between two users without creating duplicates.
- [x] Create group conversations and manage their members.
- [x] List conversations visible to the authenticated user.
- [x] Fetch messages for an authorized conversation.
- [x] Join a Socket.IO conversation room **only after** checking membership.
- [x] Send a message to an authorized conversation and broadcast to its members.
- [x] Define how the existing direct-message endpoints transition to conversation-based endpoints.

**Milestone:** The same backend supports both one-to-one and group conversations with correctly enforced membership.

## Phase 1.6 — Basic chat experience

- [x] Add typing-started / typing-stopped events (ephemeral; no database write required).
- [x] Add basic online/offline connection tracking for the single-instance V1 server.
- [x] Support multiple simultaneous sockets for one authenticated user.
- [x] Validate message content and enforce reasonable message size limits.
- [x] Handle disconnects, errors and basic client reconnection cleanly.
- [x] Ensure REST-created messages and WebSocket-created messages follow consistent business rules and real-time notification behavior. (REST ENDPOINTS ARE REMOVED AND NOTIFICATION IS FUTURE PLAN)

**Milestone:** A practical, responsive V1 chat flow rather than isolated endpoint demonstrations.

## Phase 1.7 — V1 tests and completion

- [x] Add REST integration tests for auth, users, conversations and messages.
- [x] Add Socket.IO integration tests with at least three clients.
- [x] Test unauthorized access, message persistence and room-membership enforcement.
- [x] Test direct chats, group chats, multiple sockets and reconnections.
- [x] Document environment variables, local setup and test commands.

### V1 exit criteria

A registered user can log in, start a direct or group conversation, send and receive messages in real time, reconnect and retrieve stored conversation history, and cannot impersonate another user or read conversations they do not belong to.

---

# Version 2 — Reliable and Scalable Messaging

**Objective:** Move beyond a single-server demonstration. Support multiple real-time gateway instances and make message handling resilient to reconnects, retries and duplicate events.

## Phase 2.1 — Multiple Socket.IO instances and Redis

- [ ] Run more than one application / WebSocket gateway instance.
- [ ] Introduce the Socket.IO Redis adapter so broadcasts reach sockets connected to other instances.
- [ ] Maintain shared online-presence information rather than trusting per-process memory alone.
- [ ] Verify cross-instance message delivery and disconnect behavior.

## Phase 2.2 — Recovery and delivery semantics

- [ ] Define the meaning of *accepted*, *persisted*, *delivered* and *read*.
- [ ] Add client-generated message IDs or idempotency keys to prevent duplicates on retries.
- [ ] Provide message acknowledgements with clear success/error semantics.
- [ ] Design reconnection synchronization to fetch messages missed while offline.
- [ ] Handle retries, duplicate submissions and temporary instance failures.

## Phase 2.3 — History and read-state improvements

- [ ] Add cursor-based message pagination and the necessary database indexes.
- [ ] Implement delivered/read receipts with appropriate authorization.
- [ ] Make receipt updates safe to repeat.
- [ ] Add tests for concurrent sends, reconnects, duplication and out-of-order arrivals.

### V2 exit criteria

Messaging works across multiple gateway instances; temporary disconnects do not silently lose permanently stored messages; retries do not create duplicate messages; history can be paginated; and delivery/read states have defined semantics.

---

# Version 3 — Microservices, GraphQL and gRPC

**Objective:** Introduce service boundaries and new API styles only after the monolith has meaningful, stable responsibilities to separate.

## Phase 3.1 — Identify and extract service boundaries

- [ ] Define responsibilities for a **User Service** and a **Conversation / Messaging Service**.
- [ ] Separate service-owned data and prevent direct cross-service database access.
- [ ] Define authentication and authorization ownership across services.
- [ ] Migrate existing functionality incrementally, keeping the application usable.

## Phase 3.2 — Add GraphQL where it fits

- [ ] Introduce GraphQL for selected client-facing queries, such as conversation lists and message history.
- [ ] Design schemas, resolvers, input validation and field-level authorization.
- [ ] Keep REST where it remains appropriate; **REST and GraphQL can coexist**.
- [ ] Avoid query inefficiencies (e.g., N+1 reads) and test resolver access control.

## Phase 3.3 — Introduce gRPC for internal calls

- [ ] Define Protocol Buffers contracts for selected synchronous service-to-service operations.
- [ ] Implement at least one real gRPC communication path between services.
- [ ] Configure deadlines/timeouts and appropriate error handling.
- [ ] Add retries **only for operations where retries are safe**.
- [ ] Write integration and contract tests for internal APIs.

### V3 exit criteria

At least two services own clear responsibilities and communicate through defined interfaces; selected client queries work through GraphQL; at least one internal gRPC path works; and existing chat functionality remains intact.

---

# Version 4 — Event-Driven Processing

**Objective:** Learn how reliable asynchronous work and event streams complement the real-time chat path rather than replace it unnecessarily.

## Phase 4.1 — RabbitMQ for background work

- [ ] Identify a real asynchronous use case (for example, offline notifications).
- [ ] Produce and consume background jobs through RabbitMQ.
- [ ] Implement acknowledgements, retry behavior and a dead-letter strategy.
- [ ] Make consumers idempotent so re-delivery is safe.

## Phase 4.2 — Kafka for event streams

- [ ] Publish meaningful domain events such as `MessageCreated`.
- [ ] Add an independent analytics or moderation consumer.
- [ ] Understand topics, partitions, consumer groups, offsets and replay.
- [ ] Define event schemas and a basic compatibility/versioning policy.

## Phase 4.3 — Consistency and failure handling

- [ ] Introduce the transactional outbox pattern so database writes and event publication cannot become silently inconsistent.
- [ ] Build an outbox publisher and safe retry mechanism.
- [ ] Test duplicate events, consumer downtime, poison messages and recovery.
- [ ] Observe processing lag and dead-letter queues.

### V4 exit criteria

The system reliably produces domain events from persisted operations; asynchronous workers can fail and recover; and RabbitMQ and Kafka each serve a clear, non-duplicated purpose.

---

# Version 5 — Deployment, Kubernetes and Observability

**Objective:** Package, operate, inspect and stress-test the complete system in a production-like environment.

## Phase 5.1 — Docker and local deployment

- [ ] Containerize the application and extracted services.
- [ ] Use Docker Compose for local multi-service development, including infrastructure dependencies.
- [ ] Externalize configuration and secrets; define startup/health-check behavior.
- [ ] Ensure environment setup is reproducible from documented commands.

## Phase 5.2 — Kubernetes

- [ ] Learn core Kubernetes concepts: pods, deployments, services, config maps, secrets and ingress.
- [ ] Deploy stateless application services to a local Kubernetes cluster.
- [ ] Configure readiness/liveness probes and rolling updates.
- [ ] Demonstrate scaling gateway instances and routing traffic correctly.
- [ ] Decide deliberately how stateful infrastructure will be provided rather than assuming it belongs inside the same cluster.

## Phase 5.3 — Observability and testing

- [ ] Add structured logs and request/correlation IDs.
- [ ] Add distributed tracing with OpenTelemetry.
- [ ] Export useful metrics for Prometheus.
- [ ] Measure REST latency, WebSocket connection counts, message delivery latency and queue/event processing behavior.
- [ ] Load-test many concurrent WebSocket clients and sustained message traffic.
- [ ] Run failure scenarios, capture bottlenecks and document results and trade-offs.

### V5 exit criteria

A reproducible multi-service deployment can be operated and observed locally; health checks and rolling updates work; and load/failure-test results explain the system's real limitations.

---

## Engineering Rules Throughout the Project

1. **Working software before complexity:** Do not introduce distributed infrastructure while the single-instance feature is still incomplete.
2. **One responsibility per technology:** Use Redis for distributed coordination, gRPC for selected synchronous RPCs, RabbitMQ for jobs and Kafka for event streams—only where useful.
3. **Security is part of correctness:** Check identity and conversation membership on the server, not only in the frontend.
4. **Database first, broadcast second:** For persisted messages, commit the database write before announcing success or broadcasting to recipients. Later versions will strengthen the remaining failure gap with recovery/outbox patterns.
5. **Define delivery guarantees:** A server acknowledgement is not the same as recipient delivery or a read receipt.
6. **Test every milestone:** Verify behavior with real clients, not just successful compilation.
7. **Keep the README honest:** Mark a checkbox complete only when the feature has been implemented and verified.

## Immediate Next Steps

1. Implement registration, login, password hashing and JWT access-token validation.
2. Protect existing REST routes with authentication and authorization.
3. Authenticate Socket.IO connections and derive user identity from verified tokens.
4. Confirm that the existing one-to-one WebSocket tests still work **without** client-controlled identity.
5. Then design the conversation/group schema and implement the remaining V1 phases.

---

**Long-term vision:** A real chat/community backend that starts simple, becomes reliable, then grows into a distributed and observable system—with each version demonstrating a concrete backend engineering skill.
