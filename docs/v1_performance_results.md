# V1 Performance Test Results

## Authentication service

### Executive summary

These are exploratory local k6 results for authentication registration,
login, refresh, and logout-all. The tests show different throughput patterns:

- **Registration and login** plateaued around 19–20 requests/second. Latency
  rose sharply as concurrency increased. Login also returned HTTP 500 errors
  in the 200- and 400-VU runs.
- **Refresh** completed all recorded requests without HTTP failures. Throughput
  stayed around 252–268 requests/second across 50 to 1,000 configured peak VUs,
  while p95 latency rose from about 180 ms at 50 VUs to 5.29 seconds in the
  short 1,000-VU spike.
- **Logout-all** at a 600-VU peak completed 2,963 HTTP requests, of which 538
  (18.15%) returned HTTP 500. The API logs associate these failures with
  Prisma `P2028` while starting the transaction in `AuthService.logoutAll`.
  This was a transaction-start/server error, not an HTTP 401 authentication
  failure.

The login server errors were associated with Prisma `P2028` while starting the
transaction that creates an auth session and refresh token. The logs locate
the failing operation, but do not establish which resource limit caused it.

| Endpoint / profile              | Configured peak VUs | Requests |   Throughput | HTTP failures | Checks passed | Avg latency | p95 latency | Max latency |
| ------------------------------- | ------------------: | -------: | -----------: | ------------: | ------------: | ----------: | ----------: | ----------: |
| Register load, 20 VUs           |                  20 |      605 |  19.43 req/s |        0 (0%) |          100% |      515 ms |      1.11 s |      1.44 s |
| Register load, 40 VUs           |                  40 |      635 |  19.97 req/s |        0 (0%) |          100% |      1.00 s |      1.84 s |      1.92 s |
| Register load, 50 VUs           |                  50 |      658 |  20.40 req/s |        0 (0%) |          100% |      1.22 s |      2.31 s |      2.43 s |
| Register stress                 |                 200 |    1,724 |  20.33 req/s |        0 (0%) |          100% |      4.26 s |      9.54 s |     20.24 s |
| Register spike                  |                 400 |      876 |  19.51 req/s |        0 (0%) |          100% |      8.89 s |     19.32 s |     29.70 s |
| Login load, 50 VUs              |                  50 |      636 |  19.74 req/s |        0 (0%) |          100% |      1.26 s |      2.30 s |      2.39 s |
| Login stress                    |                 200 |    1,671 |  19.63 req/s |     6 (0.35%) |        99.64% |      4.40 s |      9.68 s |     51.45 s |
| Login spike                     |                 400 |      878 |  19.46 req/s |     3 (0.34%) |        99.65% |      8.85 s |     19.37 s |     29.88 s |
| Login spike variant             |                 350 |      815 |  19.36 req/s |        0 (0%) |          100% |      7.55 s |     16.72 s |     26.81 s |
| Refresh load, 50 VUs / 30 s     |                  50 |    8,058 | 267.57 req/s |        0 (0%) |          100% |    93.24 ms |   179.88 ms |   298.29 ms |
| Refresh load, 200 VUs / 30 s    |                 200 |    8,051 | 264.21 req/s |        0 (0%) |          100% |   378.90 ms |   688.71 ms |   783.73 ms |
| Refresh stress, ramp to 600 VUs |                 600 |    6,413 | 252.67 req/s |        0 (0%) |          100% |      1.11 s |      2.15 s |      2.18 s |
| Refresh spike, peak 1,000 VUs   |               1,000 |    3,327 | 252.02 req/s |        0 (0%) |          100% |      1.88 s |      5.29 s |      5.73 s |
| Logout-all stress               |                 600 |    2,963 | 116.42 req/s | 538 (18.15%) |         81.84% |      2.41 s |      4.34 s |      4.52 s |

Configured peak VUs represent the profile's target maximum, not the number of
requests completed simultaneously. Throughput is completed HTTP requests per
second. As latency rises, each VU completes fewer iterations, so concurrency,
throughput, and latency should be considered together.

### Test scope and conditions

- **Load generator:** k6.
- **Endpoints:** `POST /auth/register`, `POST /auth/login`, and
  `POST /auth/refresh`, and authenticated `POST /auth/logout-all`.
- **Checks:** registration checks HTTP 201; login checks HTTP 200, expected
  username, and both tokens; refresh checks HTTP 200, expected username, and
  a rotated refresh token; logout-all checks HTTP 200 and `{ "success": true }`.
- **Thresholds:** no pass/fail performance thresholds were enabled. The check
  and HTTP failure metrics still report request outcomes.
- **Database effects:** successful registration and login create auth
  sessions and refresh-token records. Refresh rotates the refresh-token record
  on every successful request. Logout-all revokes all active sessions and
  refresh tokens for the authenticated user.
- **Environment:** local Docker-based API/database and local k6 runs. CPU,
  memory, PostgreSQL connection count, and load-generator resource usage were
  not recorded.

These runs are exploratory samples, not a production-readiness assessment or
a precise capacity benchmark. Run duration, machine load, database state, and
runtime configuration can materially affect the results.

### Registration

All recorded registration requests returned HTTP 201. Throughput stayed
between 19.43 and 20.40 req/s as configured peak concurrency increased from
20 to 400 VUs. At the same time, p95 latency grew from 1.11 seconds to 19.32
seconds. This indicates that the tested setup did not gain throughput from
additional concurrency; requests instead experienced substantially longer
latency.

The 200-VU stress profile used stages of 20, 50, 100, 150, and 200 VUs, followed
by ramp-down. The 400-VU spike profile ramped from 5 to 400 VUs in 2 seconds,
then returned to 5 VUs.

### Login

The 50-VU login load run passed all 636 checks. The 200-VU stress run returned
6 HTTP 500 responses out of 1,671 requests (0.35%); the 400-VU spike returned
3 HTTP 500 responses out of 878 requests (0.34%). API logs reported Prisma
`P2028` (“Unable to start a transaction in the given time”) in
`AuthService.createTokenPair` while creating the auth session and refresh
token.

The 350-VU spike variant had no failures in 815 requests, but its p95 latency
was still 16.72 seconds. A single short successful run does not establish a
safe capacity limit. Across all login runs, throughput remained close to
19–20 req/s while latency increased substantially.

The logs identify the transaction-start path, not the underlying bottleneck.
Investigate API and database CPU/memory, PostgreSQL active connections, Prisma
adapter pool settings, and transaction wait behavior before changing timeout
configuration. Increasing a wait limit alone can increase latency without
increasing throughput.

### Refresh

All four recorded refresh runs completed with 100% successful checks and no
HTTP failures. Throughput was similar—about 252–268 req/s—from the 50-VU load
run through the 1,000-VU spike. Latency increased with the offered concurrency:
p95 was about 180 ms at 50 VUs, 689 ms at 200 VUs, 2.15 seconds in the
600-VU stress run, and 5.29 seconds in the 1,000-VU spike.

The stress profile used 5-second stages targeting 100, 200, 400, 600, and then
100 VUs (25 seconds total). The spike profile targeted 100 VUs for 5 seconds,
raised the target to 1,000 for 2 seconds, then returned to 100 for 5 seconds.
The spike's 1,000 VUs are a brief peak; the result should not be read as a
30-second sustained 1,000-VU test.

The refresh test uses separate token state per VU. Each VU owns a disjoint
subset of users, selects users within that subset in rotation, and replaces
its local access/refresh tokens with the newly issued pair. This avoids
concurrent reuse of the server's single-use refresh token. k6 keeps the rotated
tokens in memory, so refresh the local token-pool file before another test run.

These results show that refresh handled higher observed request rates than
registration or login in this local setup. They do not prove that the refresh
endpoint alone is responsible for that difference: refresh has a different
code path, and the tests were not run as a controlled, simultaneous comparison
with resource telemetry.

### Logout-all

Only the stress profile is recorded for this route; no load or spike result was
saved, so none is reported here.

The logout-all stress profile ramped through 100, 200, 400, and 600 VUs, then
back to 100 over 25 seconds. It made 2,963 HTTP requests: 2,425 succeeded and
538 returned HTTP 500 (18.15% failure rate). Successful-request p95 latency
was 4.35 seconds; overall p95 was 4.34 seconds. The API logs identify Prisma
`P2028` (“Unable to start a transaction in the given time”) while starting the
transaction in `AuthService.logoutAll`.

This is the observed failure: the request reached the server but the server
could not start the Prisma transaction in time. It is not evidence of an
invalid or reused token; those would normally be rejected as HTTP 401. The
same Prisma error code was seen in earlier high-concurrency login runs, but
the evidence does not establish whether the common cause is the connection
pool, database capacity, or another transaction-start resource limit.

The test reported **1,831,742 k6 iterations**, but that is not the number of
logout requests. In k6, an iteration counts one execution of the script's
default function. The logout helper returns without sending HTTP when its
calculated user index is outside the 11,000-entry token pool; k6 still counts
those fast, empty executions as iterations. Only `http_reqs` (2,963 here)
counts requests sent to the API. Therefore 1,831,742 iterations must not be
reported as logout throughput or as successful logout operations. The
`iterations/s` and `iteration_duration` figures are misleading for this run
because most iterations did no work.
The final k6 `✓` indicates that the scenario completed; it does not mean every
check passed. No failure threshold was configured, and the 538 failed checks
are still reflected in the results above.

The `logout-all` test uses a saved account once because the route revokes that
user's sessions. Its effective request count is limited by both the pool and
the number of unique users the test reaches during the run. For a meaningful
follow-up, stop counting empty iterations (or make VUs wait once the pool is
exhausted), and report HTTP request metrics separately. Also capture API and
database resource metrics while investigating the `P2028` transaction-start
failures.

### Reproducibility and next steps

- See the [registration load](../k6_tests/auth_service/register/register_user_load.js),
  [stress](../k6_tests/auth_service/register/register_user_stress.js), and
  [spike](../k6_tests/auth_service/register/register_user_spike.js) scripts.
- See the [login load](../k6_tests/auth_service/login/login_user_load.js),
  [stress](../k6_tests/auth_service/login/login_user_stress.js), and
  [spike](../k6_tests/auth_service/login/login_user_spike.js) scripts.
- See the [refresh load](../k6_tests/auth_service/refresh/refresh_user_load.js),
  [stress](../k6_tests/auth_service/refresh/refresh_user_stress.js), and
  [spike](../k6_tests/auth_service/refresh/refresh_user_spike.js) scripts.
- See the [logout-all stress](../k6_tests/auth_service/logout/logout_all_stress.js)
  script. It consumes one saved account session per request.
- Refresh the saved token pool before each refresh run; refresh tokens are
  single-use and rotated tokens from k6 are not persisted to the pool file.
- Repeat each profile and record API/database CPU and memory, PostgreSQL
  connection counts, database state, k6 version/host, test duration, and
  script revision.
- Compare throughput, p95/max latency, and failure rate. Use longer steady
  stages in addition to brief spikes when evaluating sustained capacity.

### Recorded raw refresh summaries

The following summaries preserve the key k6 metrics from the recorded refresh
runs.

#### Refresh load — 50 VUs for 30 seconds

```text
checks_total.......: 8058    267.565643/s
checks_succeeded...: 100.00% 8058 out of 8058
checks_failed......: 0.00%   0 out of 8058
http_req_duration..: avg=93.24ms min=9.67ms med=86.03ms max=298.29ms p(90)=163.94ms p(95)=179.88ms
http_req_failed....: 0.00%  0 out of 8058
http_reqs..........: 8058    267.565643/s
vus_max............: 50
```

#### Refresh load — 200 VUs for 30 seconds

```text
checks_total.......: 8051    264.206031/s
checks_succeeded...: 100.00% 8051 out of 8051
checks_failed......: 0.00%   0 out of 8051
http_req_duration..: avg=378.9ms min=12.01ms med=390.77ms max=783.73ms p(90)=660.59ms p(95)=688.71ms
http_req_failed....: 0.00%  0 out of 8051
http_reqs..........: 8051    264.206031/s
vus_max............: 200
```

#### Refresh stress — ramp to 600 VUs

```text
stages:
  5s at 100, 5s at 200, 5s at 400, 5s at 600, 5s at 100
checks_total.......: 6413    252.669128/s
checks_succeeded...: 100.00% 6413 out of 6413
checks_failed......: 0.00%   0 out of 6413
http_req_duration..: avg=1.11s min=12.56ms med=952.83ms max=2.18s p(90)=2.06s p(95)=2.15s
http_req_failed....: 0.00%  0 out of 6413
http_reqs..........: 6413    252.669128/s
vus_max............: 600
```

#### Refresh spike — peak 1,000 VUs

```text
stages:
  5s at 100, 2s at 1000, 5s at 100
checks_total.......: 3327    252.018485/s
checks_succeeded...: 100.00% 3327 out of 3327
checks_failed......: 0.00%   0 out of 3327
http_req_duration..: avg=1.88s min=12.75ms med=1.66s max=5.73s p(90)=4.75s p(95)=5.29s
http_req_failed....: 0.00%  0 out of 3327
http_reqs..........: 3327    252.018485/s
vus_max............: 1000
```

#### Logout all stress

  stages: [
    { duration: '5s', target: 100 },
    { duration: '5s', target: 200 },
    { duration: '5s', target: 400 },
    { duration: '5s', target: 600 },
    { duration: '5s', target: 100 },
  ]

 TOTAL RESULTS

    checks_total.......: 2963   116.420154/s
    checks_succeeded...: 81.84% 2425 out of 2963
    checks_failed......: 18.15% 538 out of 2963

    ✗ logout-all returns 200 and success
      ↳  81% — ✓ 2425 / ✗ 538

    HTTP
    http_req_duration..............: avg=2.41s  min=13.38ms med=2.58s max=4.52s p(90)=4.14s p(95)=4.34s
      { expected_response:true }...: avg=2.07s  min=13.38ms med=1.84s max=4.52s p(90)=3.88s p(95)=4.35s
    http_req_failed................: 18.15%  538 out of 2963
    http_reqs......................: 2963    116.420154/s

    EXECUTION
    iteration_duration.............: avg=4.04ms min=0s      med=0s    max=4.54s p(90)=0s    p(95)=537.69µs
    iterations.....................: 1831742 71971.54451/s
    vus............................: 285     min=19          max=600
    vus_max........................: 600     min=600         max=600

    NETWORK
    data_received..................: 773 kB  30 kB/s
    data_sent......................: 1.4 MB  54 kB/s




running (25.5s), 000/600 VUs, 1831742 complete and 0 interrupted iterations
default ✓ [======================================] 000/600 VUs  25s

