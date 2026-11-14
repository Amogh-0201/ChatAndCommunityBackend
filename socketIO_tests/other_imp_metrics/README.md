# Socket.IO application-event performance benchmarks

These are local-only WebSocket benchmarks for message acknowledgements and
delivery, concurrent direct-message traffic, group fan-out, typing, room
membership, and presence. They do not change the backend implementation. Each
script runs one selected profile and writes a timestamped JSON report to
`socketIO_tests/other_imp_metrics/results/`. A shared lock prevents two of
these benchmarks from running at the same time.

## Confirmed protocol behavior

The scripts use the gateway's current events and payloads:

- Connect with `{ auth: { token } }` over the `websocket` transport.
- `message:send` payload: `{ conversationId, content }`; acknowledgement:
  `{ ok: true, message: { id, senderId, conversationId, content, createdAt } }`.
- `message:new` carries that persisted message shape. The sender's sending
  socket is excluded; other connected sockets for the sender and every
  connected socket for each other conversation member are included.
- `conversation:join` / `conversation:leave` payload:
  `{ conversationId }`; success acknowledgement: `{ ok: true, conversationId }`.
  A successful join also emits `presence:snapshot` with
  `{ onlineUserIds }`.
- `typing:start` and `typing:stop` use `{ conversationId }`, acknowledge with
  `{ ok: true }`, and emit `typing:started` / `typing:stopped` with
  `{ conversationId, userId }` to other sockets in the joined conversation
  room.
- `presence:get-snapshot` acknowledges `{ ok: true }` and emits
  `presence:snapshot` with `{ onlineUserIds }`. A connecting socket also gets
  an initial snapshot. `presence:online` / `presence:offline` carry
  `{ userId }` and are sent to the user's conversation peers.

Message delivery is correlated to the server-returned message ID. Realtime
typing events do not include an operation ID in their actual payload, so the
typing benchmark sends one operation at a time and matches the actual
conversation and user fields; it does not invent a wire-protocol field.

## Prepare users, tokens, and conversations

The benchmark scripts require test-user IDs from the existing conversation
fixture flow, a local auth-token pool, and stable direct conversations.
If the 11,000 test accounts have not yet been registered, seed them first
against the isolated local database:

```powershell
$env:USER_COUNT = "11000"
$env:SEED_TEST_DATABASE = "I_CONFIRMED_THIS_IS_THE_ISOLATED_TEST_DATABASE"
node scripts/seed-k6-users.mjs
Remove-Item Env:USER_COUNT, Env:SEED_TEST_DATABASE
```

Refresh the existing 11,000 test accounts and create the user-ID map and direct
pairs if those files are not current:

```powershell
node scripts/auth-token-pool.mjs login 11000
node scripts/auth-token-pool.mjs refresh 11000
node scripts/get-conversation-test-users.mjs
$env:SEED_TEST_DATABASE = "I_CONFIRMED_THIS_IS_THE_ISOLATED_TEST_DATABASE"
node scripts/create-conversation-test-direct.mjs
Remove-Item Env:SEED_TEST_DATABASE
```

`create-conversation-test-direct.mjs` pairs users 1-5,500 with users
5,501-11,000, so the concurrent benchmark can use disjoint, stable sender /
receiver pairs. If these accounts or their direct conversations already exist,
the existing direct-conversation script retrieves/resumes those pairs.

The existing 5,500 request-policy groups have only their owners as members;
they are not used by these group tests. Create separate OPEN group fixtures
with exactly 2, 5, 10, 25, and 50 members. The 50-member group supports the
largest realtime profile. The script reuses the first 50 load-test users and
can resume group membership after interruption:

```powershell
$env:SEED_TEST_DATABASE = "I_CONFIRMED_THIS_IS_THE_ISOLATED_TEST_DATABASE"
node scripts/create-socketio-performance-groups.mjs
Remove-Item Env:SEED_TEST_DATABASE
```

Fixture creation requires the API to use an isolated local test database. It
creates new groups with `joinPolicy: "OPEN"` and adds the remaining members
through the existing `POST /conversations/:id/join` API. It does not modify
the old request-policy groups. The generated fixture manifest and auth token
pool are ignored local data and must not be committed.

Refresh tokens immediately before the benchmark run if they may expire:

```powershell
node scripts/auth-token-pool.mjs refresh 11000
```

## Run each benchmark

Every benchmark defaults to its baseline profile. Choose one profile per
process; `heavy` profiles are never selected automatically. Do not run these
scripts simultaneously.

### 1. Message acknowledgement and delivery

Measures a single sender and receiver in a pre-created direct conversation.
The sender's measured application latency starts immediately before
`message:send`; connection time is excluded. Ack latency runs from send start
to the acknowledgement, and delivery latency runs from send start to the
recipient's `message:new`. The receiver is connected and listening before
sending starts.

