# V1 Performance Test Results

## Executive summary

These are exploratory local k6 runs of `POST /auth/register` and
`POST /auth/login`. Both endpoints maintained roughly 19–20 completed
requests/second as virtual-user (VU) concurrency increased, while latency
became very high. Registration had no failed requests in the recorded runs.
Login passed all checks at 50 VUs, but returned HTTP 500 errors at higher
concurrency in the 200-VU stress and 400-VU spike runs.

The login server logs identify Prisma error `P2028` while starting the
transaction that creates an auth session and refresh token. This is evidence
that these login failures occurred in the session-creation transaction path.
It does not, by itself, establish whether the underlying constraint was the
database connection pool, database capacity, or another transaction-start
resource limit.

| Route / profile | Peak VUs | Requests | Throughput | HTTP failures | Check success | Avg latency | p95 | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Register load, 20 VUs | 20 | 605 | 19.43 req/s | 0 (0%) | 100% | 515 ms | 1.11 s | 1.44 s |
| Register load, 40 VUs | 40 | 635 | 19.97 req/s | 0 (0%) | 100% | 1.00 s | 1.84 s | 1.92 s |
| Register load, 50 VUs | 50 | 658 | 20.40 req/s | 0 (0%) | 100% | 1.22 s | 2.31 s | 2.43 s |
| Register stress | 200 | 1,724 | 20.33 req/s | 0 (0%) | 100% | 4.26 s | 9.54 s | 20.24 s |
| Register spike | 400 | 876 | 19.51 req/s | 0 (0%) | 100% | 8.89 s | 19.32 s | 29.7 s |
| Login load, 50 VUs | 50 | 636 | 19.74 req/s | 0 (0%) | 100% | 1.26 s | 2.30 s | 2.39 s |
| Login stress | 200 | 1,671 | 19.63 req/s | 6 (0.35%) | 99.64% | 4.40 s | 9.68 s | 51.45 s |
| Login spike | 400 | 878 | 19.46 req/s | 3 (0.34%) | 99.65% | 8.85 s | 19.37 s | 29.88 s |
| Login spike variant | 350 | 815 | 19.36 req/s | 0 (0%) | 100% | 7.55 s | 16.72 s | 26.81 s |

`Peak VUs` is the configured maximum concurrency, not the number of users or
requests served simultaneously throughout the whole run. VUs are concurrent
clients, not requests per second. As response time increases, each VU completes
fewer iterations, so throughput and latency need to be considered together.
All test durations were short and the environment's CPU, memory, and database
connection limits were not recorded.

## Test scope and interpretation

- **Load generator:** k6.
- **Registration:** sends newly generated accounts to `POST /auth/register`.
- **Login:** uses the 1,000 seeded accounts and sends `POST /auth/login`.
- **Checks:** registration checks HTTP 201; login checks HTTP 200, expected
  username, and access/refresh tokens.
- **Thresholds:** disabled for these exploratory runs. Checks and the
  `http_req_failed` metric still report whether requests succeeded; thresholds
  only determine whether k6 marks the run as passing or failing against limits.
- **Data effects:** registration creates user records. Each successful login
  creates a session and refresh-token record. Use an isolated test database.

Registration performs password hashing and writes a user plus session/token
records. Login reads the user, verifies the password hash, and writes session
and refresh-token records. The endpoints share infrastructure but stress
different code paths, so one route's result should not be used as a substitute
for testing the other.

## Registration results

All recorded registration requests returned HTTP 201. Throughput stayed around
19.4–20.4 requests/second across 20 to 400 peak VUs, while p95 latency rose
from 1.11 seconds at 20 VUs to 19.32 seconds at 400 VUs. This suggests the
tested setup reached a throughput plateau and queued additional work rather
than scaling throughput with concurrency. It is successful completion, but not
evidence of acceptable latency at high concurrency.

The stress stages were:

```js
[
  { duration: '15s', target: 20 },
  { duration: '15s', target: 50 },
  { duration: '15s', target: 100 },
  { duration: '15s', target: 150 },
  { duration: '10s', target: 200 },
  { duration: '10s', target: 0 },
]
```

The spike stages were:

```js
[
  { duration: '15s', target: 5 },
  { duration: '2s', target: 400 },
  { duration: '15s', target: 5 },
]
```

## Login results and observed issue

The 50-VU, 30-second login load run passed all 636 checks with no failed
requests. At higher concurrency, the stress run had 6 HTTP 500 failures out of
1,671 requests (0.35%), and the 400-VU spike had 3 HTTP 500 failures out of
878 (0.34%). The associated API logs report Prisma `P2028`:
“Unable to start a transaction in the given time,” originating from
`AuthService.createTokenPair` while creating the session and refresh token.