##### Failure cause
ERRO[0023] Logout-all failed for loadtest_user_590: HTTP 500; error=none  source=console
ERRO[0024] Logout-all failed for loadtest_user_593: HTTP 500; error=none  source=console
ERRO[0023] Logout-all failed for loadtest_user_1033: HTTP 500; error=none  source=console
ERRO[0024] Logout-all failed for loadtest_user_2011: HTTP 500; error=none  source=console

logs in api:
api-1  | [Nest] 78  - 11/09/2026, 4:15:19 PM   ERROR [ExceptionsHandler] PrismaClientKnownRequestError: Transaction API error: Unable to start a transaction in the given time.
api-1  |     at #c (/app/node_modules/@prisma/client/runtime/client.js:57:14161)
api-1  |     at yr.transaction (/app/node_modules/@prisma/client/runtime/client.js:58:1820)
api-1  |     at async Proxy._transactionWithCallback (/app/node_modules/@prisma/client/runtime/client.js:99:4732)
api-1  |     at async AuthService.logoutAll (/app/dist/modules/auth/auth.service.js:204:28)
api-1  |     at async file:///app/node_modules/@nestjs/core/router/router-execution-context.js:68:62
api-1  |     at async AuthController.logoutAll (file:///app/node_modules/@nestjs/core/router/router-proxy.js:6:17) {
api-1  |   code: 'P2028',
api-1  |   meta: {},
api-1  |   clientVersion: '7.10.1'
api-1  | }


## User service

### Test method and how to read the profiles

These runs exercise the authenticated user endpoints with access tokens from
the local test-user pool. Each iteration sends one request, and the token
selection cycles through the pool with modulo. `GET /user` requests the first
page with `limit=50`; `GET /user/me` reads the authenticated user's profile;
`PATCH /user` sends that account's existing name, username, or both, selected
randomly, so the endpoint is exercised without changing the saved identity.

A k6 `stages` duration is the time to move the VU target from the previous
stage's target to the next one; it does not mean that target was held for the
whole duration. For example, two consecutive 15-second stages both targeting
450 VUs mean 15 seconds ramping up to 450, followed by 15 seconds holding 450.
The tables distinguish those ramp/hold profiles from earlier runs whose exact
stage definitions were not captured. The recorded elapsed run time and maximum
VU count alone do not prove a fixed-concurrency hold.

All recorded user-service runs below reported 100% successful checks and 0%
HTTP request failures. These are local exploratory measurements; no pass/fail
performance thresholds were configured.

### Find all users

The test exercises authenticated `GET /user?limit=50` and checks the first-page
user fields and pagination metadata. The earlier 100-, 200-, 300-, and
450-target runs used ramp-up profiles and have been superseded; they are not
included as fixed-VU results. The recorded 450-VU profile below ramps for
15 seconds and then holds 450 VUs for 15 seconds.

| Profile | VU target sequence | Elapsed | Requests | Throughput | Checks passed | HTTP failures | Avg latency | p95 latency | Max latency |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Load | 15 s ramp to 450; 15 s hold at 450 | 30.8 s | 9,559 | 310.46 req/s | 100% | 0 (0%) | 1.07 s | 1.73 s | 1.84 s |
| Stress | Ramp/hold targets: 100, 100, 200, 400, 400, 800, 800; then ramp down to 200 | 40.4 s | 13,513 | 334.86 req/s | 100% | 0 (0%) | 1.21 s | 2.35 s | 2.42 s |
| Spike | Ramp to 200 (5 s), ramp to 1,000 (3 s), hold 1,000 (2 s), ramp down to 200 (5 s) | 15.6 s | 4,709 | 302.27 req/s | 100% | 0 (0%) | 1.81 s | 5.50 s | 6.39 s |

Stress stages were 5 s to 100, 2 s at 100, 5 s to 200, 5 s to 400, 3 s at
400, 5 s to 800, 5 s at 800, then 10 s ramping down to 200 (40 s configured;
k6 reported 40.4 s elapsed). The spike's 1,000 VUs were held only for the
second 2-second stage after ramping toward that target for 3 seconds.

### Get me

The test exercises authenticated `GET /user/me` and validates that the returned
profile belongs to the account associated with the access token.

| Profile | VU target sequence | Elapsed | Requests | Throughput | Checks passed | HTTP failures | Avg latency | p95 latency | Max latency |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Earlier load run | Target/max 300 VUs; stage definitions not recorded | 30.2 s | 16,181 | 535.00 req/s | 100% | 0 (0%) | 280.53 ms | 502.66 ms | 587.83 ms |
| Load | 15 s ramp to 500; 15 s hold at 500 | 30.5 s | 15,357 | 503.07 req/s | 100% | 0 (0%) | 742.90 ms | 1.13 s | 1.23 s |
| Stress | Ramp/hold targets: 200, 200, 400, 400, 900, 900; then ramp down to 400, hold 400, and ramp down to 200 | 47.2 s | 23,947 | 507.68 req/s | 100% | 0 (0%) | 916.24 ms | 1.72 s | 1.81 s |
| Spike | Ramp to 400 (4 s), hold 400 (2 s), ramp to 1,500 (4 s), hold 1,500 (2 s), ramp down to 400 (4 s) | 16.6 s | 7,860 | 474.51 req/s | 100% | 0 (0%) | 1.77 s | 5.24 s | 6.42 s |

The 300-VU run is retained as a historical result, but its stage plan was not
saved, so it cannot be presented as a 30-second hold at 300 VUs. The stress
stages were 5 s to 200, 5 s at 200, 5 s to 400, 5 s at 400, 10 s to 900,
5 s at 900, 5 s down to 400, 2 s at 400, then 5 s down to 200 (47 s total).
The spike held the 1,500-VU target for 2 seconds after a 4-second ramp.

### Update user

The test exercises authenticated `PATCH /user`. For each request, the body
randomly contains the current account's name, its current username, or both.
The update check confirms the returned profile still has the same identity;
these requests exercise the update path without intentionally changing test
account names or usernames.

| Profile | VU target sequence | Elapsed | Requests | Throughput | Checks passed | HTTP failures | Avg latency | p95 latency | Max latency |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Earlier load run | Target/max 200 VUs; stage definitions not recorded | 30.3 s | 14,706 | 485.70 req/s | 100% | 0 (0%) | 206.11 ms | 375.00 ms | 419.50 ms |
| Earlier load run | Target/max 300 VUs; stage definitions not recorded | 30.4 s | 14,200 | 467.76 req/s | 100% | 0 (0%) | 321.32 ms | 599.66 ms | 670.58 ms |
| Load | 15 s ramp to 450; 15 s hold at 450 | 30.4 s | 13,944 | 458.16 req/s | 100% | 0 (0%) | 734.08 ms | 1.02 s | 1.08 s |
| Stress | Ramp/hold targets: 200, 200, 400, 400, 800, 800; then ramp down to 200 | 45.2 s | 20,161 | 445.96 req/s | 100% | 0 (0%) | 1.00 s | 1.73 s | 1.84 s |
| Spike | Ramp to 200 (5 s), ramp to 1,000 (2 s), hold 1,000 (2 s), ramp down to 200 (5 s) | 14.3 s | 5,880 | 411.15 req/s | 100% | 0 (0%) | 1.30 s | 4.66 s | 5.86 s |

The earlier 200- and 300-VU load runs are retained for reference, but their
stage plans were not recorded; do not read them as sustained fixed-VU tests.
The stress stages were 5 s to 200, 5 s at 200, 5 s to 400, 5 s at 400,
10 s to 800, 5 s at 800, then 10 s ramping down to 200 (45 s configured;
k6 reported 45.2 s elapsed). The spike held 1,000 VUs for 2 seconds after a
2-second ramp toward that target.


## Conversation service

### Test scope and interpretation

These runs exercise authenticated `POST /conversations/direct/:otherUserId`,
`POST /conversations/groups`, `POST /conversations/:id/join`,
`GET /conversations/:id/join-requests`,
`PATCH /conversations/:id/join-requests/:requestId`, `GET /conversations`,
`GET /conversations/:id`, and `PATCH /conversations/:id`. Each k6 iteration
sends one HTTP request. The direct-conversation and group profiles randomly
select an eligible account for each iteration; the direct-conversation profile
also selects a different participant at random. Selection is with replacement,
so a pair can recur.
The [direct-conversation profiles](../k6_tests/conversation_service/get_or_create_direct_conversations/)
and [group profiles](../k6_tests/conversation_service/create_groups/) check
HTTP 201 responses and the expected conversation members or group owner.
The [join profiles](../k6_tests/conversation_service/converstion_join/) choose
a random user and group; expected duplicate or already-member conflicts count
as valid responses. The
[join-request listing profiles](../k6_tests/conversation_service/get_conversation_join_req/)
cycle through saved groups and authenticate as each group's owner.
The [review profiles](../k6_tests/conversation_service/review_conversation_join_req/)
use the saved request list and authenticate as the corresponding group owner.
The [conversation-list profiles](../k6_tests/conversation_service/get_my_conversations/)
cycle through all 11,000 users. The
[conversation-details profiles](../k6_tests/conversation_service/get_conversation_details/)
cycle through saved groups and authenticated users, while the
[group-update profiles](../k6_tests/conversation_service/update_group/) cycle
through groups and authenticate as each owner.

The direct endpoint is a get-or-create operation. Its response does not indicate
whether a request created a conversation or returned an existing one, so the
latency figures below combine both outcomes. Group creation persists a new group
for every successful request. All recorded checks passed and no HTTP request
failures were reported. No performance thresholds or system-resource metrics
were recorded; treat these as local exploratory results.

The recorded stage schedules were:

- **Load:** 15 s ramp to 450 VUs, then 15 s holding at 450.
- **Stress:** 5 s to 100; 2 s holding at 100; 5 s to 200; 5 s to 400; 3 s
  holding at 400; 5 s to 800; 5 s holding at 800; 10 s down to 200.
- **Spike:** 3 s to 200; 2 s holding at 200; 3 s to 1,000; 2 s holding at
  1,000; 5 s down to 200.

### Get or create direct conversations

| Profile | Elapsed | Active VUs (min-max) | Requests / iterations | Throughput | Checks passed | HTTP failures | Data received | Data sent |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Load | 31.1 s | 29-450 | 8,744 / 8,744 | 281.59 req/s | 100% (8,744/8,744) | 0 (0%) | 4.2 MB (136 kB/s) | 4.4 MB (143 kB/s) |
| Stress | 40.5 s | 18-800 | 11,433 / 11,433 | 282.04 req/s | 100% (11,433/11,433) | 0 (0%) | 5.5 MB (137 kB/s) | 5.8 MB (143 kB/s) |
| Spike | 15.8 s | 59-1,000 | 4,081 / 4,081 | 258.99 req/s | 100% (4,081/4,081) | 0 (0%) | 2.0 MB (125 kB/s) | 2.1 MB (131 kB/s) |

| Profile | Metric | Average | Minimum | Median | p90 | p95 | Maximum |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Load | HTTP request | 1.18 s | 8.40 ms | 1.48 s | 1.57 s | 1.60 s | 1.66 s |
| Load | Iteration | 1.18 s | 8.90 ms | 1.48 s | 1.57 s | 1.60 s | 1.66 s |
| Stress | HTTP request | 1.44 s | 11.01 ms | 1.32 s | 2.70 s | 2.74 s | 2.82 s |
| Stress | Iteration | 1.44 s | 11.01 ms | 1.32 s | 2.70 s | 2.74 s | 2.82 s |
| Spike | HTTP request | 2.10 s | 39.82 ms | 2.31 s | 3.46 s | 4.10 s | 4.50 s |
| Spike | Iteration | 2.10 s | 41.01 ms | 2.31 s | 3.46 s | 4.10 s | 4.50 s |

### Create groups

| Profile | Elapsed | Active VUs (min-max) | Requests / iterations | Throughput | Checks passed | HTTP failures | Data received | Data sent |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Load | 31.0 s | 14-450 | 9,148 / 9,148 | 295.40 req/s | 100% (9,148/9,148) | 0 (0%) | 5.8 MB (187 kB/s) | 5.2 MB (167 kB/s) |
| Stress | 40.4 s | 18-800 | 12,032 / 12,032 | 297.53 req/s | 100% (12,032/12,032) | 0 (0%) | 7.6 MB (188 kB/s) | 6.8 MB (168 kB/s) |
| Spike | 15.6 s | 59-1,000 | 4,322 / 4,322 | 277.12 req/s | 100% (4,322/4,322) | 0 (0%) | 2.7 MB (175 kB/s) | 2.4 MB (157 kB/s) |

| Profile | Metric | Average | Minimum | Median | p90 | p95 | Maximum |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Load | HTTP request | 1.13 s | 16.79 ms | 1.41 s | 1.51 s | 1.52 s | 1.58 s |
| Load | Iteration | 1.13 s | 17.41 ms | 1.41 s | 1.51 s | 1.52 s | 1.58 s |
| Stress | HTTP request | 1.36 s | 12.54 ms | 1.26 s | 2.59 s | 2.66 s | 2.75 s |
| Stress | Iteration | 1.37 s | 12.54 ms | 1.26 s | 2.60 s | 2.66 s | 2.75 s |
| Spike | HTTP request | 1.96 s | 39.56 ms | 2.05 s | 3.34 s | 4.10 s | 4.58 s |
| Spike | Iteration | 1.96 s | 41.39 ms | 2.05 s | 3.34 s | 4.10 s | 4.58 s |

The recorded group spike used the 3 s / 2 s / 3 s / 2 s / 5 s schedule listed
above. The current [create_groups_spike.js](../k6_tests/conversation_service/create_groups/create_groups_spike.js)
profile has a different stage schedule; compare these results only with runs
using the recorded schedule, or rerun after aligning the profiles.

### Join groups

All recorded runs completed every check without HTTP failures. Checks include
expected conflict responses, so 100% passing checks does not mean every request
created a new join request.

| Profile | Elapsed | Active VUs (min-max) | Requests / iterations | Throughput | Checks passed | HTTP failures | Data received | Data sent |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Load | 30.9 s | 29-450 | 7,519 / 7,519 | 243.13 req/s | 100% (7,519/7,519) | 0 (0%) | 3.7 MB (120 kB/s) | 3.8 MB (123 kB/s) |
| Stress | 40.5 s | 18-800 | 10,480 / 10,480 | 258.46 req/s | 100% (10,480/10,480) | 0 (0%) | 5.2 MB (127 kB/s) | 5.3 MB (131 kB/s) |
| Spike | 15.8 s | 58-1,000 | 3,744 / 3,744 | 237.45 req/s | 100% (3,744/3,744) | 0 (0%) | 1.8 MB (117 kB/s) | 1.9 MB (120 kB/s) |