```powershell
node socketIO_tests/other_imp_metrics/01_message_performance/message-performance.js

$env:PROFILE = "moderate"
node socketIO_tests/other_imp_metrics/01_message_performance/message-performance.js
Remove-Item Env:PROFILE
```

Profiles: `baseline` (100 messages, 500 ms gap), `light` (300, 200 ms),
`moderate` (500, 100 ms), and `heavy` (1,000, 50 ms).

### 2. Concurrent direct-message load

Connects every sender and its paired receiver before dispatch. All sender loops
then run concurrently; each sender sends sequentially with a random 100-300 ms
gap. Ack and receiver delivery are measured separately.

```powershell
node socketIO_tests/other_imp_metrics/02_concurrent_message_load/concurrent-message-load.js

$env:PROFILE = "moderate"
node socketIO_tests/other_imp_metrics/02_concurrent_message_load/concurrent-message-load.js
Remove-Item Env:PROFILE
```

Profiles (`connected clients / senders / messages per sender`): `baseline`
(10 / 5 / 20), `light` (20 / 10 / 30), `moderate` (50 / 25 / 30), and `heavy`
(100 / 50 / 30).

### 3. Group fan-out

Uses one sender and one connected socket for every member in a pre-created
group. Expected events exclude the sender's sending socket; this test creates
no second sender device. It reports per-recipient delivery latency and event
counts. It does not combine concurrent senders with fan-out.

```powershell
node socketIO_tests/other_imp_metrics/03_group_fanout_performance/group-fanout-performance.js

$env:PROFILE = "large"
node socketIO_tests/other_imp_metrics/03_group_fanout_performance/group-fanout-performance.js
Remove-Item Env:PROFILE
```

Profiles: `baseline` (2 members), `small` (5), `medium` (10), and `large` (25);
each sends 100 measured messages.

### 4. Typing, room, and presence

Select one scenario per invocation. Scenarios do not run together:

```powershell
$env:SCENARIO = "typing"
$env:PROFILE = "baseline"
node socketIO_tests/other_imp_metrics/04_realtime_events_performance/realtime-events-performance.js

$env:SCENARIO = "join-leave"
$env:PROFILE = "light"
node socketIO_tests/other_imp_metrics/04_realtime_events_performance/realtime-events-performance.js

$env:SCENARIO = "presence-snapshots"
$env:PROFILE = "moderate"
node socketIO_tests/other_imp_metrics/04_realtime_events_performance/realtime-events-performance.js

Remove-Item Env:PROFILE
$env:SCENARIO = "presence-transitions"
node socketIO_tests/other_imp_metrics/04_realtime_events_performance/realtime-events-performance.js
Remove-Item Env:SCENARIO
```

Profiles: `baseline` (10 clients, 100 typing start/stop pairs or room cycles /
snapshot requests), `light` (25, 250), and `moderate` (50, 500). The
presence-transition scenario is a small controlled check: one observer watches
the first and second socket connections for the same user, then the first
socket disconnects before the final socket. It reports online/offline
transitions and duplicate or premature transitions. It does not use a load
profile; `PROFILE` and `WARMUP_OPERATIONS` do not scale or repeat this scenario.

## What each test measures—and why it matters

These benchmarks isolate different Socket.IO paths. Their rates and latency
numbers are meaningful only with the workload shape beside them; they are not
interchangeable measures of a single “Socket.IO capacity.”

### Message acknowledgement and delivery

The message test has one sender send messages to a direct conversation with a
connected recipient. It measures the sender acknowledgement separately from
the recipient's `message:new` event, and checks delivery counts for missing or
duplicate events. This distinguishes the sender-visible completion path from
the recipient-visible real-time path. The acknowledgement follows the
message-handler work, including persistence and publishing the event; delivery
latency records when the peer actually receives that event. It is a paced,
single-sender test, not a many-sender contention test.

### Concurrent direct messages

This test connects multiple sender/receiver pairs first, then runs the sender
loops concurrently. It measures the effect of simultaneous independent direct
message writes and user-room deliveries. Compare it with the single-sender
test to see how contention changes throughput and tail latency; it does not
measure group fan-out.

### Group fan-out

One sender sends to a group while a socket for each member receives messages.
Expected delivery events exclude the sending socket, which does not receive
its own message. Varying group size isolates the cost of fan-out as recipient
count grows. This is not a many-sender test, so it should be read alongside,
not as a replacement for, concurrent direct messages.

### Realtime event scenarios

The typing, presence-snapshot, and join/leave scenarios use 50 connected
clients and 500 measured operations when run with the `moderate` profile.
Those are operations issued against a set of connected clients—not 500
simultaneous clients or necessarily 500 concurrent operations.

- **Typing:** 500 start/stop pairs produce 1,000 ephemeral events. The test
  measures acknowledgements and deliveries to the other group members, without
  a database message write. This isolates a high-frequency, transient event
  path.
