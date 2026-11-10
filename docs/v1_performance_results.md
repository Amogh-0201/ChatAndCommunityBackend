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

### Find all users

The authenticated `GET /user?limit=100` test returned a valid first page in all
six recorded runs. No HTTP failures or failed checks were reported. Throughput
was approximately 367–369 requests/second in the 100–300 VU load runs, then
declined slightly at 450 VUs and in the higher-peak stress and spike runs.
Latency increased with concurrency: p95 rose from 244 ms at 100 VUs to 1.15 s
at 450 VUs, 2.13 s in the 800-VU stress profile, and 5.18 s in the 1,000-VU
spike.

| Profile | Configured peak VUs | Duration | Requests | Throughput | Checks passed | HTTP failures | Avg latency | p95 latency | Max latency |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Load | 100 | 30 s | 11,129 | 369.08 req/s | 100% | 0 (0%) | 134.99 ms | 244.03 ms | 296.06 ms |
| Load | 200 | 30 s | 11,205 | 369.75 req/s | 100% | 0 (0%) | 269.99 ms | 500.02 ms | 613.49 ms |
| Load | 300 | 30 s | 11,242 | 367.47 req/s | 100% | 0 (0%) | 409.03 ms | 795.97 ms | 888.74 ms |
| Load | 450 | 30 s | 11,040 | 359.10 req/s | 100% | 0 (0%) | 627.65 ms | 1.15 s | 1.22 s |
| Stress | 800 | 35 s | 12,396 | 350.41 req/s | 100% | 0 (0%) | 1.12 s | 2.13 s | 2.19 s |
| Spike | 1,000 | 12 s | 4,249 | 330.88 req/s | 100% | 0 (0%) | 1.53 s | 5.18 s | 5.63 s |

The load profiles were each run for 30 seconds. The stress profile used
5-second stages targeting 100, 200, and 400 VUs, then 10 seconds at 800 VUs
and 10 seconds at 200 VUs (35 seconds total). The spike profile targeted
200 VUs for 5 seconds, 1,000 VUs for 2 seconds, then 200 VUs for 5 seconds
(12 seconds total). The 1,000-VU value is a brief target peak, not sustained
1,000-VU load.

All runs passed the check that verifies an HTTP 200 response and the expected
first-page data and pagination metadata. These are exploratory local results;
they do not establish production capacity. Compare them with the auth results
only as separate endpoint workloads.

#### Raw k6 output

##### Load — 100 VUs for 30 seconds
```text
TOTAL RESULTS

    checks_total.......: 11129   369.078046/s
    checks_succeeded...: 100.00% 11129 out of 11129
    checks_failed......: 0.00%   0 out of 11129

    ✓ find-all-users returns a valid first page

    HTTP
    http_req_duration..............: avg=134.99ms min=6.01ms med=134.5ms  max=296.06ms p(90)=236.52ms p(95)=244.03ms
      { expected_response:true }...: avg=134.99ms min=6.01ms med=134.5ms  max=296.06ms p(90)=236.52ms p(95)=244.03ms
    http_req_failed................: 0.00%  0 out of 11129
    http_reqs......................: 11129  369.078046/s

    EXECUTION
    iteration_duration.............: avg=135.47ms min=6.49ms med=134.97ms max=297.17ms p(90)=237.03ms p(95)=244.44ms
    iterations.....................: 11129  369.078046/s
    vus............................: 99     min=4          max=99
    vus_max........................: 100    min=100        max=100

    NETWORK
    data_received..................: 86 MB  2.9 MB/s
    data_sent......................: 4.9 MB 164 kB/s




running (0m30.2s), 000/100 VUs, 11129 complete and 0 interrupted iterations
default ✓ [======================================] 000/100 VUs  30s
```

##### Load — 200 VUs for 30 seconds
```text
  TOTAL RESULTS

    checks_total.......: 11205   369.754545/s
    checks_succeeded...: 100.00% 11205 out of 11205
    checks_failed......: 0.00%   0 out of 11205

    ✓ find-all-users returns a valid first page

    HTTP
    http_req_duration..............: avg=269.99ms min=6.27ms med=272.14ms max=613.49ms p(90)=473.12ms p(95)=500.02ms
      { expected_response:true }...: avg=269.99ms min=6.27ms med=272.14ms max=613.49ms p(90)=473.12ms p(95)=500.02ms
    http_req_failed................: 0.00%  0 out of 11205
    http_reqs......................: 11205  369.754545/s

    EXECUTION
    iteration_duration.............: avg=270.48ms min=6.31ms med=272.68ms max=614.55ms p(90)=473.6ms  p(95)=500.56ms
    iterations.....................: 11205  369.754545/s
    vus............................: 199    min=7          max=199
    vus_max........................: 200    min=200        max=200

    NETWORK
    data_received..................: 87 MB  2.9 MB/s
    data_sent......................: 5.0 MB 164 kB/s




running (0m30.3s), 000/200 VUs, 11205 complete and 0 interrupted iterations
default ✓ [======================================] 000/200 VUs  30s
```