| Profile | Metric | Average | Minimum | Median | p90 | p95 | Maximum |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Load | HTTP request | 1.37 s | 112.35 ms | 1.58 s | 1.69 s | 1.72 s | 1.81 s |
| Load | Iteration | 1.37 s | 112.87 ms | 1.58 s | 1.69 s | 1.72 s | 1.81 s |
| Stress | HTTP request | 1.58 s | 8.96 ms | 1.38 s | 2.97 s | 3.03 s | 3.11 s |
| Stress | Iteration | 1.58 s | 9.66 ms | 1.38 s | 2.97 s | 3.03 s | 3.11 s |
| Spike | HTTP request | 2.30 s | 21.46 ms | 2.45 s | 3.97 s | 4.60 s | 4.91 s |
| Spike | Iteration | 2.30 s | 21.98 ms | 2.45 s | 3.97 s | 4.60 s | 4.91 s |

### Get conversation join requests

The test authenticates as each saved group owner and cycles through the
5,500 saved groups. Each check verifies that the owner receives HTTP 200 and
an array of join requests.

| Profile | Elapsed | Active VUs (min-max) | Requests / iterations | Throughput | Checks passed | HTTP failures | Data received | Data sent |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Load | 30.7 s | 29-450 | 8,392 / 8,392 | 273.10 req/s | 100% (8,392/8,392) | 0 (0%) | 13 MB (406 kB/s) | 4.1 MB (135 kB/s) |
| Stress | 40.3 s | 19-800 | 11,069 / 11,069 | 274.34 req/s | 100% (11,069/11,069) | 0 (0%) | 16 MB (407 kB/s) | 5.5 MB (136 kB/s) |
| Spike | 15.8 s | 51-1,000 | 3,659 / 3,659 | 232.31 req/s | 100% (3,659/3,659) | 0 (0%) | 5.4 MB (345 kB/s) | 1.8 MB (115 kB/s) |

| Profile | Metric | Average | Minimum | Median | p90 | p95 | Maximum |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Load | HTTP request | 1.22 s | 37.01 ms | 1.44 s | 1.67 s | 1.88 s | 2.06 s |
| Load | Iteration | 1.22 s | 37.54 ms | 1.44 s | 1.67 s | 1.89 s | 2.06 s |
| Stress | HTTP request | 1.48 s | 7.50 ms | 1.48 s | 2.97 s | 3.02 s | 3.11 s |
| Stress | Iteration | 1.48 s | 8.55 ms | 1.49 s | 2.97 s | 3.02 s | 3.11 s |
| Spike | HTTP request | 2.44 s | 42.55 ms | 2.17 s | 5.70 s | 6.29 s | 6.44 s |
| Spike | Iteration | 2.44 s | 43.64 ms | 2.17 s | 5.71 s | 6.29 s | 6.44 s |

The stress and spike runs used the same target schedules listed above for the
conversation profiles. Throughput stayed around 232–274 req/s, with p95 request
latency increasing to 6.29 seconds in the 1,000-VU spike. These are exploratory
local results; no performance thresholds or system-resource metrics were
recorded.

### Review conversation join requests

Each iteration selects a saved pending request, authenticates as that group's
owner, and randomly approves or rejects the request. The collector must be run
again before each profile to refresh pending requests. Repeated reviews that
return the expected already-reviewed conflict are counted as valid checks.

| Profile | VU target sequence | Elapsed | Active VUs | Requests / iterations | Throughput | Checks passed | HTTP failures | Data received | Data sent |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Load | 15 s ramp to 450; 15 s hold at 450 | 31.0 s | 28-450 | 7,783 / 7,783 | 250.77 req/s | 100% (7,783/7,783) | 0 (0%) | 3.9 MB (127 kB/s) | 4.7 MB (152 kB/s) |
| Stress | 3 s to 100; 2 s hold; 3 s to 200; 3 s to 400; 2 s hold; 5 s to 800; 5 s hold; 5 s down to 200 | 28.7 s | 30-800 | 6,802 / 6,802 | 237.27 req/s | 100% (6,802/6,802) | 0 (0%) | 3.4 MB (120 kB/s) | 4.1 MB (143 kB/s) |
| Spike | 3 s to 200; 2 s hold; 3 s to 1,000; 2 s hold; 5 s down to 200 | 15.8 s | 58-1,000 | 3,655 / 3,655 | 230.90 req/s | 100% (3,655/3,655) | 0 (0%) | 1.8 MB (117 kB/s) | 2.2 MB (140 kB/s) |

| Profile | Metric | Average | Minimum | Median | p90 | p95 | Maximum |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Load | HTTP request | 1.33 s | 17.29 ms | 1.63 s | 1.78 s | 1.86 s | 1.94 s |
| Load | Iteration | 1.33 s | 17.31 ms | 1.63 s | 1.78 s | 1.86 s | 1.94 s |
| Stress | HTTP request | 1.86 s | 11.76 ms | 2.16 s | 3.16 s | 3.18 s | 3.22 s |
| Stress | Iteration | 1.86 s | 12.29 ms | 2.16 s | 3.16 s | 3.18 s | 3.22 s |
| Spike | HTTP request | 2.40 s | 29.88 ms | 2.62 s | 4.37 s | 5.01 s | 5.35 s |
| Spike | Iteration | 2.40 s | 31.25 ms | 2.62 s | 4.37 s | 5.01 s | 5.35 s |

The recorded stress run used a shorter stage schedule than the current
`review_conversation_join_req_stress.js` profile. The table records the
schedule actually used; rerun the stress profile before comparing it directly
with the current script.

<details>
<summary>Raw k6 output</summary>

#### load test
stages: [
    { duration: '15s', target: 450 },
    { duration: '15s', target: 450 },
  ]

   TOTAL RESULTS

    checks_total.......: 7783    250.774589/s
    checks_succeeded...: 100.00% 7783 out of 7783
    checks_failed......: 0.00%   0 out of 7783

    ✓ review-join-request succeeds or returns an already-reviewed conflict

    HTTP
    http_req_duration..............: avg=1.33s min=17.29ms med=1.63s max=1.94s p(90)=1.78s p(95)=1.86s
      { expected_response:true }...: avg=1.33s min=17.29ms med=1.63s max=1.94s p(90)=1.78s p(95)=1.86s
    http_req_failed................: 0.00%  0 out of 7783
    http_reqs......................: 7783   250.774589/s

    EXECUTION
    iteration_duration.............: avg=1.33s min=17.31ms med=1.63s max=1.94s p(90)=1.78s p(95)=1.86s
    iterations.....................: 7783   250.774589/s
    vus............................: 58     min=28        max=450
    vus_max........................: 450    min=450       max=450

    NETWORK
    data_received..................: 3.9 MB 127 kB/s
    data_sent......................: 4.7 MB 152 kB/s


running (0m31.0s), 000/450 VUs, 7783 complete and 0 interrupted iterations
default ✓ [======================================] 000/450 VUs  30s

#### stress test
stages: [
    { duration: '3s', target: 100 },
    { duration: '2s', target: 100 },
    { duration: '3s', target: 200 },
    { duration: '3s', target: 400 },
    { duration: '2s', target: 400 },
    { duration: '5s', target: 800 },
    { duration: '5s', target: 800 },
    { duration: '5s', target: 200 },
  ]

TOTAL RESULTS

    checks_total.......: 6802    237.269558/s
    checks_succeeded...: 100.00% 6802 out of 6802
    checks_failed......: 0.00%   0 out of 6802

    ✓ review-join-request succeeds or returns an already-reviewed conflict

    HTTP
    http_req_duration..............: avg=1.86s min=11.76ms med=2.16s max=3.22s p(90)=3.16s p(95)=3.18s
      { expected_response:true }...: avg=1.86s min=11.76ms med=2.16s max=3.22s p(90)=3.16s p(95)=3.18s
    http_req_failed................: 0.00%  0 out of 6802
    http_reqs......................: 6802   237.269558/s

    EXECUTION
    iteration_duration.............: avg=1.86s min=12.29ms med=2.16s max=3.22s p(90)=3.16s p(95)=3.18s
    iterations.....................: 6802   237.269558/s
    vus............................: 307    min=30        max=800
    vus_max........................: 800    min=800       max=800

    NETWORK
    data_received..................: 3.4 MB 120 kB/s
    data_sent......................: 4.1 MB 143 kB/s


running (28.7s), 000/800 VUs, 6802 complete and 0 interrupted iterations
default ✓ [======================================] 000/800 VUs  28s

#### spike test
stages: [
    { duration: '3s', target: 200 },
    { duration: '2s', target: 200 },
    { duration: '3s', target: 1000 },
    { duration: '2s', target: 1000 },
    { duration: '5s', target: 200 },
  ]

TOTAL RESULTS

    checks_total.......: 3655    230.901522/s
    checks_succeeded...: 100.00% 3655 out of 3655
    checks_failed......: 0.00%   0 out of 3655

    ✓ review-join-request succeeds or returns an already-reviewed conflict

    HTTP
    http_req_duration..............: avg=2.4s min=29.88ms med=2.62s max=5.35s p(90)=4.37s p(95)=5.01s
      { expected_response:true }...: avg=2.4s min=29.88ms med=2.62s max=5.35s p(90)=4.37s p(95)=5.01s
    http_req_failed................: 0.00%  0 out of 3655
    http_reqs......................: 3655   230.901522/s

    EXECUTION
    iteration_duration.............: avg=2.4s min=31.25ms med=2.62s max=5.35s p(90)=4.37s p(95)=5.01s
    iterations.....................: 3655   230.901522/s
    vus............................: 428    min=58        max=1000
    vus_max........................: 1000   min=1000      max=1000

    NETWORK
    data_received..................: 1.8 MB 117 kB/s
    data_sent......................: 2.2 MB 140 kB/s


running (15.8s), 0000/1000 VUs, 3655 complete and 0 interrupted iterations
default ✓ [======================================] 0000/1000 VUs  15s

</details>

### Get my conversations

This endpoint returns every conversation for the authenticated user, including
member summaries, member counts, and the most recent message. The test
sequentially cycles through the 11,000 saved users and wraps with modulo.

| Profile | VU target sequence | Elapsed | Active VUs | Requests / iterations | Throughput | Checks passed | HTTP failures | Data received | Data sent |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Load | 15 s ramp to 450; 15 s hold at 450 | 33.1 s | 29-450 | 2,219 / 2,219 | 67.08 req/s | 100% (2,219/2,219) | 0 (0%) | 17 MB (520 kB/s) | 983 kB (30 kB/s) |
| Stress | 5 s to 100; 2 s hold; 5 s to 200; 5 s to 400; 3 s hold; 5 s to 800; 5 s hold; 10 s down to 200 | 42.7 s | 18-800 | 2,776 / 2,776 | 64.99 req/s | 100% (2,776/2,776) | 0 (0%) | 22 MB (504 kB/s) | 1.2 MB (29 kB/s) |
| Spike | 3 s to 200; 2 s hold; 3 s to 1,000; 2 s hold; 5 s down to 200 | 23.3 s | 58-1,000 | 1,418 / 1,418 | 60.90 req/s | 100% (1,418/1,418) | 0 (0%) | 11 MB (473 kB/s) | 628 kB (27 kB/s) |

| Profile | Metric | Average | Minimum | Median | p90 | p95 | Maximum |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Load | HTTP request | 5.01 s | 103.70 ms | 6.15 s | 6.69 s | 6.87 s | 7.14 s |
| Load | Iteration | 5.01 s | 104.22 ms | 6.15 s | 6.69 s | 6.87 s | 7.14 s |
| Stress | HTTP request | 6.73 s | 65.48 ms | 7.08 s | 12.18 s | 12.36 s | 12.52 s |
| Stress | Iteration | 6.73 s | 67.35 ms | 7.08 s | 12.18 s | 12.36 s | 12.54 s |
| Spike | HTTP request | 11.87 s | 125.07 ms | 15.61 s | 16.37 s | 16.38 s | 16.43 s |
| Spike | Iteration | 11.87 s | 127.25 ms | 15.61 s | 16.37 s | 16.39 s | 16.43 s |

The request transferred approximately 8 kB on average in each profile. The
route was much slower than the other conversation endpoints in these runs:
the details load profile completed 365 req/s at 1.28 s p95, and group update
completed 330 req/s at 1.44 s p95. The list route stayed near 61-67 req/s,
with p95 rising from 6.87 s at load to 16.38 s in the spike. All checks passed
and there were no HTTP failures; this is severe latency/throughput
degradation, not an observed correctness failure.

The implementation in
[`ConversationService.getMyConversations`](../src/modules/conversation/conversation.service.ts)
does use Prisma `findMany`, but the operation is more than a simple list:
it filters conversations through a membership relation, sorts by
`Conversation.updatedAt`, loads each conversation's members and each member's
user summary, counts members, and fetches the latest message. It is also
unpaginated. The membership filter has a supporting
[`ConversationMember(userId, joinedAt)` index](../prisma/schema.prisma), but
the recorded results do not reveal the generated SQL plan or whether Prisma
executes the relation reads as SQL joins, subqueries, or separate queries.
The schema also has a `(type, updatedAt)` conversation index, but this query
does not filter by type; the actual cost of sorting its result must be checked
in the query plan.

**What the results establish:** this endpoint's query/serialization path is
the standout bottleneck in the tested workload. They do not prove that the
database join alone is the cause or that the whole system has a general
failure. The other routes succeeded at several times the throughput, while
this route returned 100% successful responses. The roughly 8 kB response is
larger than the details response, but payload size alone does not explain the
observed latency. No SQL timing, `EXPLAIN (ANALYZE, BUFFERS)`, database
connection/wait metrics, Node CPU/event-loop metrics, or load-generator
resource measurements were captured. Those are needed to distinguish a slow
query plan or relation loading from Prisma pool wait, database contention,
serialization, or host saturation.

For a conclusive diagnosis, capture the SQL generated by this exact
`findMany`, run its plan with `EXPLAIN (ANALYZE, BUFFERS)` against the same
seeded database, and measure query time separately from total HTTP time while
recording PostgreSQL connections/waits and API CPU/event-loop utilization.

<details>
<summary>Raw k6 output</summary>

#### load test
stages: [
    { duration: '15s', target: 450 },
    { duration: '15s', target: 450 },
  ]

   TOTAL RESULTS

    checks_total.......: 2219    67.08133/s
    checks_succeeded...: 100.00% 2219 out of 2219
    checks_failed......: 0.00%   0 out of 2219

    ✓ get-my-conversations returns a conversation list

    HTTP
    http_req_duration..............: avg=5.01s min=103.7ms  med=6.15s max=7.14s p(90)=6.69s p(95)=6.87s
      { expected_response:true }...: avg=5.01s min=103.7ms  med=6.15s max=7.14s p(90)=6.69s p(95)=6.87s
    http_req_failed................: 0.00%  0 out of 2219
    http_reqs......................: 2219   67.08133/s

    EXECUTION
    iteration_duration.............: avg=5.01s min=104.22ms med=6.15s max=7.14s p(90)=6.69s p(95)=6.87s
    iterations.....................: 2219   67.08133/s
    vus............................: 112    min=29        max=450
    vus_max........................: 450    min=450       max=450

    NETWORK
    data_received..................: 17 MB  520 kB/s
    data_sent......................: 983 kB 30 kB/s