The stress run's p95 was 9.68 seconds and its maximum request time was 51.45
seconds. The spike run's p95 was 19.37 seconds. A separate spike variant peaked
at 350 VUs and had no failed requests in 815 requests, but still had 7.55
seconds average latency and 16.72 seconds p95. That single successful sample
does not establish 350 VUs as a safe or stable capacity limit; the latency
remained high, and the run was short.

Taken together, the login evidence indicates that the API can complete many
requests at these loads but is operating near a throughput ceiling with long
waits, and transaction-start failures appear in the 200- and 400-VU samples.
The logs identify the failing operation, but the available output does not
prove which resource is saturated. Investigate API/database CPU and memory,
PostgreSQL active connections, adapter pool settings, and transaction wait
behavior before deciding on a code or configuration change. Simply extending
the transaction wait can make callers wait longer without increasing
throughput.

## Reproducibility and next comparisons

- The [register load script](../k6_tests/auth_service/register/register_user_load.js)
  currently targets 50 VUs for 30 seconds; the reported 20- and 40-VU runs
  were separate runs with a changed target.
- The [register stress](../k6_tests/auth_service/register/register_user_stress.js)
  and [register spike](../k6_tests/auth_service/register/register_user_spike.js)
  scripts contain their recorded profiles.
- The [login load](../k6_tests/auth_service/login/login_user_load.js),
  [login stress](../k6_tests/auth_service/login/login_user_stress.js), and
  [login spike](../k6_tests/auth_service/login/login_user_spike.js) scripts
  contain the login profiles. The 350-VU spike is a separate variant and is
  not the current 400-VU spike configuration.
- Login selects accounts from the 1,000-user data set and may reuse them over
  repeated iterations; successful requests accumulate auth-session and
  refresh-token rows. Registration creates new users and also adds session
  data.
- For comparable future runs, record API/database CPU and memory limits,
  PostgreSQL connection count, k6 version and host, database state, run
  duration, and script revision. Repeat each profile and compare throughput,
  p95/max latency, and failure rates.

These short local tests are not a production-readiness assessment or a precise
maximum-capacity measurement. Results can differ with hardware, runtime
configuration, database state, test duration, and load-generator capacity.

## Raw registration results

### Load test — 20 VUs for 30s

```text
checks_total.......: 605     19.434238/s
checks_succeeded...: 100.00% 605 out of 605
checks_failed......: 0.00%   0 out of 605

http_req_duration..............: avg=515.33ms min=73.89ms med=485.45ms max=1.44s p(90)=863.99ms p(95)=1.11s
http_req_failed................: 0.00%  0 out of 605
http_reqs......................: 605    19.434238/s
iteration_duration.............: avg=515.86ms min=73.89ms med=485.99ms max=1.44s p(90)=864.19ms p(95)=1.11s
iterations.....................: 605    19.434238/s
vus............................: 3      min=1        max=19
vus_max........................: 20     min=20       max=20
data_received..................: 614 kB 20 kB/s
data_sent......................: 153 kB 4.9 kB/s
```

### Load test — 40 VUs for 30s

```text
checks_total.......: 635     19.969963/s
checks_succeeded...: 100.00% 635 out of 635
checks_failed......: 0.00%   0 out of 635

http_req_duration..............: avg=1s min=74.1ms med=956.4ms max=1.92s p(90)=1.78s p(95)=1.84s
http_req_failed................: 0.00%  0 out of 635
http_reqs......................: 635    19.969963/s
iteration_duration.............: avg=1s min=74.1ms med=956.4ms max=1.92s p(90)=1.78s p(95)=1.84s
iterations.....................: 635    19.969963/s
vus............................: 19     min=2        max=39
vus_max........................: 40     min=40       max=40
data_received..................: 645 kB 20 kB/s
data_sent......................: 161 kB 5.1 kB/s
```

### Load test — 50 VUs for 30s

```text
checks_total.......: 658     20.396614/s
checks_succeeded...: 100.00% 658 out of 658
checks_failed......: 0.00%   0 out of 658

http_req_duration..............: avg=1.22s min=74.18ms med=1.22s max=2.43s p(90)=2.14s p(95)=2.31s
http_req_failed................: 0.00%  0 out of 658
http_reqs......................: 658    20.396614/s
iteration_duration.............: avg=1.22s min=74.18ms med=1.22s max=2.43s p(90)=2.14s p(95)=2.31s
iterations.....................: 658    20.396614/s
vus............................: 8      min=2        max=49
vus_max........................: 50     min=50       max=50
data_received..................: 668 kB 21 kB/s
data_sent......................: 167 kB 5.2 kB/s
```

### Stress test — ramp to 200 VUs

```text
checks_total.......: 1724    20.325263/s
checks_succeeded...: 100.00% 1724 out of 1724
checks_failed......: 0.00%   0 out of 1724

http_req_duration..............: avg=4.26s min=73.43ms med=3.78s max=20.24s p(90)=8.92s p(95)=9.54s
http_req_failed................: 0.00%  0 out of 1724
http_reqs......................: 1724   20.325263/s
iteration_duration.............: avg=4.26s min=73.43ms med=3.78s max=20.24s p(90)=8.92s p(95)=9.54s
iterations.....................: 1724   20.325263/s
vus............................: 23     min=2         max=200
vus_max........................: 200    min=200       max=200
data_received..................: 1.8 MB 21 kB/s
data_sent......................: 442 kB 5.2 kB/s
```