##### Load — 300 VUs for 30 seconds
```text
TOTAL RESULTS

    checks_total.......: 11242   367.471978/s
    checks_succeeded...: 100.00% 11242 out of 11242
    checks_failed......: 0.00%   0 out of 11242

    ✓ find-all-users returns a valid first page

    HTTP
    http_req_duration..............: avg=409.03ms min=5.27ms med=387.8ms  max=888.74ms p(90)=755.79ms p(95)=795.97ms
      { expected_response:true }...: avg=409.03ms min=5.27ms med=387.8ms  max=888.74ms p(90)=755.79ms p(95)=795.97ms
    http_req_failed................: 0.00%  0 out of 11242
    http_reqs......................: 11242  367.471978/s

    EXECUTION
    iteration_duration.............: avg=409.54ms min=5.75ms med=388.23ms max=889.79ms p(90)=756.36ms p(95)=796.42ms
    iterations.....................: 11242  367.471978/s
    vus............................: 299    min=10         max=299
    vus_max........................: 300    min=300        max=300

    NETWORK
    data_received..................: 87 MB  2.9 MB/s
    data_sent......................: 5.0 MB 163 kB/s




running (0m30.6s), 000/300 VUs, 11242 complete and 0 interrupted iterations
default ✓ [======================================] 000/300 VUs  30s
```

##### Load — 450 VUs for 30 seconds
```text
 TOTAL RESULTS

    checks_total.......: 11040   359.104436/s
    checks_succeeded...: 100.00% 11040 out of 11040
    checks_failed......: 0.00%   0 out of 11040

    ✓ find-all-users returns a valid first page

    HTTP
    http_req_duration..............: avg=627.65ms min=6.83ms med=620.69ms max=1.22s p(90)=1.12s p(95)=1.15s
      { expected_response:true }...: avg=627.65ms min=6.83ms med=620.69ms max=1.22s p(90)=1.12s p(95)=1.15s
    http_req_failed................: 0.00%  0 out of 11040
    http_reqs......................: 11040  359.104436/s

    EXECUTION
    iteration_duration.............: avg=628.16ms min=6.83ms med=621.11ms max=1.22s p(90)=1.12s p(95)=1.15s
    iterations.....................: 11040  359.104436/s
    vus............................: 449    min=15         max=449
    vus_max........................: 450    min=450        max=450

    NETWORK
    data_received..................: 86 MB  2.8 MB/s
    data_sent......................: 4.9 MB 159 kB/s




running (0m30.7s), 000/450 VUs, 11040 complete and 0 interrupted iterations
default ✓ [======================================] 000/450 VUs  30s
```


##### Stress — ramp to 800 VUs
```text
stages: [
    { duration: '5s', target: 100 },
    { duration: '5s', target: 200 },
    { duration: '5s', target: 400 },
    { duration: '10s', target: 800 },
    { duration: '10s', target: 200 },
  ]

 TOTAL RESULTS

    checks_total.......: 12396   350.410856/s
    checks_succeeded...: 100.00% 12396 out of 12396
    checks_failed......: 0.00%   0 out of 12396

    ✓ find-all-users returns a valid first page

    HTTP
    http_req_duration..............: avg=1.12s min=7.39ms med=1.15s max=2.19s p(90)=2.08s p(95)=2.13s
      { expected_response:true }...: avg=1.12s min=7.39ms med=1.15s max=2.19s p(90)=2.08s p(95)=2.13s
    http_req_failed................: 0.00%  0 out of 12396
    http_reqs......................: 12396  350.410856/s

    EXECUTION
    iteration_duration.............: avg=1.12s min=7.39ms med=1.15s max=2.2s  p(90)=2.08s p(95)=2.13s
    iterations.....................: 12396  350.410856/s
    vus............................: 226    min=19         max=798
    vus_max........................: 800    min=800        max=800

    NETWORK
    data_received..................: 96 MB  2.7 MB/s
    data_sent......................: 5.5 MB 155 kB/s




running (0m35.4s), 000/800 VUs, 12396 complete and 0 interrupted iterations
default ✓ [======================================] 000/800 VUs  35s
```

##### Spike — peak 1,000 VUs
```text
stages: [
    { duration: '5s', target: 200 },
    { duration: '2s', target: 1000 },
    { duration: '5s', target: 200 },
  ]

  TOTAL RESULTS

    checks_total.......: 4249    330.884425/s
    checks_succeeded...: 100.00% 4249 out of 4249
    checks_failed......: 0.00%   0 out of 4249

    ✓ find-all-users returns a valid first page

    HTTP
    http_req_duration..............: avg=1.53s min=6.73ms med=1.27s max=5.63s p(90)=3.95s p(95)=5.18s
      { expected_response:true }...: avg=1.53s min=6.73ms med=1.27s max=5.63s p(90)=3.95s p(95)=5.18s
    http_req_failed................: 0.00%  0 out of 4249
    http_reqs......................: 4249   330.884425/s

    EXECUTION
    iteration_duration.............: avg=1.53s min=7.81ms med=1.27s max=5.64s p(90)=3.95s p(95)=5.18s
    iterations.....................: 4249   330.884425/s
    vus............................: 551    min=36        max=1000
    vus_max........................: 1000   min=1000      max=1000

    NETWORK
    data_received..................: 33 MB  2.6 MB/s
    data_sent......................: 1.9 MB 147 kB/s




running (12.8s), 0000/1000 VUs, 4249 complete and 0 interrupted iterations
default ✓ [======================================] 0000/1000 VUs  12s
```