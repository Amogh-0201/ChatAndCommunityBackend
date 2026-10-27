# Chat & Community Backend

> A progressively built, real-time chat and community backend for learning **NestJS, WebSockets, backend architecture, distributed messaging, microservices, event-driven systems, and deployment**—one working version at a time.

**Current milestone:** Version 1 — Functional Chat Application (in progress)  
**Next task:** JWT authentication for REST APIs and Socket.IO connections.

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

**Status as of October 27, 2026**

- [x] Initialize NestJS + TypeScript application.
- [x] Configure PostgreSQL and Prisma.
- [x] Build basic user REST APIs (`POST /users`, `GET /users`, `GET /users/:id`).
- [x] Build basic message REST APIs (`POST /messages`, `GET /messages/between/:userA/:userB`).
- [x] Add a Socket.IO gateway for real-time, one-to-one messaging.
- [x] Test two connected clients, message acknowledgements, delivery events, and database persistence.
- [ ] Secure users and messaging with authentication and authorization. **← NEXT**
- [ ] Introduce first-class conversations and group chats.
- [ ] Complete and validate the V1 end-to-end feature set.

### Current architecture (V1, before authentication)

```text
                  Chat client / test client
                      |             |
                 HTTP REST      Socket.IO
                      |             |
            +---------v-------------v----------+
            |          NestJS application      |
            |                                  |
            |  UserController                  |
            |  MessageController               |
            |  MessageGateway                  |
            |           |                      |
            |   UserService / MessageService   |
            |           |                      |
            |          Prisma                  |
            +-------------|--------------------+
                          |
                     PostgreSQL
```

**Important development-only limitation:** The current `user:join` Socket.IO event accepts a client-supplied user ID. This is useful for testing, **but it is not authentication**. It must be replaced with server-verified identity before deploying or exposing the messaging system to untrusted users.

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

**Existing endpoints** (these may evolve as the conversation model is introduced):

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/users` | Create a test user |
| `GET` | `/users` | List users for development |
| `GET` | `/users/:id` | Get user details |
| `POST` | `/messages` | Persist a message |
| `GET` | `/messages/between/:userA/:userB` | Fetch direct-message history |

**Milestone:** Messages can be created and fetched through REST, without WebSockets.

## Phase 1.3 — Real-time messaging ✅

- [x] Install and configure NestJS Socket.IO support.
- [x] Create a `MessageGateway`.
- [x] Support `user:join`, `message:send`, and `message:new` events.
- [x] Use Socket.IO rooms to target sender/recipient connections.
- [x] Reuse `MessageService` for persistence rather than duplicating database logic.
- [x] Return sender acknowledgements after successful message persistence.
- [x] Verify real-time delivery using two local Socket.IO clients.
- [x] Confirm received messages can be retrieved through REST.

**Milestone:** Client A sends a message; Client B receives it immediately; the message remains stored in PostgreSQL.

## Phase 1.4 — Authentication and authorization **← NEXT**

- [ ] Decide and implement the final user-registration fields and unique identifiers.
- [ ] Implement password hashing and safe credential storage.
- [ ] Implement `POST /auth/register` and `POST /auth/login`.
- [ ] Issue and validate JWT access tokens.
- [ ] Add NestJS guards to protected REST endpoints.
- [ ] Resolve the current user from the verified JWT rather than trusting a client-supplied sender ID.
- [ ] Authenticate Socket.IO connections and reject unauthorized clients.
- [ ] Replace the insecure `user:join` identity mechanism with authenticated user-room assignment.
- [ ] Verify users cannot send as someone else or access other users' private history.
- [ ] Restrict or remove development-only user creation/listing endpoints as appropriate.

**Milestone:** REST and Socket.IO operations use the same verified user identity; identity spoofing and unauthorized history access are rejected.

## Phase 1.5 — Conversation model and group chats

- [ ] Introduce a `Conversation` model with a type such as `DIRECT` or `GROUP`.
- [ ] Introduce conversation membership (e.g., `ConversationMember`) and ownership/admin rules where needed.
- [ ] Relate stored messages to conversations; migrate the initial direct-message model as needed.
- [ ] Create or retrieve a direct conversation between two users without creating duplicates.
- [ ] Create group conversations and manage their members.
- [ ] List conversations visible to the authenticated user.
- [ ] Fetch messages for an authorized conversation.
- [ ] Join a Socket.IO conversation room **only after** checking membership.
- [ ] Send a message to an authorized conversation and broadcast to its members.
- [ ] Define how the existing direct-message endpoints transition to conversation-based endpoints.

**Milestone:** The same backend supports both one-to-one and group conversations with correctly enforced membership.

## Phase 1.6 — Basic chat experience

- [ ] Add typing-started / typing-stopped events (ephemeral; no database write required).
- [ ] Add basic online/offline connection tracking for the single-instance V1 server.
- [ ] Support multiple simultaneous sockets for one authenticated user.
- [ ] Validate message content and enforce reasonable message size limits.
- [ ] Handle disconnects, errors and basic client reconnection cleanly.
- [ ] Ensure REST-created messages and WebSocket-created messages follow consistent business rules and real-time notification behavior.

**Milestone:** A practical, responsive V1 chat flow rather than isolated endpoint demonstrations.

## Phase 1.7 — V1 tests and completion

- [ ] Add REST integration tests for auth, users, conversations and messages.
- [ ] Add Socket.IO integration tests with at least two clients.
- [ ] Test unauthorized access, message persistence and room-membership enforcement.
- [ ] Test direct chats, group chats, multiple sockets and reconnections.
- [ ] Document environment variables, local setup and test commands.
- [ ] Tag the first stable V1 release after the complete flow passes.

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
