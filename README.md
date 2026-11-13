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

| Layer / concern                    | Technology                                    | Planned introduction |
| ---------------------------------- | --------------------------------------------- | -------------------- |
| Backend language and framework     | TypeScript, NestJS                            | V1                   |
| Primary relational persistence     | PostgreSQL, Prisma                            | V1                   |
| HTTP APIs                          | REST                                          | V1                   |
| Real-time transport                | Socket.IO (WebSockets with optional fallback) | V1                   |
| Authentication                     | Password hashing, JWT, guards                 | V1                   |
| Distributed socket coordination    | Redis, Socket.IO Redis adapter                | V2                   |
| Alternative client-facing API      | GraphQL, alongside REST                       | V3                   |
| Internal service-to-service RPC    | gRPC                                          | V3                   |
| Background task queue              | RabbitMQ                                      | V4                   |
| Event streaming                    | Kafka                                         | V4                   |
| Containerization and orchestration | Docker, Kubernetes                            | V5                   |
| Tracing and metrics                | OpenTelemetry, Prometheus                     | V5                   |

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

| Variable            | Required | Purpose                                                                    |
| ------------------- | -------- | -------------------------------------------------------------------------- |
| `DATABASE_URL`      | Yes      | PostgreSQL connection string used by Prisma.                               |
| `JWT_ACCESS_SECRET` | Yes      | Secret used to sign access tokens. Keep it private and use a strong value. |
| `JWT_ISSUER`        | Yes      | Expected issuer for access tokens.                                         |
| `JWT_AUDIENCE`      | Yes      | Expected audience for access tokens.                                       |
| `PORT`              | No       | HTTP port; defaults to `3000`.                                             |

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

#### Find-all-users performance tests

The user-list endpoint is authenticated and returns one page at a time (up to
50 users). Create a token pool with the local auth helper, then run a profile:

```powershell
node scripts/auth-token-pool.mjs login 1000
k6 run k6_tests/user_service/find_all_users/findall_load.js
k6 run k6_tests/user_service/find_all_users/findall_stress.js
k6 run k6_tests/user_service/find_all_users/findall_spike.js
```

The test requests `/user?limit=50` and validates the paginated response. Each
request uses an access token from `scripts/.auth-token-pool.json`; the token
selection wraps with modulo at the number of saved users, so subsequent
iterations cycle back to the first user rather than exceeding the pool. The
profiles peak at 450, 800, and 1,000 VUs respectively. `BASE_URL` and
`TOKEN_POOL_FILE` can be set for k6 if the API or token pool uses a different
location.

#### Conversation API test data

These scripts save IDs for the first 11,000 generated load-test users, create
5,500 groups owned by the first 5,500 users, and create 5,500 direct
conversations pairing users 1-5,500 with users 5,501-11,000. Prepare the user
accounts and an auth token pool before running the scripts:

```powershell
node scripts/auth-token-pool.mjs login 11000
node scripts/auth-token-pool.mjs refresh 11000
node scripts/get-conversation-test-users.mjs
$env:SEED_TEST_DATABASE = "I_CONFIRMED_THIS_IS_THE_ISOLATED_TEST_DATABASE"
node scripts/create-conversation-test-groups.mjs
node scripts/get-conversation-test-join-requests.mjs
node scripts/create-conversation-test-direct.mjs
Remove-Item Env:SEED_TEST_DATABASE
```

The group and direct-conversation scripts require the confirmation variable and
only allow a local `BASE_URL`. They save progress every 100 successful
operations and can be rerun to resume. User, group, and direct-conversation
records are saved under `scripts/.conversation-test-*.json`; these files are
ignored by git. `CONCURRENCY` defaults to 5 (allowed range: 1-50), and
`TOKEN_POOL_FILE` can override the default `scripts/.auth-token-pool.json`.
The join-request collection script uses each group's owner token to fetch its
pending requests and saves them alongside the group metadata in
`scripts/.conversation-test-join-requests.json`. It requires the same database
confirmation and local `BASE_URL`, and saves progress every 100 groups.

