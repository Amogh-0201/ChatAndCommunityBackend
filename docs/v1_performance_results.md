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
`POST /conversations/groups`, `POST /conversations/:id/join`, and
`GET /conversations/:id/join-requests`. Each k6 iteration sends one HTTP
request. The direct-conversation and group profiles randomly select an eligible
account for each iteration; the direct-conversation profile also selects a
different participant at random. Selection is with replacement, so a pair can
recur.
The [direct-conversation profiles](../k6_tests/conversation_service/get_or_create_direct_conversations/)
and [group profiles](../k6_tests/conversation_service/create_groups/) check
HTTP 201 responses and the expected conversation members or group owner.
The [join profiles](../k6_tests/conversation_service/converstion_join/) choose
a random user and group; expected duplicate or already-member conflicts count
as valid responses. The
[join-request listing profiles](../k6_tests/conversation_service/get_conversation_join_req/)
cycle through saved groups and authenticate as each group's owner.

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