running (0m33.1s), 000/450 VUs, 2219 complete and 0 interrupted iterations
default ✓ [======================================] 000/450 VUs  30s

#### stress test
stages: [
    { duration: '5s', target: 100 },
    { duration: '2s', target: 100 },
    { duration: '5s', target: 200 },
    { duration: '5s', target: 400 },
    { duration: '3s', target: 400 },
    { duration: '5s', target: 800 },
    { duration: '5s', target: 800 },
    { duration: '10s', target: 200 },
  ]

  TOTAL RESULTS

    checks_total.......: 2776    64.991029/s
    checks_succeeded...: 100.00% 2776 out of 2776
    checks_failed......: 0.00%   0 out of 2776

    ✓ get-my-conversations returns a conversation list

    HTTP
    http_req_duration..............: avg=6.73s min=65.48ms med=7.08s max=12.52s p(90)=12.18s p(95)=12.36s
      { expected_response:true }...: avg=6.73s min=65.48ms med=7.08s max=12.52s p(90)=12.18s p(95)=12.36s
    http_req_failed................: 0.00%  0 out of 2776
    http_reqs......................: 2776   64.991029/s

    EXECUTION
    iteration_duration.............: avg=6.73s min=67.35ms med=7.08s max=12.54s p(90)=12.18s p(95)=12.36s
    iterations.....................: 2776   64.991029/s
    vus............................: 263    min=18        max=800
    vus_max........................: 800    min=800       max=800

    NETWORK
    data_received..................: 22 MB  504 kB/s
    data_sent......................: 1.2 MB 29 kB/s


running (0m42.7s), 000/800 VUs, 2776 complete and 0 interrupted iterations
default ✓ [======================================] 000/800 VUs  40s

#### spike test
stages: [
    { duration: '3s', target: 200 },
    { duration: '2s', target: 200 },
    { duration: '3s', target: 1000 },
    { duration: '2s', target: 1000 },
    { duration: '5s', target: 200 },
  ]

TOTAL RESULTS

    checks_total.......: 1418    60.90194/s
    checks_succeeded...: 100.00% 1418 out of 1418
    checks_failed......: 0.00%   0 out of 1418

    ✓ get-my-conversations returns a conversation list

    HTTP
    http_req_duration..............: avg=11.87s min=125.07ms med=15.61s max=16.43s p(90)=16.37s p(95)=16.38s
      { expected_response:true }...: avg=11.87s min=125.07ms med=15.61s max=16.43s p(90)=16.37s p(95)=16.38s
    http_req_failed................: 0.00%  0 out of 1418
    http_reqs......................: 1418   60.90194/s

    EXECUTION
    iteration_duration.............: avg=11.87s min=127.25ms med=15.61s max=16.43s p(90)=16.37s p(95)=16.39s
    iterations.....................: 1418   60.90194/s
    vus............................: 428    min=58        max=1000
    vus_max........................: 1000   min=1000      max=1000

    NETWORK
    data_received..................: 11 MB  473 kB/s
    data_sent......................: 628 kB 27 kB/s


running (23.3s), 0000/1000 VUs, 1418 complete and 0 interrupted iterations
default ✓ [======================================] 0000/1000 VUs  15s

</details>

### Get conversation details

The test cycles through the saved groups and authenticates as users in
sequence. Group details can be read by any authenticated user.

| Profile | VU target sequence | Elapsed | Active VUs | Requests / iterations | Throughput | Checks passed | HTTP failures | Data received | Data sent |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Load | 15 s ramp to 450; 15 s hold at 450 | 30.5 s | 29-450 | 11,151 / 11,151 | 365.28 req/s | 100% (11,151/11,151) | 0 (0%) | 12 MB (401 kB/s) | 5.4 MB (175 kB/s) |
| Stress | 5 s to 100; 2 s hold; 5 s to 200; 5 s to 400; 3 s hold; 5 s to 800; 5 s hold; 10 s down to 200 | 40.3 s | 19-800 | 13,884 / 13,884 | 344.92 req/s | 100% (13,884/13,884) | 0 (0%) | 15 MB (383 kB/s) | 6.7 MB (166 kB/s) |
| Spike | 3 s to 200; 2 s hold; 3 s to 1,000; 2 s hold; 5 s down to 200 | 15.3 s | 59-1,000 | 5,145 / 5,145 | 335.87 req/s | 100% (5,145/5,145) | 0 (0%) | 5.8 MB (376 kB/s) | 2.5 MB (161 kB/s) |

| Profile | Metric | Average | Minimum | Median | p90 | p95 | Maximum |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Load | HTTP request | 919.89 ms | 5.32 ms | 1.10 s | 1.23 s | 1.28 s | 1.38 s |
| Load | Iteration | 920.59 ms | 6.37 ms | 1.10 s | 1.23 s | 1.28 s | 1.38 s |
| Stress | HTTP request | 1.17 s | 6.12 ms | 1.06 s | 2.17 s | 2.45 s | 2.69 s |
| Stress | Iteration | 1.17 s | 7.27 ms | 1.06 s | 2.17 s | 2.45 s | 2.69 s |
| Spike | HTTP request | 1.62 s | 15.45 ms | 1.60 s | 2.85 s | 3.97 s | 4.59 s |
| Spike | Iteration | 1.62 s | 15.99 ms | 1.60 s | 2.85 s | 3.97 s | 4.60 s |

<details>
<summary>Raw k6 output</summary>
stages: [
    { duration: '15s', target: 450 },
    { duration: '15s', target: 450 },
  ]

  TOTAL RESULTS

    checks_total.......: 11151   365.275723/s
    checks_succeeded...: 100.00% 11151 out of 11151
    checks_failed......: 0.00%   0 out of 11151

    ✓ get-conversation-details returns the selected group

    HTTP
    http_req_duration..............: avg=919.89ms min=5.32ms med=1.1s max=1.38s p(90)=1.23s p(95)=1.28s
      { expected_response:true }...: avg=919.89ms min=5.32ms med=1.1s max=1.38s p(90)=1.23s p(95)=1.28s
    http_req_failed................: 0.00%  0 out of 11151
    http_reqs......................: 11151  365.275723/s

    EXECUTION
    iteration_duration.............: avg=920.59ms min=6.37ms med=1.1s max=1.38s p(90)=1.23s p(95)=1.28s
    iterations.....................: 11151  365.275723/s
    vus............................: 450    min=29         max=450
    vus_max........................: 450    min=450        max=450

    NETWORK
    data_received..................: 12 MB  401 kB/s
    data_sent......................: 5.4 MB 175 kB/s


running (0m30.5s), 000/450 VUs, 11151 complete and 0 interrupted iterations
default ✓ [======================================] 000/450 VUs  30s

#### stress test
stages: [
    { duration: '5s', target: 100 },
    { duration: '2s', target: 100 },
    { duration: '5s', target: 200 },
    { duration: '5s', target: 400 },
    { duration: '3s', target: 400 },
    { duration: '5s', target: 800 },
    { duration: '5s', target: 800 },
    { duration: '10s', target: 200 },
  ]

TOTAL RESULTS

    checks_total.......: 13884   344.923684/s
    checks_succeeded...: 100.00% 13884 out of 13884
    checks_failed......: 0.00%   0 out of 13884

    ✓ get-conversation-details returns the selected group

    HTTP
    http_req_duration..............: avg=1.17s min=6.12ms med=1.06s max=2.69s p(90)=2.17s p(95)=2.45s
      { expected_response:true }...: avg=1.17s min=6.12ms med=1.06s max=2.69s p(90)=2.17s p(95)=2.45s
    http_req_failed................: 0.00%  0 out of 13884
    http_reqs......................: 13884  344.923684/s

    EXECUTION
    iteration_duration.............: avg=1.17s min=7.27ms med=1.06s max=2.69s p(90)=2.17s p(95)=2.45s
    iterations.....................: 13884  344.923684/s
    vus............................: 231    min=19         max=800
    vus_max........................: 800    min=800        max=800

    NETWORK
    data_received..................: 15 MB  383 kB/s
    data_sent......................: 6.7 MB 166 kB/s


running (0m40.3s), 000/800 VUs, 13884 complete and 0 interrupted iterations
default ✓ [======================================] 000/800 VUs  40s

#### spike test
stages: [
    { duration: '3s', target: 200 },
    { duration: '2s', target: 200 },
    { duration: '3s', target: 1000 },
    { duration: '2s', target: 1000 },
    { duration: '5s', target: 200 },
  ]

  TOTAL RESULTS

    checks_total.......: 5145    335.87317/s
    checks_succeeded...: 100.00% 5145 out of 5145
    checks_failed......: 0.00%   0 out of 5145

    ✓ get-conversation-details returns the selected group

    HTTP
    http_req_duration..............: avg=1.62s min=15.45ms med=1.6s max=4.59s p(90)=2.85s p(95)=3.97s
      { expected_response:true }...: avg=1.62s min=15.45ms med=1.6s max=4.59s p(90)=2.85s p(95)=3.97s
    http_req_failed................: 0.00%  0 out of 5145
    http_reqs......................: 5145   335.87317/s

    EXECUTION
    iteration_duration.............: avg=1.62s min=15.99ms med=1.6s max=4.6s  p(90)=2.85s p(95)=3.97s
    iterations.....................: 5145   335.87317/s
    vus............................: 304    min=59        max=1000
    vus_max........................: 1000   min=1000      max=1000

    NETWORK
    data_received..................: 5.8 MB 376 kB/s
    data_sent......................: 2.5 MB 161 kB/s


running (15.3s), 0000/1000 VUs, 5145 complete and 0 interrupted iterations
default ✓ [======================================] 0000/1000 VUs  15s

</details>

### Update group

The test cycles through saved groups and authenticates as each group's owner.
It submits the existing group name and `REQUEST` join policy. The settings
remain unchanged, although the route may advance `updatedAt`.

| Profile | VU target sequence | Elapsed | Active VUs | Requests / iterations | Throughput | Checks passed | HTTP failures | Data received | Data sent |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Load | 15 s ramp to 450; 15 s hold at 450 | 30.5 s | 29-450 | 10,068 / 10,068 | 329.99 req/s | 100% (10,068/10,068) | 0 (0%) | 3.8 MB (123 kB/s) | 5.9 MB (194 kB/s) |
| Stress | 5 s to 100; 2 s hold; 5 s to 200; 5 s to 400; 3 s hold; 5 s to 800; 5 s hold; 10 s down to 200 | 40.2 s | 18-800 | 13,333 / 13,333 | 331.59 req/s | 100% (13,333/13,333) | 0 (0%) | 5.0 MB (124 kB/s) | 7.8 MB (195 kB/s) |
| Spike | 3 s to 200; 2 s hold; 3 s to 1,000; 2 s hold; 5 s down to 200 | 15.3 s | 57-1,000 | 4,278 / 4,278 | 278.70 req/s | 100% (4,278/4,278) | 0 (0%) | 1.6 MB (104 kB/s) | 2.5 MB (164 kB/s) |

| Profile | Metric | Average | Minimum | Median | p90 | p95 | Maximum |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Load | HTTP request | 1.01 s | 10.20 ms | 1.24 s | 1.34 s | 1.44 s | 1.52 s |
| Load | Iteration | 1.01 s | 11.33 ms | 1.24 s | 1.34 s | 1.44 s | 1.52 s |
| Stress | HTTP request | 1.22 s | 11.86 ms | 1.17 s | 2.38 s | 2.40 s | 2.45 s |
| Stress | Iteration | 1.22 s | 12.90 ms | 1.17 s | 2.38 s | 2.40 s | 2.45 s |
| Spike | HTTP request | 1.98 s | 36.21 ms | 1.89 s | 4.05 s | 4.93 s | 5.31 s |
| Spike | Iteration | 1.98 s | 38.51 ms | 1.89 s | 4.06 s | 4.93 s | 5.31 s |

<details>
<summary>Raw k6 output</summary>

#### load test
stages: [
    { duration: '15s', target: 450 },
    { duration: '15s', target: 450 },
  ]

  TOTAL RESULTS

    checks_total.......: 10068   329.985941/s
    checks_succeeded...: 100.00% 10068 out of 10068
    checks_failed......: 0.00%   0 out of 10068

    ✓ update-group keeps the selected group settings

    HTTP
    http_req_duration..............: avg=1.01s min=10.2ms  med=1.24s max=1.52s p(90)=1.34s p(95)=1.44s
      { expected_response:true }...: avg=1.01s min=10.2ms  med=1.24s max=1.52s p(90)=1.34s p(95)=1.44s
    http_req_failed................: 0.00%  0 out of 10068
    http_reqs......................: 10068  329.985941/s

    EXECUTION
    iteration_duration.............: avg=1.01s min=11.33ms med=1.24s max=1.52s p(90)=1.34s p(95)=1.44s
    iterations.....................: 10068  329.985941/s
    vus............................: 450    min=29         max=450
    vus_max........................: 450    min=450        max=450

    NETWORK
    data_received..................: 3.8 MB 123 kB/s
    data_sent......................: 5.9 MB 194 kB/s


running (0m30.5s), 000/450 VUs, 10068 complete and 0 interrupted iterations
default ✓ [======================================] 000/450 VUs  30s

#### stress test
stages: [
    { duration: '5s', target: 100 },
    { duration: '2s', target: 100 },
    { duration: '5s', target: 200 },
    { duration: '5s', target: 400 },
    { duration: '3s', target: 400 },
    { duration: '5s', target: 800 },
    { duration: '5s', target: 800 },
    { duration: '10s', target: 200 },
  ]

TOTAL RESULTS

    checks_total.......: 13333   331.589858/s
    checks_succeeded...: 100.00% 13333 out of 13333
    checks_failed......: 0.00%   0 out of 13333

    ✓ update-group keeps the selected group settings

    HTTP
    http_req_duration..............: avg=1.22s min=11.86ms med=1.17s max=2.45s p(90)=2.38s p(95)=2.4s
      { expected_response:true }...: avg=1.22s min=11.86ms med=1.17s max=2.45s p(90)=2.38s p(95)=2.4s
    http_req_failed................: 0.00%  0 out of 13333
    http_reqs......................: 13333  331.589858/s

    EXECUTION
    iteration_duration.............: avg=1.22s min=12.9ms  med=1.17s max=2.45s p(90)=2.38s p(95)=2.4s
    iterations.....................: 13333  331.589858/s
    vus............................: 227    min=18         max=800
    vus_max........................: 800    min=800        max=800

    NETWORK
    data_received..................: 5.0 MB 124 kB/s
    data_sent......................: 7.8 MB 195 kB/s