#### Conversation API performance tests

The k6 conversation profiles use the saved 11,000-user file and local auth
token pool. Each iteration randomly selects an eligible authenticated user;
direct-conversation iterations also choose a random, different user as the
other participant. Group profiles create a new group on each iteration and
will grow the database; run them only against an isolated test database. The
load, stress, and spike profiles peak at 450, 800, and 1,000 VUs.
Refresh the token pool immediately before the profiles if the setup operations
or a previous run may have let its 15-minute access tokens expire:

```powershell
node scripts/auth-token-pool.mjs refresh 11000
k6 run k6_tests/conversation_service/get_or_create_direct_conversations/get_or_create_direct_load.js
k6 run k6_tests/conversation_service/get_or_create_direct_conversations/get_or_create_direct_stress.js
k6 run k6_tests/conversation_service/get_or_create_direct_conversations/get_or_create_direct_spike.js
k6 run k6_tests/conversation_service/create_groups/create_groups_load.js
k6 run k6_tests/conversation_service/create_groups/create_groups_stress.js
k6 run k6_tests/conversation_service/create_groups/create_groups_spike.js
```

`BASE_URL`, `TOKEN_POOL_FILE`, and `CONVERSATION_USERS_FILE` can override the
default local API and data-file locations.

#### Group join-request performance tests

These profiles submit `POST /conversations/:id/join` with a random conversation
test user and group on each iteration. A duplicate pending/already-approved
request, or the owner trying to join their own group, is counted as an expected
response; unexpected errors still fail the check. The profiles use the same
load, stress, and spike stages as the other conversation tests, peaking at
450, 800, and 1,000 VUs:

```powershell
k6 run k6_tests/conversation_service/converstion_join/join_groups_load.js
k6 run k6_tests/conversation_service/converstion_join/join_groups_stress.js
k6 run k6_tests/conversation_service/converstion_join/join_groups_spike.js
```

Run these against the prepared conversation test data and isolated database.

#### Get conversation join-requests performance tests

These profiles authenticate as each saved group owner and cycle through the
5,500 saved conversation IDs in order, wrapping to the first group with modulo.
Run them after preparing the conversation test data and refreshing the access
tokens:

```powershell
k6 run k6_tests/conversation_service/get_conversation_join_req/get_conversation_join_req_load.js
k6 run k6_tests/conversation_service/get_conversation_join_req/get_conversation_join_req_stress.js
k6 run k6_tests/conversation_service/get_conversation_join_req/get_conversation_join_req_spike.js
```

`BASE_URL`, `TOKEN_POOL_FILE`, `CONVERSATION_USERS_FILE`, and
`CONVERSATION_GROUPS_FILE` can override the default API, token pool, and data
files.

#### Cancel join-request test data

The generator creates 30,000 pending requests using users 5,501-11,000 and
`REQUEST` groups. Every requester gets five or six requests for distinct
groups. The collector then saves each request ID and conversation ID under its
requesting user in `scripts/.conversation-test-cancel-requests.json`. Prepare
the user, group, and token-pool files first, then run against the isolated local
test database:

```powershell
$env:SEED_TEST_DATABASE = "I_CONFIRMED_THIS_IS_THE_ISOLATED_TEST_DATABASE"
node scripts/auth-token-pool.mjs refresh 11000
node scripts/create-conversation-test-cancel-requests.mjs
node scripts/auth-token-pool.mjs refresh 11000
node scripts/get-conversation-test-cancel-requests.mjs
Remove-Item Env:SEED_TEST_DATABASE
```

The generator saves progress and can resume after interruption. Already
pending pairs count toward the target; pairs where the user is already a group
member or has an approved request are skipped. Rerunning after a completed
generation starts a fresh batch, reopening cancelled requests where possible.
The collector marks its output complete only after it finds all 30,000 planned
pending requests. `CONVERSATION_CANCEL_REQUEST_PLAN_FILE` and
`CONVERSATION_CANCEL_REQUESTS_FILE` can override the plan and output paths.