### Spike test — peak 400 VUs

```text
checks_total.......: 876     19.514735/s
checks_succeeded...: 100.00% 876 out of 876
checks_failed......: 0.00%   0 out of 876

http_req_duration..............: avg=8.89s min=65.34ms med=7.94s max=29.7s p(90)=19.28s p(95)=19.32s
http_req_failed................: 0.00%  0 out of 876
http_reqs......................: 876    19.514735/s
iteration_duration.............: avg=8.89s min=69.74ms med=7.94s max=29.7s p(90)=19.28s p(95)=19.33s
iterations.....................: 876    19.514735/s
vus............................: 28     min=1        max=400
vus_max........................: 400    min=400      max=400
data_received..................: 891 kB 20 kB/s
data_sent......................: 224 kB 5.0 kB/s
```

## Raw login results

The excerpts below retain the key k6 metrics and the observed server error.

### Login load — 50 VUs for 30s

```text
checks_total.......: 636     19.735376/s
checks_succeeded...: 100.00% 636 out of 636
checks_failed......: 0.00%   0 out of 636
http_req_duration..: avg=1.26s min=76.41ms med=1.27s max=2.39s p(90)=2.22s p(95)=2.3s
http_req_failed....: 0.00%  0 out of 636
http_reqs..........: 636    19.735376/s
iterations.........: 636    19.735376/s
vus................: 8      min=2        max=49
vus_max............: 50     min=50       max=50
data_received......: 642 kB 20 kB/s
data_sent..........: 122 kB 3.8 kB/s
```

### Login stress — ramp to 200 VUs

```text
[
  { duration: '15s', target: 20 },
  { duration: '15s', target: 50 },
  { duration: '15s', target: 100 },
  { duration: '15s', target: 150 },
  { duration: '10s', target: 200 },
  { duration: '10s', target: 0 },
]
```

```text
checks_total.......: 1671   19.627805/s
checks_succeeded...: 99.64% 1665 out of 1671
checks_failed......: 0.35%  6 out of 1671
http_req_duration..: avg=4.4s min=75.49ms med=4.03s max=51.45s p(90)=9.09s p(95)=9.68s
http_req_failed....: 0.35%  6 out of 1671
http_reqs..........: 1671   19.627805/s
iterations.........: 1671   19.627805/s
vus................: 9      min=1         max=200
vus_max............: 200    min=200       max=200
data_received......: 1.7 MB 20 kB/s
data_sent..........: 319 kB 3.7 kB/s
```

Observed application error:

```text
PrismaClientKnownRequestError: Transaction API error:
Unable to start a transaction in the given time.
code: P2028
location: AuthService.createTokenPair
```

The k6 failure log listed six HTTP 500 responses. The complete stack trace is
available in the API container logs.

### Login spike — peak 400 VUs

```text
[
  { duration: '15s', target: 5 },
  { duration: '2s', target: 400 },
  { duration: '15s', target: 5 },
]
```

```text
checks_total.......: 878    19.46149/s
checks_succeeded...: 99.65% 875 out of 878
checks_failed......: 0.34%  3 out of 878
http_req_duration..: avg=8.85s min=68.85ms med=7.93s max=29.88s p(90)=19.32s p(95)=19.37s
http_req_failed....: 0.34%  3 out of 878
http_reqs..........: 878    19.46149/s
iterations.........: 878    19.46149/s
vus................: 12     min=1        max=400
vus_max............: 400    min=400      max=400
data_received......: 884 kB 20 kB/s
data_sent..........: 168 kB 3.7 kB/s
```

The API logs again reported Prisma `P2028` while starting the transaction in
`AuthService.createTokenPair`; k6 logged three HTTP 500 responses.

### Login spike variant — peak 350 VUs

This was a separate run with the same shape as the spike profile, but its peak
target was 350 VUs.

```text
[
  { duration: '15s', target: 5 },
  { duration: '2s', target: 350 },
  { duration: '15s', target: 5 },
]
```

```text
checks_total.......: 815     19.360373/s
checks_succeeded...: 100.00% 815 out of 815
checks_failed......: 0.00%   0 out of 815
http_req_duration..: avg=7.55s min=70.07ms med=6.62s max=26.81s p(90)=16.68s p(95)=16.72s
http_req_failed....: 0.00%  0 out of 815
http_reqs..........: 815    19.360373/s
iterations.........: 815    19.360373/s
vus................: 11     min=1        max=350
vus_max............: 350    min=350      max=350
data_received......: 822 kB 20 kB/s
data_sent..........: 156 kB 3.7 kB/s
```