running (0m40.2s), 000/800 VUs, 13333 complete and 0 interrupted iterations
default ✓ [======================================] 000/800 VUs  40s

#### spike test
stages: [
    { duration: '3s', target: 200 },
    { duration: '2s', target: 200 },
    { duration: '3s', target: 1_000 },
    { duration: '2s', target: 1_000 },
    { duration: '5s', target: 200 },
  ]

TOTAL RESULTS

    checks_total.......: 4278    278.701962/s
    checks_succeeded...: 100.00% 4278 out of 4278
    checks_failed......: 0.00%   0 out of 4278

    ✓ update-group keeps the selected group settings

    HTTP
    http_req_duration..............: avg=1.98s min=36.21ms med=1.89s max=5.31s p(90)=4.05s p(95)=4.93s
      { expected_response:true }...: avg=1.98s min=36.21ms med=1.89s max=5.31s p(90)=4.05s p(95)=4.93s
    http_req_failed................: 0.00%  0 out of 4278
    http_reqs......................: 4278   278.701962/s

    EXECUTION
    iteration_duration.............: avg=1.98s min=38.51ms med=1.89s max=5.31s p(90)=4.06s p(95)=4.93s
    iterations.....................: 4278   278.701962/s
    vus............................: 329    min=57        max=1000
    vus_max........................: 1000   min=1000      max=1000

    NETWORK
    data_received..................: 1.6 MB 104 kB/s
    data_sent......................: 2.5 MB 164 kB/s


running (15.3s), 0000/1000 VUs, 4278 complete and 0 interrupted iterations
default ✓ [======================================] 0000/1000 VUs  15s

</details>

Load results are included for every endpoint with recorded load runs. The
logout-all endpoint is the exception: only its stress run was saved.


### Leave Group

These profiles call `DELETE /conversations/:id/leave` using the saved
membership data. An owner’s documented `403` response counts as an expected
result; each non-owner membership is used at most once per profile to avoid
repeating a successful leave. All three runs passed every check and reported
zero HTTP request failures.

| Profile | VU target sequence | Elapsed | Active VUs | Requests / iterations | Throughput | Checks passed | HTTP failures | Data received | Data sent |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Load | 15 s ramp to 450; 15 s hold at 450 | 30.6 s | 0-450 | 11,010 / 11,010 | 359.90 req/s | 100% (11,010/11,010) | 0 (0%) | 3.7 MB (120 kB/s) | 5.4 MB (176 kB/s) |
| Stress | 5 s to 100; 2 s hold; 5 s to 200; 5 s to 400; 3 s hold; 5 s to 800; 5 s hold; 10 s down to 200 | 40.2 s | 0-800 | 15,694 / 15,694 | 390.11 req/s | 100% (15,694/15,694) | 0 (0%) | 5.9 MB (146 kB/s) | 7.7 MB (191 kB/s) |
| Spike | 3 s to 200; 2 s hold; 3 s to 1,000; 2 s hold; 5 s down to 200 | 15.3 s | 0-1,000 | 5,135 / 5,135 | 335.77 req/s | 100% (5,135/5,135) | 0 (0%) | 1.7 MB (112 kB/s) | 2.5 MB (164 kB/s) |

| Profile | Metric | Average | Minimum | Median | p90 | p95 | Maximum |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Load | HTTP request | 933.58 ms | 6.46 ms | 1.01 s | 1.40 s | 1.42 s | 1.49 s |
| Load | Iteration | 934.19 ms | 7 ms | 1.01 s | 1.40 s | 1.42 s | 1.50 s |
| Stress | HTTP request | 1.03 s | 7.17 ms | 965.05 ms | 1.94 s | 2.00 s | 2.06 s |
| Stress | Iteration | 1.03 s | 7.95 ms | 965.68 ms | 1.94 s | 2.00 s | 2.06 s |
| Spike | HTTP request | 1.63 s | 14.30 ms | 1.48 s | 3.03 s | 4.34 s | 5.31 s |
| Spike | Iteration | 1.63 s | 14.88 ms | 1.48 s | 3.03 s | 4.34 s | 5.31 s |

<details>
<summary>Raw k6 output</summary>

#### load test

```text
stages: [
    { duration: '15s', target: 450 },
    { duration: '15s', target: 450 },
  ]

TOTAL RESULTS

    checks_total.......: 11010   359.904976/s
    checks_succeeded...: 100.00% 11010 out of 11010
    checks_failed......: 0.00%   0 out of 11010

    ✓ leave-group succeeds or returns the expected owner denial

    HTTP
    http_req_duration..............: avg=933.58ms min=6.46ms med=1.01s max=1.49s p(90)=1.4s p(95)=1.42s
      { expected_response:true }...: avg=933.58ms min=6.46ms med=1.01s max=1.49s p(90)=1.4s p(95)=1.42s
    http_req_failed................: 0.00%  0 out of 11010
    http_reqs......................: 11010  359.904976/s

    EXECUTION
    iteration_duration.............: avg=934.19ms min=7ms    med=1.01s max=1.5s  p(90)=1.4s p(95)=1.42s
    iterations.....................: 11010  359.904976/s
    vus............................: 78     min=0          max=450
    vus_max........................: 450    min=16         max=450

    NETWORK
    data_received..................: 3.7 MB 120 kB/s
    data_sent......................: 5.4 MB 176 kB/s

running (0m30.6s), 000/450 VUs, 11010 complete and 0 interrupted iterations
default ✓ [======================================] 000/450 VUs  30s
```

#### stress test

```text
stages: [
    { duration: '5s', target: 100 },
    { duration: '2s', target: 100 },
    { duration: '5s', target: 200 },
    { duration: '5s', target: 400 },
    { duration: '3s', target: 400 },
    { duration: '5s', target: 800 },
    { duration: '5s', target: 800 },
    { duration: '10s', target: 200 },
  ]

TOTAL RESULTS

    checks_total.......: 15694   390.110892/s
    checks_succeeded...: 100.00% 15694 out of 15694
    checks_failed......: 0.00%   0 out of 15694

    ✓ leave-group succeeds or returns the expected owner denial

    HTTP
    http_req_duration..............: avg=1.03s min=7.17ms med=965.05ms max=2.06s p(90)=1.94s p(95)=2s
      { expected_response:true }...: avg=1.03s min=7.17ms med=965.05ms max=2.06s p(90)=1.94s p(95)=2s
    http_req_failed................: 0.00%  0 out of 15694
    http_reqs......................: 15694  390.110892/s

    EXECUTION
    iteration_duration.............: avg=1.03s min=7.95ms med=965.68ms max=2.06s p(90)=1.94s p(95)=2s
    iterations.....................: 15694  390.110892/s
    vus............................: 245    min=0          max=800
    vus_max........................: 800    min=13         max=800

    NETWORK
    data_received..................: 5.9 MB 146 kB/s
    data_sent......................: 7.7 MB 191 kB/s

running (0m40.2s), 000/800 VUs, 15694 complete and 0 interrupted iterations
default ✓ [======================================] 000/800 VUs  40s
```

#### spike test

```text
stages: [
    { duration: '3s', target: 200 },
    { duration: '2s', target: 200 },
    { duration: '3s', target: 1_000 },
    { duration: '2s', target: 1_000 },
    { duration: '5s', target: 200 },
  ]

TOTAL RESULTS

    checks_total.......: 5135    335.772528/s
    checks_succeeded...: 100.00% 5135 out of 5135
    checks_failed......: 0.00%   0 out of 5135

    ✓ leave-group succeeds or returns the expected owner denial

    HTTP
    http_req_duration..............: avg=1.63s min=14.3ms  med=1.48s max=5.31s p(90)=3.03s p(95)=4.34s
      { expected_response:true }...: avg=1.63s min=14.3ms  med=1.48s max=5.31s p(90)=3.03s p(95)=4.34s
    http_req_failed................: 0.00%  0 out of 5135
    http_reqs......................: 5135   335.772528/s

    EXECUTION
    iteration_duration.............: avg=1.63s min=14.88ms med=1.48s max=5.31s p(90)=3.03s p(95)=4.34s
    iterations.....................: 5135   335.772528/s
    vus............................: 134    min=0         max=1000
    vus_max........................: 1000   min=8         max=1000

    NETWORK
    data_received..................: 1.7 MB 112 kB/s
    data_sent......................: 2.5 MB 164 kB/s

running (15.3s), 0000/1000 VUs, 5135 complete and 0 interrupted iterations
default ✓ [======================================] 0000/1000 VUs  15s
```

</details>


### Cancel join request

These profiles call `DELETE /conversations/:id/join-requests/me` with the
saved user/request pairs. A successful cancellation returns the request ID and
`CANCELLED` status. If a profile cycles through the fixture, the route's
expected already-cancelled conflict is accepted. All recorded checks passed
and HTTP request failure rates were zero.

| Profile | VU target sequence | Elapsed | Active VUs | Requests / iterations | Throughput | Checks passed | HTTP failures | Data received | Data sent |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Load | 15 s ramp to 450; 15 s hold at 450 | 30.5 s | 29-450 | 9,972 / 9,972 | 327.11 req/s | 100% (9,972/9,972) | 0 (0%) | 3.4 MB (112 kB/s) | 5.0 MB (164 kB/s) |
| Stress | 5 s to 100; 2 s hold; 5 s to 200; 5 s to 400; 3 s hold; 5 s to 800; 5 s hold; 10 s down to 200 | 40.3 s | 19-800 | 13,420 / 13,420 | 333.04 req/s | 100% (13,420/13,420) | 0 (0%) | 4.6 MB (114 kB/s) | 6.7 MB (167 kB/s) |
| Spike | 3 s to 200; 2 s hold; 3 s to 1,000; 2 s hold; 5 s down to 200 | 15.4 s | 57-1,000 | 4,377 / 4,377 | 284.15 req/s | 100% (4,377/4,377) | 0 (0%) | 1.5 MB (97 kB/s) | 2.2 MB (142 kB/s) |

| Profile | Metric | Average | Minimum | Median | p90 | p95 | Maximum |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Load | HTTP request | 1.02 s | 12.38 ms | 1.21 s | 1.48 s | 1.67 s | 2.04 s |
| Load | Iteration | 1.02 s | 12.99 ms | 1.21 s | 1.48 s | 1.67 s | 2.04 s |
| Stress | HTTP request | 1.22 s | 9.10 ms | 1.12 s | 2.36 s | 2.37 s | 2.45 s |
| Stress | Iteration | 1.22 s | 9.35 ms | 1.12 s | 2.36 s | 2.37 s | 2.45 s |
| Spike | HTTP request | 1.95 s | 23.94 ms | 1.92 s | 4.28 s | 5.17 s | 5.55 s |
| Spike | Iteration | 1.95 s | 24.51 ms | 1.92 s | 4.28 s | 5.17 s | 5.56 s |

<details>
<summary>Raw k6 output</summary>

#### load test

```text
stages: [
    { duration: '15s', target: 450 },
    { duration: '15s', target: 450 },
  ]

TOTAL RESULTS

    checks_total.......: 9972    327.114873/s
    checks_succeeded...: 100.00% 9972 out of 9972
    checks_failed......: 0.00%   0 out of 9972

    ✓ cancel-join-request succeeds or returns an already-cancelled conflict

    HTTP
    http_req_duration..............: avg=1.02s min=12.38ms med=1.21s max=2.04s p(90)=1.48s p(95)=1.67s
      { expected_response:true }...: avg=1.02s min=12.38ms med=1.21s max=2.04s p(90)=1.48s p(95)=1.67s
    http_req_failed................: 0.00%  0 out of 9972
    http_reqs......................: 9972   327.114873/s

    EXECUTION
    iteration_duration.............: avg=1.02s min=12.99ms med=1.21s max=2.04s p(90)=1.48s p(95)=1.67s
    iterations.....................: 9972   327.114873/s
    vus............................: 450    min=29        max=450
    vus_max........................: 450    min=450       max=450

    NETWORK
    data_received..................: 3.4 MB 112 kB/s
    data_sent......................: 5.0 MB 164 kB/s

running (0m30.5s), 000/450 VUs, 9972 complete and 0 interrupted iterations
default ✓ [======================================] 000/450 VUs  30s
```

#### stress test

```text
stages: [
    { duration: '5s', target: 100 },
    { duration: '2s', target: 100 },
    { duration: '5s', target: 200 },
    { duration: '5s', target: 400 },
    { duration: '3s', target: 400 },
    { duration: '5s', target: 800 },
    { duration: '5s', target: 800 },
    { duration: '10s', target: 200 },
  ]

TOTAL RESULTS

    checks_total.......: 13420   333.036864/s
    checks_succeeded...: 100.00% 13420 out of 13420
    checks_failed......: 0.00%   0 out of 13420

    ✓ cancel-join-request succeeds or returns an already-cancelled conflict

    HTTP
    http_req_duration..............: avg=1.22s min=9.1ms  med=1.12s max=2.45s p(90)=2.36s p(95)=2.37s
      { expected_response:true }...: avg=1.22s min=9.1ms  med=1.12s max=2.45s p(90)=2.36s p(95)=2.37s
    http_req_failed................: 0.00%  0 out of 13420
    http_reqs......................: 13420  333.036864/s

    EXECUTION
    iteration_duration.............: avg=1.22s min=9.35ms med=1.12s max=2.45s p(90)=2.36s p(95)=2.37s
    iterations.....................: 13420  333.036864/s
    vus............................: 228    min=19         max=800
    vus_max........................: 800    min=800        max=800

    NETWORK
    data_received..................: 4.6 MB 114 kB/s
    data_sent......................: 6.7 MB 167 kB/s

running (0m40.3s), 000/800 VUs, 13420 complete and 0 interrupted iterations
default ✓ [======================================] 000/800 VUs  40s
```

#### spike test