#### Cancel join-request performance tests

The profiles use the saved 30,000-request fixture and authenticate as each
requesting user. Each request is selected once before the test wraps; if a
profile runs more than 30,000 iterations, the expected “not pending” conflict
from a repeated cancellation is accepted. Since cancellation changes request
state, regenerate and recollect the fixture before each profile:

```powershell
$env:SEED_TEST_DATABASE = "I_CONFIRMED_THIS_IS_THE_ISOLATED_TEST_DATABASE"
node scripts/auth-token-pool.mjs refresh 11000
node scripts/create-conversation-test-cancel-requests.mjs
node scripts/auth-token-pool.mjs refresh 11000
node scripts/get-conversation-test-cancel-requests.mjs
k6 run k6_tests/conversation_service/cancel_join_request/cancel_join_request_load.js

node scripts/auth-token-pool.mjs refresh 11000
node scripts/create-conversation-test-cancel-requests.mjs
node scripts/auth-token-pool.mjs refresh 11000
node scripts/get-conversation-test-cancel-requests.mjs
k6 run k6_tests/conversation_service/cancel_join_request/cancel_join_request_stress.js

node scripts/auth-token-pool.mjs refresh 11000
node scripts/create-conversation-test-cancel-requests.mjs
node scripts/auth-token-pool.mjs refresh 11000
node scripts/get-conversation-test-cancel-requests.mjs
k6 run k6_tests/conversation_service/cancel_join_request/cancel_join_request_spike.js
Remove-Item Env:SEED_TEST_DATABASE
```

`CONVERSATION_CANCEL_REQUESTS_FILE` can override the fixture path.

#### Review conversation join-request performance tests

These profiles use the saved join-request file and authenticate as each
request's group owner. They review requests in order, wrapping to the first
request if a profile has more iterations than saved requests; each action
randomly approves or rejects. Since reviewing changes request status, rerun
the collector before each profile to refresh the file with pending requests.
Already-reviewed conflicts caused by cycling are expected:

```powershell
$env:SEED_TEST_DATABASE = "I_CONFIRMED_THIS_IS_THE_ISOLATED_TEST_DATABASE"
node scripts/auth-token-pool.mjs refresh 11000
node scripts/get-conversation-test-join-requests.mjs
k6 run k6_tests/conversation_service/review_conversation_join_req/review_conversation_join_req_load.js
node scripts/auth-token-pool.mjs refresh 11000
node scripts/get-conversation-test-join-requests.mjs
k6 run k6_tests/conversation_service/review_conversation_join_req/review_conversation_join_req_stress.js
node scripts/auth-token-pool.mjs refresh 11000
node scripts/get-conversation-test-join-requests.mjs
k6 run k6_tests/conversation_service/review_conversation_join_req/review_conversation_join_req_spike.js
Remove-Item Env:SEED_TEST_DATABASE
```

The profiles peak at 450, 800, and 1,000 VUs respectively.
`CONVERSATION_JOIN_REQUESTS_FILE` can override the default request-data file.

#### Conversation list, details, and group-update performance tests

The list profile cycles through the 11,000 conversation test users. The
details profile cycles through the saved 5,500 groups and authenticates as
users in sequence; group details are available to any authenticated user. The
update profile cycles through the same groups and authenticates as each
group's owner, submitting its existing name and `REQUEST` join policy. The
group fields remain unchanged, though the update route may advance
`updatedAt`. Each profile uses the standard load, stress, and spike stages,
peaking at 450, 800, and 1,000 VUs:

```powershell
node scripts/auth-token-pool.mjs refresh 11000
k6 run k6_tests/conversation_service/get_my_conversations/get_my_conversations_load.js
k6 run k6_tests/conversation_service/get_my_conversations/get_my_conversations_stress.js
k6 run k6_tests/conversation_service/get_my_conversations/get_my_conversations_spike.js
k6 run k6_tests/conversation_service/get_conversation_details/get_conversation_details_load.js
k6 run k6_tests/conversation_service/get_conversation_details/get_conversation_details_stress.js
k6 run k6_tests/conversation_service/get_conversation_details/get_conversation_details_spike.js
k6 run k6_tests/conversation_service/update_group/update_group_load.js
k6 run k6_tests/conversation_service/update_group/update_group_stress.js
k6 run k6_tests/conversation_service/update_group/update_group_spike.js
```