- **Presence snapshots:** 500 requests measure the response snapshot and its
  acknowledgement, separately from the initial snapshot received on connect.
  This checks on-demand presence lookup/serialization and delivery.
- **Join/leave:** One actor performs 500 room join/leave cycles while the
  clients are connected. The test measures join and leave acknowledgements
  plus the separate presence snapshot emitted on join. This exercises room
  membership and its associated presence update; it is not 50 actors joining
  and leaving concurrently.
- **Presence transitions:** This is a correctness and single-event latency
  check, **not a moderate-load benchmark**. One observer watches one target
  user with two sockets: the first socket makes that user online, disconnecting
  only the first socket must not make the user offline, and disconnecting the
  final socket must produce one offline transition. The maximum is three
  connected sockets total (observer + two target sockets) and there is one
  controlled sequence. This verifies first-connect/last-disconnect semantics
  and catches premature or duplicate transitions, which a throughput test
  alone could miss.

The recorded transition report's `profile: moderate`, `clients: 50`, and
`workload: 500` fields are inherited configuration metadata, not the executed
workload; its summary correctly reports three peak connections and one
sequence. Its one online and one offline latency sample are useful as a
behavioral timing check, but their repeated percentile values do not describe
a latency distribution or capacity. New reports label this scenario
`profile: controlled` and record its actual socket and sequence counts.

For the recorded measurements, see
[the Socket.IO performance results](../../docs/v1_performance_results.md).

## Configuration and safety

All benchmark targets are restricted to local HTTP(S) hosts:

- `API_BASE_URL` (default `http://localhost:3000`).
- `BASE_URL` for the existing setup scripts; use the same local API origin as
  `API_BASE_URL` when overriding the default.
- `TOKEN_POOL_FILE` (default `scripts/.auth-token-pool.json`).
- `CONVERSATION_TEST_USERS_FILE` (default
  `scripts/.conversation-test-users.json`).
- `CONVERSATION_DIRECT_FILE` (default
  `scripts/.conversation-test-direct.json`).
- `SOCKETIO_GROUP_FIXTURE_FILE` (default
  `scripts/.socketio-performance-groups.json`).
- `CONNECT_TIMEOUT_MS`, `ACK_TIMEOUT_MS`, and `DELIVERY_TIMEOUT_MS` (default
  10,000 ms; valid values 100-60,000).
- `WARMUP_OPERATIONS` (default 0, allowed 0-5). Warm-up messages or events are
  excluded from measured counters and latency samples. The transition scenario
  is a single controlled sequence and does not use warm-up operations.
- `MESSAGE_DELAY_MIN_MS` / `MESSAGE_DELAY_MAX_MS` (default 100 / 300 ms, kept
  within 100-300 ms) for concurrent senders.

Only WebSocket transport is used and automatic reconnection is disabled. A
single profile is selected; profiles are fixed to the initial workloads above
and cannot be scaled up through a multiplier. Connection and acknowledgement
timeouts are explicit, delivery waits are bounded, and connected clients are
disconnected in cleanup even when execution fails.

These are application-event tests, not backend resource measurements. During
each run, use another terminal to observe Docker containers and note the API
and PostgreSQL rows:

```powershell
docker stats --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}"
```

Stop the live stats view with Ctrl+C after the run. The report's RSS, heap,
CPU-time, and event-loop delay metrics describe only the Node.js load
generator, not the backend or PostgreSQL.

## JSON report fields

Every report has the requested top-level shape:

- `testName`, `runId`, and `timestamp` identify the scenario and run.
- `environment` records the local target, Node version, WebSocket transport,
  and disabled reconnection.
- `configuration` records the selected profile, workload, timeouts, and
  warm-up settings.
- `summary` contains scenario-specific attempt, success, timeout, delivery,
  throughput, and active-connection counters; `cleanup` reports sockets
  connected before and after cleanup.
- `latencyMs` separates acknowledgements from deliveries or snapshot
  responses. Each latency summary has `min`, `average`, `p50`, `p90`, `p95`,
  `p99`, and `max`; empty sample sets are `null`.
- `resourceMetrics.loadGenerator` records client-process RSS, heap, CPU time,
  and event-loop delay p95/max.
- `errors` contains execution or malformed-ack details without access tokens.

Percentiles use the nearest-rank method (`ceil(p * sampleCount)`, one-based),
and p50 follows the same method. Acknowledgement timeouts have no acknowledgement
latency sample. Message delivery latency is correlated by the actual message ID
returned in the acknowledgement; an event that arrives first is retained until
that ID is known. Initial presence snapshots are timed from connection
initiation, so that one explicitly named metric includes the Socket.IO
handshake; per-operation acknowledgement and delivery metrics do not.

These scripts have not been run against the user's live local API/database in
this workspace. Prepare the fixtures and run a baseline profile first; a
successful syntax check alone does not establish runtime benchmark validity.