```text
stages: [
    { duration: '3s', target: 200 },
    { duration: '2s', target: 200 },
    { duration: '3s', target: 1_000 },
    { duration: '2s', target: 1_000 },
    { duration: '5s', target: 200 },
  ]

TOTAL RESULTS

    checks_total.......: 4377    284.152538/s
    checks_succeeded...: 100.00% 4377 out of 4377
    checks_failed......: 0.00%   0 out of 4377

    ✓ cancel-join-request succeeds or returns an already-cancelled conflict

    HTTP
    http_req_duration..............: avg=1.95s min=23.94ms med=1.92s max=5.55s p(90)=4.28s p(95)=5.17s
      { expected_response:true }...: avg=1.95s min=23.94ms med=1.92s max=5.55s p(90)=4.28s p(95)=5.17s
    http_req_failed................: 0.00%  0 out of 4377
    http_reqs......................: 4377   284.152538/s

    EXECUTION
    iteration_duration.............: avg=1.95s min=24.51ms med=1.92s max=5.56s p(90)=4.28s p(95)=5.17s
    iterations.....................: 4377   284.152538/s
    vus............................: 328    min=57        max=1000
    vus_max........................: 1000   min=1000      max=1000

    NETWORK
    data_received..................: 1.5 MB 97 kB/s
    data_sent......................: 2.2 MB 142 kB/s

running (15.4s), 0000/1000 VUs, 4377 complete and 0 interrupted iterations
default ✓ [======================================] 0000/1000 VUs  15s
```

</details>


## Mixed service

### Test method and how to read the profiles

These runs combine authenticated user-service endpoints in a single iteration.
Each flow uses the same pooled account and access token for every request; no
login, refresh, or logout requests are part of these measurements. The profile
update submits the account's existing name, so it exercises `PATCH /user`
without intentionally changing seeded profile data.

The result tables report HTTP request throughput, as in the other service
sections. Since each mixed iteration makes two, three, or four HTTP requests,
request counts and throughput are not the same as completed flow iterations.
HTTP request latency measures one request, while execution time per iteration
covers the complete ordered sequence of requests in a flow. Both are reported
below.
All recorded mixed-service runs reported 100% successful checks and zero HTTP
request failures. These are exploratory local results with no performance
thresholds configured.

### Find all users → Get me

Each iteration fetches the first page from `GET /user?limit=50`, then requests
`GET /user/me` for the same authenticated account. Checks validate the page
metadata, exclude the current user from the returned page, and verify the
profile matches the token identity.

| Profile | VU target sequence | Elapsed | Requests | Throughput | Checks passed | HTTP failures | Avg latency | p95 latency | Max latency |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Load | 15 s ramp to 450; 15 s hold at 450 | 31.0 s | 12,028 | 387.68 req/s | 100% | 0 (0%) | 867.33 ms | 1.21 s | 1.28 s |
| Stress | Ramp/hold targets: 200, 200, 400, 400, 800, 800; then ramp down to 200 | 45.6 s | 17,168 | 376.78 req/s | 100% | 0 (0%) | 1.21 s | 2.04 s | 2.09 s |
| Spike | Ramp to 200 (5 s), hold 200 (2 s), ramp to 1,000 (3 s), hold 1,000 (2 s), ramp down to 200 (5 s) | 18.0 s | 6,560 | 363.72 req/s | 100% | 0 (0%) | 1.49 s | 4.36 s | 6.05 s |

| Profile | Request latency (min / median / max) | Execution time per iteration (avg / min / median / max) |
| --- | --- | --- |
| Load | 7.63 ms / 1.04 s / 1.28 s | 1.73 s / 23.48 ms / 2.07 s / 2.42 s |
| Stress | 6.41 ms / 1.06 s / 2.09 s | 2.43 s / 25.26 ms / 2.21 s / 4.08 s |
| Spike | 4.76 ms / 1.35 s / 6.05 s | 2.98 s / 17.99 ms / 2.71 s / 7.60 s |

### Get me → Update user → Get me

Each iteration reads the authenticated profile, updates the user's name to its
current value with `PATCH /user`, then reads the profile again. Checks verify
the profile before and after the update remains associated with the same user
and retains the expected fields.

| Profile | VU target sequence | Elapsed | Requests | Throughput | Checks passed | HTTP failures | Avg latency | p95 latency | Max latency |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Load | 15 s ramp to 450; 15 s hold at 450 | 31.4 s | 14,610 | 465.10 req/s | 100% | 0 (0%) | 721.89 ms | 1.24 s | 1.39 s |
| Stress | Ramp/hold targets: 200, 200, 400, 400, 800, 800; then ramp down to 200 | 45.8 s | 22,089 | 482.20 req/s | 100% | 0 (0%) | 956.41 ms | 1.65 s | 1.69 s |
| Spike | Ramp to 200 (5 s), hold 200 (2 s), ramp to 1,000 (3 s), hold 1,000 (2 s), ramp down to 200 (5 s) | 18.8 s | 8,481 | 450.10 req/s | 100% | 0 (0%) | 1.22 s | 3.16 s | 5.34 s |

| Profile | Request latency (min / median / max) | Execution time per iteration (avg / min / median / max) |
| --- | --- | --- |
| Load | 5.78 ms / 850.70 ms / 1.39 s | 2.16 s / 26.68 ms / 2.53 s / 3.31 s |
| Stress | 5.31 ms / 857.53 ms / 1.69 s | 2.86 s / 24.65 ms / 2.50 s / 4.95 s |
| Spike | 3.78 ms / 1.08 s / 5.34 s | 3.67 s / 18 ms / 3.43 s / 8.38 s |

### Find all users → Get me → Update user → Get me

Each iteration fetches the first page of users, reads the authenticated
profile, updates the user's name to its current value, and reads the profile
again. The checks cover the list response and profile consistency throughout
the sequence.

| Profile | VU target sequence | Elapsed | Requests | Throughput | Checks passed | HTTP failures | Avg latency | p95 latency | Max latency |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Load | 15 s ramp to 450; 15 s hold at 450 | 31.9 s | 12,840 | 402.54 req/s | 100% | 0 (0%) | 833.70 ms | 1.30 s | 1.56 s |
| Stress | Ramp/hold targets: 200, 200, 400, 400, 800, 800; then ramp down to 200 | 46.3 s | 18,936 | 408.79 req/s | 100% | 0 (0%) | 1.14 s | 2.03 s | 2.30 s |
| Spike | Ramp to 200 (5 s), hold 200 (2 s), ramp to 1,000 (3 s), hold 1,000 (2 s), ramp down to 200 (5 s) | 20.9 s | 8,272 | 395.64 req/s | 100% | 0 (0%) | 1.48 s | 3.59 s | 5.91 s |

| Profile | Request latency (min / median / max) | Execution time per iteration (avg / min / median / max) |
| --- | --- | --- |
| Load | 4.23 ms / 987.40 ms / 1.56 s | 3.33 s / 41.19 ms / 3.87 s / 5.01 s |
| Stress | 5.95 ms / 1.04 s / 2.30 s | 4.57 s / 51.05 ms / 4.31 s / 8.00 s |
| Spike | 10.22 ms / 1.43 s / 5.91 s | 5.92 s / 83.02 ms / 6.33 s / 10.91 s |

The recorded spike runs used a 2-second hold at 200 VUs before a 3-second
ramp to 1,000 VUs. The current mixed-service spike scripts use a different
stage sequence, so treat these as results for the recorded profiles rather
than an exact measurement of the current script configuration.



## Socket IO tests

### Concurrent Connection Limit Test

#### 11,000 concurrent connections

The local run established all 11,000 authenticated Socket.IO connections and
reported all 11,000 still active after the final 15-second observation. There
were no failed handshakes or unexpected disconnects. The run ended at its
configured maximum; it did **not** find the system's failure limit.

| Test parameter | Recorded value |
| --- | --- |
| Run time | 2026-11-13 22:54:31–22:58:10 UTC (3 min 38.6 s) |
| Target | `http://localhost:3000` |
| Connection schedule | 1,000 new connections per stage, from 1,000 through 11,000; earlier connections remained open |
| Connection batches | 100 at a time, 200 ms between batches |
| Observation | 15 seconds at each stage |
| Connection timeout | 10 seconds |
| Transport / reconnection | WebSocket only; automatic reconnection disabled |
| Application events | None sent |
| Outcome | 11,000/11,000 connected (100%); 11,000 active after final observation; 0 failures; 0 unexpected disconnects |
| Configured client RSS guard | 512 MB |

Connection-establishment latency is measured from initiating each connection
until the Socket.IO `connect` event; it is not message or acknowledgement
latency. Across all 11,000 connection attempts:

| Metric | Latency |
| --- | ---: |
| Minimum | 125.11 ms |
| Average | 234.26 ms |
| Median (p50) | 222.89 ms |
| p90 | 303.43 ms |
| p95 | 348.45 ms |
| p99 | 516.30 ms |
| Maximum | 638.39 ms |

Per-stage establishment latency:

| Active target | New connections | Average | p95 | p99 | Maximum |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 1,000 | 194.51 ms | 251.74 ms | 272.16 ms | 299.17 ms |
| 2,000 | 1,000 | 203.83 ms | 253.32 ms | 277.69 ms | 324.53 ms |
| 3,000 | 1,000 | 266.84 ms | 539.18 ms | 565.65 ms | 638.39 ms |
| 4,000 | 1,000 | 213.31 ms | 271.77 ms | 306.52 ms | 312.12 ms |
| 5,000 | 1,000 | 230.10 ms | 347.72 ms | 378.11 ms | 388.39 ms |
| 6,000 | 1,000 | 239.85 ms | 297.43 ms | 303.43 ms | 310.60 ms |
| 7,000 | 1,000 | 232.24 ms | 307.87 ms | 320.73 ms | 323.86 ms |
| 8,000 | 1,000 | 208.75 ms | 308.71 ms | 464.01 ms | 496.77 ms |
| 9,000 | 1,000 | 267.72 ms | 476.11 ms | 560.88 ms | 604.10 ms |
| 10,000 | 1,000 | 226.72 ms | 265.52 ms | 299.68 ms | 303.44 ms |
| 11,000 | 1,000 | 293.01 ms | 369.70 ms | 409.47 ms | 411.91 ms |

**Interpretation and limit:** 11,000 is the highest count successfully tested
on this local setup, not an architectural or measured maximum. Since the run
stopped at the configured cap without connection failures, it establishes that
this setup handled 11,000 concurrent sockets for the recorded test, but does
not establish what higher counts it could support. Supporting more is
plausible, but remains unverified and depends on the server, database, load
generator, and deployment resources.

During the run, local monitoring noted about 97% system RAM use and roughly
1,250 MB used by the Docker backend. Treat memory pressure as a limit of this
test environment; do not increase the load on this machine while it is near
saturation. CPU and PostgreSQL connection/resource metrics were not recorded,
so those bottlenecks cannot be assessed from this run.

The result report contains the per-attempt measurements and stage details:
[concurrent-connections-2026-11-13T22-54-31-654Z.json](../socketIO_tests/concurrent_connection_limit/results/concurrent-connections-2026-11-13T22-54-31-654Z.json).

### Connection Requests Performance Test

These five local runs measure **Socket.IO connection attempts**, not application
event/message latency. Every attempt used a unique token-pool user, WebSocket
transport, no automatic reconnection, and no application events. Each profile
made 11,000 attempts in total. The hold duration was changed between runs to
keep pressure on the local setup.

#### Test setup and interpretation

| Parameter | Recorded value |
| --- | --- |
| API target | `http://localhost:3000` |
| Client / operating system | Node.js v24.20.0 on Windows |
| System memory reported to Node | 16,487,870,464 bytes (about 15.36 GiB) |
| Transport / reconnection | WebSocket only; automatic reconnection disabled |
| Connection timeout | 10 seconds |
| Maximum attempts / users | 11,000 unique authenticated test users per run |
| Client RSS guard | 512 MiB |
| Application events | None |
| Successful connection definition | Socket.IO `connect` event; a successful socket is held through that round's observation |

The target rate is the intended **attempt dispatch rate**. The report's actual
rate is what the client runner managed to dispatch; it is not a server-side
request counter. The client and local API/Docker backend ran on the same
machine and therefore competed for CPU, memory, and other local resources.
Server/API CPU, server RSS, database CPU/RSS, PostgreSQL connection count, and
container throttling were not captured. The client-side event-loop delays and
actual dispatch rates show that the load generator was also under pressure.

Consequently, these runs do not establish an architectural capacity limit or
prove that a production deployment fails at the same rates. In particular,
the two load profiles had zero failed connections, but the client dispatched
below the 1,000/s target and successful handshakes were not instantaneous.
Describe this as **11,000 successful attempts in these local 1,000/s-target
profiles**, not as a verified 1,000 connection requests/second capacity.

#### Run summaries

| Run (UTC) | Hold per round | Duration | Attempts | Connected | Failed | Failure rate | Unexpected disconnects | Active before cleanup | Peak pending attempts | Runner-reported actual dispatch rate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Load 1 — 2026-11-14 09:00 | 1 s | 61.81 s | 11,000 | 11,000 | 0 | 0% | 0 | 11,000 | 978 | 728–950/s |
| Load 2 — 2026-11-14 09:06 | 2 s | 71.99 s | 11,000 | 11,000 | 0 | 0% | 0 | 11,000 | 945 | 740–971/s |
| Stress 1 — 2026-11-14 09:17 | 2 s | 43.81 s | 11,000 | 7,022 | 3,978 | 36.16% | 0 | 7,022 | 4,000 | 978–2,922/s |
| Stress 2 — 2026-11-14 09:22 | 3 s | 48.89 s | 11,000 | 7,027 | 3,973 | 36.12% | 0 | 7,027 | 4,000 | 968–2,606/s |
| Spike — 2026-11-14 09:26 | 4 s | 44.07 s | 11,000 | 3,001 | 7,999 | 72.72% | 0 | 3,001 | 7,999 | 791–3,711/s |

The peak-pending column is the highest number of unresolved client connection
attempts at once, not the number of active sockets. “Active before cleanup” is
the number of established sockets at the end of the run before teardown.

#### Per-round outcomes

“Actual/s” is the runner-reported dispatch rate. “Connected p95 / failed p95”
are connection-establishment and failed-attempt latency percentiles in
milliseconds; a dash means there were no attempts of that outcome in the round.
“Active after hold” is the successful sockets still connected after that
round's observation.

**Load 1 — 1-second holds**

| Round | Target/s | Actual/s | Attempts | Connected | Failed | Failure rate | Connected p95 / failed p95 (ms) | Active after hold |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1,000 | 844 | 1,000 | 1,000 | 0 | 0% | 5,343 / — | 1,000 |
| 2 | 1,000 | 905 | 1,000 | 1,000 | 0 | 0% | 2,958 / — | 2,000 |
| 3 | 1,000 | 925 | 1,000 | 1,000 | 0 | 0% | 3,098 / — | 3,000 |
| 4 | 1,000 | 888 | 1,000 | 1,000 | 0 | 0% | 3,144 / — | 4,000 |
| 5 | 1,000 | 766 | 1,000 | 1,000 | 0 | 0% | 2,746 / — | 5,000 |
| 6 | 1,000 | 883 | 1,000 | 1,000 | 0 | 0% | 3,134 / — | 6,000 |
| 7 | 1,000 | 823 | 1,000 | 1,000 | 0 | 0% | 3,344 / — | 7,000 |
| 8 | 1,000 | 950 | 1,000 | 1,000 | 0 | 0% | 2,321 / — | 8,000 |
| 9 | 1,000 | 913 | 1,000 | 1,000 | 0 | 0% | 2,154 / — | 9,000 |
| 10 | 1,000 | 919 | 1,000 | 1,000 | 0 | 0% | 3,924 / — | 10,000 |
| 11 | 1,000 | 728 | 1,000 | 1,000 | 0 | 0% | 3,608 / — | 11,000 |