These profiles use the saved conversation user and group files.
`CONVERSATION_USERS_FILE` and `CONVERSATION_GROUPS_FILE` can override their
default paths.

#### Leave-group performance test data

Refresh the saved group memberships immediately before running leave-group
performance tests. The collector requests `/conversations` as each of the
11,000 test users and saves their group conversation IDs, names, and membership
roles to `scripts/.conversation-test-leave-groups.json`:

```powershell
node scripts/auth-token-pool.mjs refresh 11000
node scripts/get-conversation-test-leave-groups.mjs
```

The output contains all users, including users with no group memberships.
Membership roles are included so a leave-group test can select `MEMBER` entries
and avoid attempting to leave as an owner. The collector checkpoints progress;
the output is marked `complete: true` only after all users have been fetched.
`CONVERSATION_LEAVE_GROUPS_FILE` can override the output path.

#### Leave-group performance tests

These profiles use the refreshed group-membership data and the 11,000-user
token pool. Each non-owner membership is used at most once per profile because
successful leaves change membership state; owner memberships may be reused.
An owner’s documented `403` response is counted as an expected result, while
other unexpected responses fail the check. Refresh membership data before each
profile:

```powershell
node scripts/auth-token-pool.mjs refresh 11000
node scripts/get-conversation-test-leave-groups.mjs
k6 run k6_tests/conversation_service/leave_group/leave_group_load.js

node scripts/auth-token-pool.mjs refresh 11000
node scripts/get-conversation-test-leave-groups.mjs
k6 run k6_tests/conversation_service/leave_group/leave_group_stress.js

node scripts/auth-token-pool.mjs refresh 11000
node scripts/get-conversation-test-leave-groups.mjs
k6 run k6_tests/conversation_service/leave_group/leave_group_spike.js
```

`CONVERSATION_LEAVE_GROUPS_FILE` can override the membership-data file path.

#### Get-me and update-user performance tests

The authenticated profile and profile-update tests use the same local token
pool. Create it from the generated load-test accounts, then run the profiles:

```powershell
node scripts/auth-token-pool.mjs login 1000
k6 run k6_tests/user_service/get_me/getme_load.js
k6 run k6_tests/user_service/get_me/getme_stress.js
k6 run k6_tests/user_service/get_me/getme_spike.js
k6 run k6_tests/user_service/update_user/updateuser_load.js
k6 run k6_tests/user_service/update_user/updateuser_stress.js
k6 run k6_tests/user_service/update_user/updateuser_spike.js
```

Both endpoints cycle through the token pool with modulo. The update test
randomly sends the account's existing name, existing username, or both, so
requests exercise the update path without changing those values. Use the
generated test-account token pool created by `scripts/auth-token-pool.mjs`;
the tests validate results against those accounts' generated profiles.
The load, stress, and spike profiles peak at 450, 800, and 1,000 VUs.
`BASE_URL` and `TOKEN_POOL_FILE` can be set for k6 if needed.

#### Mixed user-service flows

These scenarios combine authenticated user endpoints in one iteration. They
use access tokens from the existing local token pool and do not call login,
refresh, or logout, so authentication traffic and token rotation do not
interfere with the user-service measurements. Prepare a current pool with at
least 1,000 accounts before running the spike profiles:

```powershell
node scripts/auth-token-pool.mjs login 1000
k6 run k6_tests/mixed_service/getme_updateuser_getme/getme_updateuser_getme_load.js
k6 run k6_tests/mixed_service/getme_updateuser_getme/getme_updateuser_getme_stress.js
k6 run k6_tests/mixed_service/getme_updateuser_getme/getme_updateuser_getme_spike.js
k6 run k6_tests/mixed_service/findall_getme/findall_getme_load.js
k6 run k6_tests/mixed_service/findall_getme/findall_getme_stress.js
k6 run k6_tests/mixed_service/findall_getme/findall_getme_spike.js
k6 run k6_tests/mixed_service/findall_getme_updateuser_getme/findall_getme_updateuser_getme_load.js
k6 run k6_tests/mixed_service/findall_getme_updateuser_getme/findall_getme_updateuser_getme_stress.js
k6 run k6_tests/mixed_service/findall_getme_updateuser_getme/findall_getme_updateuser_getme_spike.js
```

The flows are `GET /user/me` → `PATCH /user` → `GET /user/me`,
`GET /user` → `GET /user/me`, and
`GET /user` → `GET /user/me` → `PATCH /user` → `GET /user/me`. Each iteration
uses the same pool account for every step and checks that profile data remains
consistent. The update sends the account's existing name, exercising the
update endpoint without changing seeded profile values. The load, stress, and
spike profiles peak at 450, 800, and 1,000 VUs. One iteration generates three
or four requests, so compare request counts and endpoint tags—not only VUs—
when comparing these scenarios with single-endpoint tests. `BASE_URL` and
`TOKEN_POOL_FILE` can be set for k6 as with the other user-service tests.

#### Auth refresh performance tests

The local Docker Compose database can be reset by removing its named volume.
This permanently deletes all data in that local database. From the repository
root, run:

```powershell
docker compose down -v
docker compose up -d --build
docker compose ps
```

The API container applies Prisma migrations during startup. Wait until both
containers are healthy/running before seeding. The test-user generator
provides 50,000 accounts; seed them with:

```powershell
$env:USER_COUNT = "50000"
$env:CONCURRENCY = "5"
$env:SEED_TEST_DATABASE = "I_CONFIRMED_THIS_IS_THE_ISOLATED_TEST_DATABASE"
node scripts/seed-k6-users.mjs
Remove-Item Env:USER_COUNT, Env:CONCURRENCY, Env:SEED_TEST_DATABASE
```

The seed script sends registration requests and saves each new user's access
and refresh tokens to `scripts/.auth-token-pool.json` as it goes. It checkpoints
every 500 successful registrations and saves again at the end, so a failed seed
still leaves a pool for the users that registered successfully. A seed run
starts a new pool, replacing any previous pool file. This can take a while at
the default concurrency; increase `CONCURRENCY` cautiously if the local API
and database can handle it.

The token pool file is git-ignored and contains live credentials, so keep it
local. `BASE_URL` defaults to `http://localhost:3000` and is restricted to
localhost; `CONCURRENCY` defaults to 5 and can be set from 1 to 50.

To refresh a chosen number of saved accounts and persist their new tokens:

```powershell
node scripts/auth-token-pool.mjs refresh 10000
```

If the count is omitted, the command prompts for it. If a saved refresh token
is rejected, the command logs that account in and saves the new token pair.
After a k6 run, refresh the pool before reusing it: k6 only retains rotated
tokens in memory.

Run the 200-VU, 30-second refresh profile:

```powershell
k6 run k6_tests/auth_service/refresh/refresh_user_load.js
k6 run k6_tests/auth_service/refresh/refresh_user_stress.js
k6 run k6_tests/auth_service/refresh/refresh_user_spike.js
```

Each VU owns a disjoint shard of the token pool. With 50,000 accounts and 200
VUs, each VU gets 250 users. On every iteration it picks the next user in its
shard (wrapping with modulo), sends that user's current refresh token, and
overwrites the access/refresh tokens in its VU-local map with the rotated pair
from the response. VUs don't share refresh tokens, and the same user can be
refreshed repeatedly without exhausting the account pool.

To stress `POST /auth/logout-all`, refresh the pool immediately before the
test to ensure its 15-minute access tokens are current:

```powershell
node scripts/auth-token-pool.mjs refresh 11000
k6 run k6_tests/auth_service/logout/logout_all_stress.js
```

