# V1 Performance Test Results

## Executive summary

These are exploratory local k6 results for authentication registration,
login, and refresh. The tests show two different throughput patterns:

- **Registration and login** plateaued around 19–20 requests/second. Latency
  rose sharply as concurrency increased. Login also returned HTTP 500 errors
  in the 200- and 400-VU runs.
- **Refresh** completed all recorded requests without HTTP failures. Throughput
  stayed around 252–268 requests/second across 50 to 1,000 configured peak VUs,
  while p95 latency rose from about 180 ms at 50 VUs to 5.29 seconds in the
  short 1,000-VU spike.

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

Configured peak VUs represent the profile's target maximum, not the number of
requests completed simultaneously. Throughput is completed HTTP requests per
second. As latency rises, each VU completes fewer iterations, so concurrency,
throughput, and latency should be considered together.

## Test scope and conditions

- **Load generator:** k6.
- **Endpoints:** `POST /auth/register`, `POST /auth/login`, and
  `POST /auth/refresh`.
- **Checks:** registration checks HTTP 201; login checks HTTP 200, expected
  username, and both tokens; refresh checks HTTP 200, expected username, and
  a rotated refresh token.
- **Thresholds:** no pass/fail performance thresholds were enabled. The check
  and HTTP failure metrics still report request outcomes.
- **Database effects:** successful registration and login create auth
  sessions and refresh-token records. Refresh rotates the refresh-token record
  on every successful request.
- **Environment:** local Docker-based API/database and local k6 runs. CPU,
  memory, PostgreSQL connection count, and load-generator resource usage were
  not recorded.

These runs are exploratory samples, not a production-readiness assessment or
a precise capacity benchmark. Run duration, machine load, database state, and
runtime configuration can materially affect the results.

## Registration

All recorded registration requests returned HTTP 201. Throughput stayed
between 19.43 and 20.40 req/s as configured peak concurrency increased from
20 to 400 VUs. At the same time, p95 latency grew from 1.11 seconds to 19.32
seconds. This indicates that the tested setup did not gain throughput from
additional concurrency; requests instead experienced substantially longer
latency.

The 200-VU stress profile used stages of 20, 50, 100, 150, and 200 VUs, followed
by ramp-down. The 400-VU spike profile ramped from 5 to 400 VUs in 2 seconds,
then returned to 5 VUs.

## Login

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

## Refresh

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

## Reproducibility and next steps

- See the [registration load](../k6_tests/auth_service/register/register_user_load.js),
  [stress](../k6_tests/auth_service/register/register_user_stress.js), and
  [spike](../k6_tests/auth_service/register/register_user_spike.js) scripts.
- See the [login load](../k6_tests/auth_service/login/login_user_load.js),
  [stress](../k6_tests/auth_service/login/login_user_stress.js), and
  [spike](../k6_tests/auth_service/login/login_user_spike.js) scripts.
- See the [refresh load](../k6_tests/auth_service/refresh/refresh_user_load.js),
  [stress](../k6_tests/auth_service/refresh/refresh_user_stress.js), and
  [spike](../k6_tests/auth_service/refresh/refresh_user_spike.js) scripts.
- Refresh the saved token pool before each refresh run; refresh tokens are
  single-use and rotated tokens from k6 are not persisted to the pool file.
- Repeat each profile and record API/database CPU and memory, PostgreSQL
  connection counts, database state, k6 version/host, test duration, and
  script revision.
- Compare throughput, p95/max latency, and failure rate. Use longer steady
  stages in addition to brief spikes when evaluating sustained capacity.

## Recorded raw refresh summaries

The following summaries preserve the key k6 metrics from the recorded refresh
runs.

### Refresh load — 50 VUs for 30 seconds

```text
checks_total.......: 8058    267.565643/s
checks_succeeded...: 100.00% 8058 out of 8058
checks_failed......: 0.00%   0 out of 8058
http_req_duration..: avg=93.24ms min=9.67ms med=86.03ms max=298.29ms p(90)=163.94ms p(95)=179.88ms
http_req_failed....: 0.00%  0 out of 8058
http_reqs..........: 8058    267.565643/s
vus_max............: 50
```

### Refresh load — 200 VUs for 30 seconds

```text
checks_total.......: 8051    264.206031/s
checks_succeeded...: 100.00% 8051 out of 8051
checks_failed......: 0.00%   0 out of 8051
http_req_duration..: avg=378.9ms min=12.01ms med=390.77ms max=783.73ms p(90)=660.59ms p(95)=688.71ms
http_req_failed....: 0.00%  0 out of 8051
http_reqs..........: 8051    264.206031/s
vus_max............: 200
```

### Refresh stress — ramp to 600 VUs

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

### Refresh spike — peak 1,000 VUs

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