**Load 2 — 2-second holds**

| Round | Target/s | Actual/s | Attempts | Connected | Failed | Failure rate | Connected p95 / failed p95 (ms) | Active after hold |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1,000 | 932 | 1,000 | 1,000 | 0 | 0% | 4,481 / — | 1,000 |
| 2 | 1,000 | 930 | 1,000 | 1,000 | 0 | 0% | 2,883 / — | 2,000 |
| 3 | 1,000 | 918 | 1,000 | 1,000 | 0 | 0% | 3,112 / — | 3,000 |
| 4 | 1,000 | 836 | 1,000 | 1,000 | 0 | 0% | 2,928 / — | 4,000 |
| 5 | 1,000 | 971 | 1,000 | 1,000 | 0 | 0% | 3,492 / — | 5,000 |
| 6 | 1,000 | 740 | 1,000 | 1,000 | 0 | 0% | 3,364 / — | 6,000 |
| 7 | 1,000 | 876 | 1,000 | 1,000 | 0 | 0% | 3,183 / — | 7,000 |
| 8 | 1,000 | 920 | 1,000 | 1,000 | 0 | 0% | 3,180 / — | 8,000 |
| 9 | 1,000 | 887 | 1,000 | 1,000 | 0 | 0% | 3,550 / — | 9,000 |
| 10 | 1,000 | 830 | 1,000 | 1,000 | 0 | 0% | 2,699 / — | 10,000 |
| 11 | 1,000 | 948 | 1,000 | 1,000 | 0 | 0% | 2,562 / — | 11,000 |

**Stress — 1,000/s, 2,000/s, 4,000/s, 4,000/s**

| Run | Round | Target/s | Actual/s | Attempts | Connected | Failed | Failure rate | Connected p95 / failed p95 (ms) | Active after hold |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Stress 1 | 1 | 1,000 | 978 | 1,000 | 1,000 | 0 | 0% | 4,288 / — | 1,000 |
| Stress 1 | 2 | 2,000 | 1,643 | 2,000 | 2,000 | 0 | 0% | 6,761 / — | 3,000 |
| Stress 1 | 3 | 4,000 | 2,922 | 4,000 | 4,000 | 0 | 0% | 8,066 / — | 7,000 |
| Stress 1 | 4 | 4,000 | 2,108 | 4,000 | 22 | 3,978 | 99.45% | 9,507 / 10,005 | 7,022 |
| Stress 2 | 1 | 1,000 | 968 | 1,000 | 1,000 | 0 | 0% | 4,203 / — | 1,000 |
| Stress 2 | 2 | 2,000 | 1,717 | 2,000 | 2,000 | 0 | 0% | 6,550 / — | 3,000 |
| Stress 2 | 3 | 4,000 | 2,606 | 4,000 | 4,000 | 0 | 0% | 8,754 / — | 7,000 |
| Stress 2 | 4 | 4,000 | 2,135 | 4,000 | 27 | 3,973 | 99.33% | 9,145 / 10,014 | 7,027 |

All failed handshakes in the final stress round of each run were reported as
“Connection timed out after 10 seconds.” The two runs therefore show a
repeatable failure pattern in the *second* 4,000-attempt wave, after the first
three waves had established 7,000 sockets. This is an observed local-test
boundary, not proof that 7,000 is a server or architecture limit.

**Spike — 1,000/s, 1,000/s, 8,000/s, 1,000/s**

| Round | Target/s | Actual/s | Attempts | Connected | Failed | Failure rate | Connected p95 / failed p95 (ms) | Active after hold |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1,000 | 903 | 1,000 | 1,000 | 0 | 0% | 4,314 / — | 1,000 |
| 2 | 1,000 | 791 | 1,000 | 1,000 | 0 | 0% | 2,909 / — | 2,000 |
| 3 | 8,000 | 3,711 | 8,000 | 1 | 7,999 | 99.99% | 8 / 10,178 | 2,001 |
| 4 | 1,000 | 861 | 1,000 | 1,000 | 0 | 0% | 2,836 / — | 3,001 |

All 7,999 failures in the 8,000-attempt spike wave timed out after 10 seconds.
The single successful handshake is not a meaningful latency sample. The
following 1,000-attempt wave succeeded, so the spike result demonstrates a
severe failure for that particular burst on this setup, not a persistent
failure of all subsequent connection requests.

#### Latency and local load-generator observations

Latency values below are milliseconds from the JSON reports. Connection
establishment latency is measured until the Socket.IO `connect` event. Failed
attempt latency is shown separately because the failed handshakes largely
reached the 10-second timeout. Empty failure fields mean no failed attempts.

| Run | Successful connection latency: min / avg / p50 / p90 / p95 / p99 / max | Failed attempt latency: min / avg / p50 / p90 / p95 / p99 / max |
| --- | --- | --- |
| Load 1 | 6 / 2,022 / 1,803 / 3,158 / 3,732 / 5,195 / 5,605 | — |
| Load 2 | 6 / 2,069 / 2,054 / 3,133 / 3,432 / 4,215 / 4,615 | — |
| Stress 1 | 7 / 5,567 / 6,869 / 7,753 / 7,977 / 8,126 / 9,507 | 9,999 / 10,001 / 10,001 / 10,004 / 10,005 / 10,008 / 10,014 |
| Stress 2 | 6 / 5,907 / 7,706 / 8,579 / 8,700 / 8,832 / 9,145 | 9,999 / 10,003 / 10,001 / 10,012 / 10,014 / 10,015 / 10,016 |
| Spike | 8 / 2,233 / 2,140 / 3,653 / 3,982 / 4,336 / 4,426 | 10,007 / 10,100 / 10,114 / 10,149 / 10,178 / 10,185 / 10,186 |

The client process itself also showed resource pressure:

| Run | Client RSS initial / highest after-round sample / final (MiB) | Heap initial / highest after-round sample / final (MiB) | Client CPU user / system (s) | Client event-loop delay p95 / max (ms) |
| --- | ---: | ---: | ---: | ---: |
| Load 1 | 93.5 / 425.0 / 431.4 | 33.5 / 214.3 / 264.2 | 14.66 / 19.58 | 67 / 624 |
| Load 2 | 87.3 / 403.9 / 410.7 | 40.1 / 210.4 / 257.0 | 15.52 / 19.58 | 59 / 951 |
| Stress 1 | 89.6 / 427.0 / 434.8 | 33.6 / 268.0 / 284.0 | 12.53 / 17.42 | 32 / 4,475 |
| Stress 2 | 87.0 / 438.3 / 455.8 | 40.1 / 235.9 / 257.6 | 14.02 / 17.69 | 32 / 3,171 |
| Spike | 87.3 / 373.0 / 389.3 | 40.2 / 123.9 / 143.4 | 10.77 / 16.19 | 58 / 4,790 |

The event-loop delay and dispatch shortfall are important: the generator was
sharing this machine with the local backend and was not a neutral, independent
load source. A target of 8,000 attempts/s resulted in only about 3,711
attempts/s actually dispatched in the spike wave. The 4,000/s stress waves
dispatched at about 2,108–2,922/s. Do not interpret target rates as achieved
rates or attribute every observed limit solely to the backend.

#### Conclusions and follow-up

- Both 1,000/s-target load profiles completed all 11,000 attempts with zero
  failures and reached 11,000 active sockets before cleanup. The actual
  per-round dispatch rate was about 728–971/s, and aggregate successful
  connection p95 was about 3.43–3.73 seconds. This is evidence of successful
  completion under these local profiles, not a guarantee of zero failures
  during simultaneous REST or conversation activity.
- In both stress runs, the first 7,000 attempts succeeded; the next 4,000
  attempts produced 3,978 and 3,973 timeouts, respectively. In the spike, the
  8,000-attempt wave produced one success and 7,999 timeouts. These failures
  may reflect backend limits, client-generator saturation, shared-machine
  resource contention, or a combination. No server/database telemetry was
  collected to separate those causes.
- For a more representative capacity assessment, repeat with the load
  generator on a separate machine, collect API/container CPU and RSS plus
  database connection/pool/resource metrics, and keep the offered and achieved
  request rates distinct.
- A future mixed-service test should use controlled rates for connection
  attempts alongside room joins, message send/receive, and selected REST calls.
  Record per-operation throughput, success/failure counts and reasons,
  acknowledgement/response latency percentiles, active sockets, and server,
  database, and load-generator resources. Increase one workload dimension at a
  time and include a baseline with each service tested alone.
- The last two result reports record 11,000 disconnect confirmations and zero
  client sockets remaining connected. Cleanup metadata was not present in the
  earlier three reports because they predate the runner's awaited-cleanup
  reporting.

Detailed per-attempt reports:

- [Load 1 — 2026-11-14 09:00 UTC](../socketIO_tests/connection_req_performance/results/connection-request-load-2026-11-14T09-00-12-024Z.json)
- [Load 2 — 2026-11-14 09:06 UTC](../socketIO_tests/connection_req_performance/results/connection-request-load-2026-11-14T09-06-28-093Z.json)
- [Stress 1 — 2026-11-14 09:17 UTC](../socketIO_tests/connection_req_performance/results/connection-request-stress-2026-11-14T09-17-10-075Z.json)
- [Stress 2 — 2026-11-14 09:22 UTC](../socketIO_tests/connection_req_performance/results/connection-request-stress-2026-11-14T09-22-03-728Z.json)
- [Spike — 2026-11-14 09:26 UTC](../socketIO_tests/connection_req_performance/results/connection-request-spike-2026-11-14T09-26-57-817Z.json)


### Message Performance Test

This is a paced, single-sender direct-conversation run. It records the sender
acknowledgement separately from the recipient's `message:new` event, so the
two latency paths and delivery correctness can be compared.

| Run (UTC) | Profile | Workload (messages; gap) | Attempted | Acknowledged / failed / timed out | Received / missing / duplicate | Throughput (messages/s) | Peak sockets | Cleanup (before -> after) |
| --- | --- | --- | ---: | --- | --- | ---: | ---: | --- |
| 2026-11-14 14:37:50.114 UTC | baseline | 100; 500 ms | 100 | 100 / 0 / 0 | 100 / 0 / 0 | 1.92 | 2 | 2 -> 0 |
| 2026-11-14 14:44:05.061 UTC | light | 300; 200 ms | 300 | 300 / 0 / 0 | 300 / 0 / 0 | 4.59 | 2 | 2 -> 0 |
| 2026-11-14 14:47:14.344 UTC | moderate | 500; 100 ms | 500 | 500 / 0 / 0 | 500 / 0 / 0 | 8.15 | 2 | 2 -> 0 |
| 2026-11-14 14:49:09.035 UTC | heavy | 1,000; 50 ms | 1,000 | 1,000 / 0 / 0 | 1,000 / 0 / 0 | 15.41 | 2 | 2 -> 0 |
| 2026-11-14 14:51:29.200 UTC | ultra (extended) | 4,000; 20 ms | 4,000 | 4,000 / 0 / 0 | 4,000 / 0 / 0 | 30.84 | 2 | 2 -> 0 |