Each account is used at most once because logout-all revokes that account's
session. The stress profile ramps to 600 VUs over 25 seconds; with an 11,000
entry pool it can issue up to 11,000 logout-all requests. This test invalidates
the sessions in the pool, so refresh the pool again before running refresh
tests or other tests that need those sessions.

The `logout` command revokes the saved sessions and removes the local pool
file:

```powershell
node scripts/auth-token-pool.mjs logout
```

The single-session `POST /auth/logout` route is not included as a load profile:
each logout ends its session, so repeated logout load would need to create a new
session for every request and would mix login cost into the result. The
`POST /auth/logout-all` stress test above instead uses each saved account once.
Refresh tokens are single-use, so do not run multiple refresh tests against
the same accounts concurrently.

### Implemented API reference

All REST routes below require `Authorization: Bearer <accessToken>` unless marked **Public**. Requests with DTOs are validated, transformed, and reject unknown fields.

#### REST endpoints

| Method   | Route                                         | Access                     | What it does                                                                                                                                                                                                                                                          |
| -------- | --------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/`                                           | Public                     | Returns the application's greeting.                                                                                                                                                                                                                                   |
| `POST`   | `/auth/register`                              | Public                     | Registers a user. Body: `{ "name": "...", "username": "...", "phoneNumber": "+...", "password": "..." }`.                                                                                                                                                             |
| `POST`   | `/auth/login`                                 | Public                     | Authenticates with username and password. Body: `{ "username": "...", "password": "..." }`.                                                                                                                                                                           |
| `POST`   | `/auth/refresh`                               | Public                     | Rotates the refresh token. Body: `{ "refreshToken": "..." }`.                                                                                                                                                                                                         |
| `POST`   | `/auth/logout`                                | Public                     | Revokes the session identified by the supplied refresh token. Body: `{ "refreshToken": "..." }`.                                                                                                                                                                      |
| `POST`   | `/auth/logout-all`                            | Authenticated              | Revokes all of the current user's sessions and disconnects their sockets.                                                                                                                                                                                             |
| `GET`    | `/user`                                       | Authenticated              | Lists up to 50 users (id, name, username, and createdAt), newest first.                                                                                                                                                                                               |
| `GET`    | `/user/me`                                    | Authenticated              | Returns the current user's profile (id, name, username, phoneNumber, and createdAt).                                                                                                                                                                                  |
| `POST`   | `/conversations/direct/:otherUserId`          | Authenticated              | Gets or creates the direct conversation between the current user and the specified user. The response includes the conversation id, type, creation time, and member ids/roles.                                                                                        |
| `POST`   | `/conversations/groups`                       | Authenticated              | Creates a group with the current user as owner. Body: `{ "name": "...", "joinPolicy": "OPEN" }`; `joinPolicy` is optional and defaults to `REQUEST`.                                                                                                                  |
| `GET`    | `/conversations`                              | Authenticated              | Lists the current user's conversations, newest-updated first, including member summaries/count and the latest message.                                                                                                                                                |
| `GET`    | `/conversations/:id`                          | Authenticated              | Returns conversation details. Direct conversations require membership; authenticated users can view group details before joining.                                                                                                                                     |
| `PATCH`  | `/conversations/:id`                          | Authenticated, group owner | Updates a group's `name` and/or `joinPolicy` (`OPEN` or `REQUEST`). At least one field is required.                                                                                                                                                                   |
| `POST`   | `/conversations/:id/join`                     | Authenticated              | Joins an `OPEN` group immediately or creates/reopens a pending request for a `REQUEST` group.                                                                                                                                                                         |
| `DELETE` | `/conversations/:id/leave`                    | Authenticated member       | Leaves a group. The owner cannot leave.                                                                                                                                                                                                                               |
| `GET`    | `/conversations/:id/join-requests`            | Authenticated, group owner | Lists pending join requests for the group.                                                                                                                                                                                                                            |
| `PATCH`  | `/conversations/:id/join-requests/:requestId` | Authenticated, group owner | Approves or rejects a pending request. Body: `{ "action": "APPROVE" }` or `{ "action": "REJECT" }`.                                                                                                                                                                   |
| `DELETE` | `/conversations/:id/join-requests/me`         | Authenticated              | Cancels the current user's pending request for the group.                                                                                                                                                                                                             |
| `GET`    | `/conversations/:conversationId/messages`     | Authenticated member       | Lists messages in chronological order. Query: `limit` (default `50`, range `1`-`100`) and optional `cursor` (a message id from this conversation). Returns `{ "messages": [...], "nextCursor": "... or null", "hasMore": true }`; use `nextCursor` for the next page. |

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

| Direction       | Event                              | Payload / acknowledgement                                                                                                                                   | What it does                                                                                                                                                                                                                                   |
| --------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client → server | `conversation:join`                | `{ "conversationId": "<conversation UUID>" }`; acknowledges `{ "ok": true, "conversationId": "..." }` or `{ "ok": false, "error": "..." }`                  | Checks membership and joins this socket to the conversation room. Also emits a `presence:snapshot` to this socket containing the online IDs of the conversation's other members.                                                               |
| Client → server | `conversation:leave`               | `{ "conversationId": "<conversation UUID>" }`; acknowledges `{ "ok": true, "conversationId": "..." }`                                                       | Leaves the conversation room for this socket.                                                                                                                                                                                                  |
| Client → server | `message:send`                     | `{ "conversationId": "<conversation UUID>", "content": "..." }`; acknowledge with `{ "ok": true, "message": { ... } }` or `{ "ok": false, "error": "..." }` | Persists a message in a conversation where the authenticated user is a member. `content` is trimmed and must contain 1-2000 characters. The sender id is taken from the authenticated socket, not supplied by the client.                      |
| Server → client | `message:new`                      | Message object with `id`, `senderId`, `conversationId`, `content`, and `createdAt`                                                                          | Announces a persisted message to every connected socket of the conversation's other members and the sender's other sockets, except the socket that sent it. The originating socket receives the message in its `message:send` acknowledgement. |
| Client → server | `presence:get-snapshot`            | No payload; acknowledges `{ "ok": true }`                                                                                                                   | Requests an updated presence snapshot for the authenticated user's peers (users who share at least one conversation). The server also emits `presence:snapshot` to this socket.                                                                |
| Server → client | `presence:snapshot`                | `{ "onlineUserIds": ["<user UUID>", ...] }`                                                                                                                 | Lists currently online peers. Emitted on connection, on `presence:get-snapshot`, and after successfully joining a conversation (the latter contains that conversation's other members).                                                        |
| Server → client | `presence:online`                  | `{ "userId": "<user UUID>" }`                                                                                                                               | Announces that a peer sharing a conversation has become online. Emitted when their first socket connects.                                                                                                                                      |
| Server → client | `presence:offline`                 | `{ "userId": "<user UUID>" }`                                                                                                                               | Announces that a peer sharing a conversation has gone offline. Emitted when their last socket disconnects.                                                                                                                                     |
| Client → server | `typing:start`                     | `{ "conversationId": "<conversation UUID>" }`; acknowledges `{ "ok": true }` or `{ "ok": false, "error": "..." }`                                           | Emits `typing:started` to the other sockets in the conversation room. The user must be a member and this socket must have joined the room.                                                                                                     |
| Client → server | `typing:stop`                      | `{ "conversationId": "<conversation UUID>" }`; acknowledges `{ "ok": true }` or `{ "ok": false, "error": "..." }`                                           | Emits `typing:stopped` to the other sockets in the conversation room. The user must be a member and this socket must have joined the room.                                                                                                     |
| Server → client | `typing:started`, `typing:stopped` | `{ "conversationId": "<conversation UUID>", "userId": "<user UUID>" }`                                                                                      | Notifies the other sockets in a joined conversation when a member starts or stops typing. These events are ephemeral and are not persisted.                                                                                                    |

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

- [ ] Define the meaning of _accepted_, _persisted_, _delivered_ and _read_.
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