**Acknowledgement and delivery latency** (milliseconds; each statistic is calculated from that run's measured samples):

| Profile | Measurement | Min (ms) | Avg (ms) | p50 (ms) | p90 (ms) | p95 (ms) | p99 (ms) | Max (ms) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline | Sender acknowledgement | 8.84 | 17.84 | 15.98 | 26.95 | 29.03 | 39.5 | 70.61 |
| baseline | Recipient delivery | 8.76 | 17.76 | 15.97 | 26.87 | 28.9 | 39.43 | 70.29 |
| light | Sender acknowledgement | 8.67 | 12.11 | 11.58 | 13.95 | 14.94 | 23.32 | 54.41 |
| light | Recipient delivery | 8.59 | 12.06 | 11.52 | 13.9 | 15.01 | 23.23 | 54.35 |
| moderate | Sender acknowledgement | 8 | 11.42 | 10.65 | 13.31 | 16.75 | 24.05 | 42.86 |
| moderate | Recipient delivery | 8.03 | 11.41 | 10.66 | 13.24 | 16.67 | 24.16 | 42.7 |
| heavy | Sender acknowledgement | 7.94 | 11.38 | 10.75 | 13.15 | 14.42 | 22.04 | 91.7 |
| heavy | Recipient delivery | 7.9 | 11.36 | 10.76 | 13.17 | 14.37 | 22 | 91.58 |
| ultra (extended) | Sender acknowledgement | 7.35 | 9.99 | 9.76 | 11.08 | 12 | 16.49 | 62.54 |
| ultra (extended) | Recipient delivery | 7.3 | 9.97 | 9.73 | 11.04 | 11.95 | 16.05 | 58.96 |

**Load-generator resources.** RSS and heap are MiB (1 MiB = 1,048,576 bytes); CPU time and event-loop delay are measured on the Node.js load generator, not the backend.

| Profile | RSS MiB (initial / peak / final) | Heap MiB (initial / peak / final) | CPU ms (user / system / total) | Event-loop delay ms (p95 / max) |
| --- | --- | --- | --- | --- |
| baseline | 58.2 / 104.5 / 75.6 | 9.0 / 44.6 / 23.3 | 297 / 203 / 500 | 32.13 / 48.82 |
| light | 58.2 / 104.2 / 75.7 | 9.0 / 44.5 / 23.8 | 516 / 188 / 704 | 32.03 / 49.97 |
| moderate | 58.3 / 105.1 / 76.2 | 9.0 / 45.0 / 23.7 | 828 / 188 / 1016 | 32.08 / 41.88 |
| heavy | 58.3 / 105.0 / 77.0 | 9.0 / 44.9 / 24.4 | 812 / 313 / 1125 | 32.33 / 48.82 |
| ultra (extended) | 58.3 / 105.7 / 81.7 | 9.0 / 44.5 / 26.1 | 2016 / 610 / 2626 | 31.65 / 36.11 |


### Concurrent Message Load Test

This test connects multiple direct-message sender/receiver pairs and runs the senders concurrently. It measures concurrent message throughput and separately tracks sender acknowledgements and recipient deliveries.

| Run (UTC) | Profile | Clients / senders / messages per sender | Attempted | Acknowledged / failed / timed out | Received / missing / duplicate | Duration (s) | Throughput (messages/s) | Peak sockets | Cleanup (before -> after) |
| --- | --- | --- | ---: | --- | --- | ---: | ---: | ---: | --- |
| 2026-11-14 14:59:11.687 UTC | baseline | 10 / 5 / 20 | 100 | 100 / 0 / 0 | 100 / 0 / 0 | 4.55 | 21.96 | 10 | 10 -> 0 |
| 2026-11-14 15:00:48.599 UTC | light | 20 / 10 / 30 | 300 | 300 / 0 / 0 | 300 / 0 / 0 | 6.88 | 43.59 | 20 | 20 -> 0 |
| 2026-11-14 15:02:06.238 UTC | moderate | 50 / 25 / 30 | 750 | 750 / 0 / 0 | 750 / 0 / 0 | 6.87 | 109.21 | 50 | 50 -> 0 |
| 2026-11-14 15:02:45.307 UTC | heavy | 100 / 50 / 30 | 1,500 | 1,500 / 0 / 0 | 1,500 / 0 / 0 | 7.7 | 194.85 | 100 | 100 -> 0 |
| 2026-11-14 15:05:04.743 UTC | ultra (extended) | 500 / 250 / 50 | 12,500 | 12,500 / 0 / 0 | 12,500 / 0 / 0 | 38.34 | 326.02 | 500 | 500 -> 0 |

**Acknowledgement and delivery latency** (milliseconds):

| Profile | Measurement | Min (ms) | Avg (ms) | p50 (ms) | p90 (ms) | p95 (ms) | p99 (ms) | Max (ms) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline | Sender acknowledgement | 9.14 | 19.96 | 15.18 | 31.25 | 52.61 | 67 | 67.57 |
| baseline | Recipient delivery | 9.25 | 19.91 | 15.02 | 31.44 | 52.51 | 67.14 | 67.73 |
| light | Sender acknowledgement | 8.07 | 14.65 | 11.08 | 16.42 | 19.81 | 89.46 | 91.36 |
| light | Recipient delivery | 7.75 | 14.57 | 11 | 16.26 | 19.73 | 89.8 | 91.2 |
| moderate | Sender acknowledgement | 7.61 | 18.66 | 11.6 | 20.66 | 32.27 | 186.96 | 209 |
| moderate | Recipient delivery | 7.56 | 18.58 | 11.51 | 20.47 | 32.11 | 186.86 | 208.89 |
| heavy | Sender acknowledgement | 7.62 | 35.79 | 16.96 | 56.13 | 151.61 | 355.71 | 363.74 |
| heavy | Recipient delivery | 7.55 | 35.69 | 16.88 | 55.93 | 151.56 | 355.64 | 363.57 |
| ultra (extended) | Sender acknowledgement | 8.86 | 556.72 | 515.09 | 685.83 | 842.12 | 1536.96 | 1630.13 |
| ultra (extended) | Recipient delivery | 8.78 | 556.62 | 515.01 | 685.84 | 842.2 | 1536.78 | 1629.68 |

**Load-generator resources** (see units above):

| Profile | RSS MiB (initial / peak / final) | Heap MiB (initial / peak / final) | CPU ms (user / system / total) | Event-loop delay ms (p95 / max) |
| --- | --- | --- | --- | --- |
| baseline | 58.3 / 113.9 / 106.9 | 9.1 / 43.7 / 40.7 | 203 / 110 / 313 | 32.16 / 69.07 |
| light | 58.4 / 111.9 / 104.1 | 9.0 / 46.3 / 26.0 | 406 / 172 / 578 | 32.28 / 35.82 |
| moderate | 58.5 / 114.2 / 108.2 | 9.1 / 46.8 / 41.2 | 719 / 218 / 937 | 32.05 / 38.93 |
| heavy | 58.3 / 131.8 / 119.6 | 9.1 / 63.4 / 44.7 | 1141 / 391 / 1532 | 31.57 / 46.53 |
| ultra (extended) | 58.4 / 158.3 / 130.6 | 9.0 / 64.1 / 43.9 | 5438 / 2468 / 7906 | 31.74 / 187.7 |


### Group Fanout Test

One sender sends to each pre-created group. Expected deliveries exclude the sender's sending socket. The table reports both message acknowledgements and recipient-event counts, so the event throughput should not be confused with messages per second.

| Run (UTC) | Profile | Group members | Messages | Acknowledged / failed / timed out | Expected / received delivery events | Missing / duplicate | Duration (s) | Throughput (delivery events/s) | Peak sockets | Cleanup (before -> after) |
| --- | --- | ---: | ---: | --- | --- | --- | ---: | ---: | ---: | --- |
| 2026-11-14 15:13:46.355 UTC | baseline | 2 | 100 | 100 / 0 / 0 | 100 / 100 | 0 / 0 | 1.17 | 71.91 | 2 | 2 -> 0 |
| 2026-11-14 15:15:16.590 UTC | small | 5 | 100 | 100 / 0 / 0 | 400 / 400 | 0 / 0 | 1.07 | 310.79 | 5 | 5 -> 0 |
| 2026-11-14 15:16:12.508 UTC | medium | 10 | 100 | 100 / 0 / 0 | 900 / 900 | 0 / 0 | 1.21 | 632.16 | 10 | 10 -> 0 |
| 2026-11-14 15:17:53.652 UTC | large | 25 | 100 | 100 / 0 / 0 | 2,400 / 2,400 | 0 / 0 | 1.27 | 1603.07 | 25 | 25 -> 0 |
| 2026-11-14 15:19:16.739 UTC | ultra (extended) | 50 | 500 | 500 / 0 / 0 | 24,500 / 24,500 | 0 / 0 | 6.73 | 3518.15 | 50 | 50 -> 0 |

**Acknowledgement and per-recipient delivery latency** (milliseconds):

| Profile | Measurement | Min (ms) | Avg (ms) | p50 (ms) | p90 (ms) | p95 (ms) | p99 (ms) | Max (ms) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline | Message acknowledgement | 8.78 | 11.64 | 11.07 | 13.28 | 15.03 | 24.16 | 33.72 |
| baseline | Per-recipient delivery | 8.67 | 11.55 | 10.95 | 13.44 | 14.92 | 24.06 | 33.42 |
| small | Message acknowledgement | 8.53 | 10.68 | 10.02 | 13 | 14.05 | 17.58 | 26.36 |
| small | Per-recipient delivery | 8.26 | 10.53 | 9.9 | 12.85 | 13.98 | 17.43 | 26.19 |
| medium | Message acknowledgement | 8.83 | 12.03 | 10.28 | 15.24 | 16.45 | 47.33 | 64.77 |
| medium | Per-recipient delivery | 8.2 | 11.81 | 10.15 | 15.17 | 16.13 | 46.99 | 64.68 |
| large | Message acknowledgement | 8.97 | 12.68 | 10.99 | 15.19 | 16.79 | 24.67 | 95.17 |
| large | Per-recipient delivery | 7.74 | 12.01 | 10.5 | 14.47 | 16.03 | 24.97 | 94.82 |
| ultra (extended) | Message acknowledgement | 9.92 | 13.44 | 12.52 | 15.04 | 16.33 | 18.93 | 273.12 |
| ultra (extended) | Per-recipient delivery | 7.78 | 11.75 | 10.91 | 13.53 | 14.74 | 17.75 | 272.69 |

**Load-generator resources** (see units above):

| Profile | RSS MiB (initial / peak / final) | Heap MiB (initial / peak / final) | CPU ms (user / system / total) | Event-loop delay ms (p95 / max) |
| --- | --- | --- | --- | --- |
| baseline | 58.3 / 97.2 / 97.2 | 9.0 / 37.3 / 37.3 | 172 / 31 / 203 | 31.6 / 44.5 |
| small | 58.1 / 97.9 / 92.5 | 9.0 / 38.2 / 21.7 | 140 / 94 / 234 | 31.93 / 44.56 |
| medium | 58.3 / 106.3 / 106.3 | 9.0 / 39.8 / 39.9 | 188 / 110 / 298 | 31.56 / 43.16 |
| large | 58.2 / 110.9 / 99.0 | 9.0 / 45.3 / 31.6 | 422 / 156 / 578 | 31.8 / 34.77 |
| ultra (extended) | 58.4 / 124.4 / 124.4 | 9.1 / 48.3 / 27.5 | 1453 / 594 / 2047 | 29.49 / 77.86 |


### Realtime Event Tests

The three profiled scenarios below ran with 50 connected clients and 500 measured requests, pairs, or cycles. These counts describe the workload issued against connected clients; they do not mean 500 clients or 500 simultaneous operations. The presence-transition scenario is different: it is one controlled lifecycle sequence, not a load profile.

| Scenario | Run (UTC) | Executed workload | Completion and event counts | Rate | Peak sockets | Cleanup (before -> after) |
| --- | --- | --- | --- | ---: | ---: | --- |
| typing | 2026-11-14 15:26:43.607 UTC | moderate: 50 clients; 500 start/stop pairs (1,000 events) | 1,000/1,000 acknowledgements; 0 failed/timeouts; 49,000/49,000 expected/received; 0 missing, 0 duplicate | 99.88 events/s | 50 | 50 -> 0 |
| presence-snapshots | 2026-11-14 15:29:08.538 UTC | moderate: 50 clients; 500 snapshot requests | 500/500 acknowledgements; 0 failed/timeouts; 500 responses; 0 missing | 242.97 requests/s | 50 | 50 -> 0 |
| join-leave | 2026-11-14 15:30:23.063 UTC | moderate: 50 clients; 500 cycles by one actor | 500/500 joins; 500/500 leaves; 0 failed/timeouts; 500 join snapshots; 0 missing | 305.76 operations/s | 50 | 50 -> 0 |
| presence-transitions | 2026-11-14 15:34:40.920 UTC | controlled: 1 observer + 2 sockets for one target user; 1 sequence (not a moderate-load run) | 1 online; 0 offline after first close; 1 offline after final close; 0 duplicates; 1/1 observer snapshots; online event before connect callback: false | - | 3 | 1 -> 0 |

The archived presence-transition report's configuration says `profile: moderate`,
`clients: 50`, and `workload: 500`, but those values did not control this
scenario. The measured summary shows three peak connections and one sequence.
One connection (the observer) remains before cleanup after both target sockets
have been disconnected; cleanup then closes it. The current runner reports this
as a controlled profile with the actual socket and sequence counts.

For the other three scenarios, all 50 initial presence snapshots arrived. All
19 recorded reports had empty error lists and no unexpected disconnects; every
run cleaned up to zero connected sockets. Warm-up operations were zero. The
ultra (extended) runs exceed the profiles currently supported by the benchmark
scripts; they are included for completeness, not as standard profiles.

**Realtime event latency** (milliseconds; initial snapshots are measured from
connection start):

| Scenario | Measurement | Min (ms) | Avg (ms) | p50 (ms) | p90 (ms) | p95 (ms) | p99 (ms) | Max (ms) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| typing | Typing start acknowledgement | 4.23 | 5.66 | 5.42 | 6.74 | 7.46 | 9.09 | 25.77 |
| typing | Typing stop acknowledgement | 4.33 | 5.73 | 5.47 | 6.67 | 7.03 | 9.88 | 36.53 |
| typing | Typing-start delivery | 2.83 | 4.82 | 4.66 | 5.92 | 6.56 | 8.81 | 25.98 |
| typing | Typing-stop delivery | 2.76 | 4.81 | 4.61 | 5.93 | 6.44 | 8.94 | 36.71 |
| typing | Initial presence snapshot | 535.55 | 572.35 | 570.57 | 594.62 | 595.98 | 597.6 | 597.6 |
| presence-snapshots | Requested snapshot response | 2.98 | 4.06 | 3.88 | 5.12 | 5.89 | 7.08 | 8.6 |
| presence-snapshots | Snapshot acknowledgement | 2.99 | 4.09 | 3.91 | 5.16 | 6.02 | 7.44 | 8.63 |
| presence-snapshots | Initial presence snapshot | 374.29 | 383.83 | 385.85 | 391.82 | 392.45 | 394.93 | 394.93 |
| join-leave | Join acknowledgement | 2.97 | 4.06 | 3.86 | 5.05 | 5.72 | 6.77 | 9.03 |
| join-leave | Leave acknowledgement | 1.85 | 2.44 | 2.28 | 3.03 | 3.46 | 4.12 | 6.21 |
| join-leave | Join presence snapshot | 2.96 | 4.04 | 3.83 | 5.02 | 5.7 | 6.66 | 9.01 |
| join-leave | Initial presence snapshot | 621.76 | 649.04 | 650.53 | 668.46 | 671.63 | 671.92 | 671.92 |
| presence-transitions | Online transition | 3.9 | 3.9 | 3.9 | 3.9 | 3.9 | 3.9 | 3.9 |
| presence-transitions | Offline transition | 4.96 | 4.96 | 4.96 | 4.96 | 4.96 | 4.96 | 4.96 |
| presence-transitions | Observer initial presence snapshot | 20.18 | 20.18 | 20.18 | 20.18 | 20.18 | 20.18 | 20.18 |

The presence-transition latency values come from one observed event of each kind; identical min/average/percentile/max values are therefore a single sample, not a distribution. Its first-socket connect duration was 7.45 ms, separate from the online transition latency.

**Load-generator resources** (see units above; the presence-transition row
reflects its three-socket controlled run):

| Scenario | RSS MiB (initial / peak / final) | Heap MiB (initial / peak / final) | CPU ms (user / system / total) | Event-loop delay ms (p95 / max) |
| --- | --- | --- | --- | --- |
| typing | 58.5 / 124.4 / 124.4 | 9.1 / 52.3 / 47.4 | 1922 / 688 / 2610 | 31.44 / 51.74 |
| presence-snapshots | 58.4 / 113.9 / 100.4 | 9.1 / 46.7 / 24.5 | 531 / 188 / 719 | 30.82 / 51.12 |
| join-leave | 58.3 / 114.0 / 99.9 | 9.1 / 47.0 / 30.7 | 422 / 359 / 781 | 30.15 / 53.22 |
| presence-transitions | 58.5 / 94.6 / 94.7 | 9.1 / 35.0 / 35.0 | 156 / 47 / 203 | 31.83 / 39.52 |


### Reading these results

These are single local runs against `http://localhost:3000`, using Node.js
v24.20.0, WebSocket transport, disabled automatic reconnection, 10-second
connection/acknowledgement/delivery timeouts, and a reported host memory total
of 16,487,870,464 bytes (~15.4 GiB). The workload and rate figures are
application-level outcomes, not a server-capacity guarantee. RSS, heap, CPU
time, and event-loop delay describe only the load-generator process; they do
not report backend or PostgreSQL resource use. Compare latency percentiles
with both the workload shape and load-generator event-loop delay in view.
