# V1 Performance Test Results

## Summary

Registration requests completed successfully in all reported runs: k6 recorded
zero failed HTTP requests and every registration check received HTTP 201.
However, throughput stayed close to 20 requests per second as virtual-user (VU)
concurrency increased, while response times rose substantially. The higher
concurrency runs therefore demonstrate that the API continued returning
successful responses during these tests, but not that it handled that load with
acceptable latency or that it can sustain the same performance in production.

## Test scope and interpretation

- **Endpoint:** `POST /auth/register`
- **Operation:** create a user and return an authentication response
- **Load generator:** k6
- **Environment:** local database/API test; detailed machine and container
  resource specifications were not recorded
- **Thresholds:** disabled for these exploratory runs. The HTTP 201 check was
  still active; removing k6 thresholds means these results were collected
  without latency/failure pass criteria.

Registration is a write-heavy operation that also performs password hashing.
Its results should not be treated as a general capacity measurement for every
API endpoint. VUs are concurrent clients, not requests per second: as response
time increases, each VU completes fewer iterations. The observed RPS and
latencies should be considered together.

## Results

| Profile / run | Configured load | Requests | Throughput | Failed HTTP requests | HTTP 201 checks | Avg latency | Median | p90 | p95 | Max |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Load | 20 VUs, 30s | 605 | 19.43 req/s | 0 / 605 (0%) | 605 / 605 (100%) | 515.33 ms | 485.45 ms | 863.99 ms | 1.11 s | 1.44 s |
| Load | 40 VUs, 30s | 635 | 19.97 req/s | 0 / 635 (0%) | 635 / 635 (100%) | 1.00 s | 956.4 ms | 1.78 s | 1.84 s | 1.92 s |
| Load | 50 VUs, 30s | 658 | 20.40 req/s | 0 / 658 (0%) | 658 / 658 (100%) | 1.22 s | 1.22 s | 2.14 s | 2.31 s | 2.43 s |
| Stress | Staged ramp to 200 VUs; stages listed below | 1,724 | 20.33 req/s | 0 / 1,724 (0%) | 1,724 / 1,724 (100%) | 4.26 s | 3.78 s | 8.92 s | 9.54 s | 20.24 s |
| Spike | Brief spike to 400 VUs; stages listed below | 876 | 19.51 req/s | 0 / 876 (0%) | 876 / 876 (100%) | 8.89 s | 7.94 s | 19.28 s | 19.32 s | 29.7 s |

### Stress stages

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

### Spike stages

```js
[
  { duration: '15s', target: 5 },
  { duration: '2s', target: 400 },
  { duration: '15s', target: 5 },
]
```

The reported stress run completed 1,724 iterations in about 1m25s. The spike
run completed 876 iterations; its scenario stages total 32 seconds. k6's
reported maximum VUs were 200 and 400 respectively.

## Assessment

The encouraging result is that every request in these samples completed with
HTTP 201; there were no observed HTTP failures. The concerning result is that
throughput remained around 19.4–20.4 registrations per second across all runs,
even as concurrency rose. At the same time, p95 latency increased from 1.11s
at 20 VUs to 2.31s at 50 VUs, 9.54s in the stress run, and 19.32s in the spike
run. The spike's slowest request took 29.7s.

This pattern is consistent with a bottleneck or queueing under higher
concurrency: the service kept responding, but additional clients mostly waited
longer rather than increasing completed work per second. It is not possible to
identify the limiting component from these results alone. Password-hash CPU
cost, application CPU, database connection capacity, database performance,
container limits, and the load generator are all worth measuring before
choosing an optimization.

So, **the server handled the tested requests in the sense that all returned
successfully, but the high-concurrency results do not show that it handled the
load efficiently**. Whether these latencies are acceptable depends on the
intended use; multi-second to tens-of-seconds registration responses would
usually be poor user experience.

These are short exploratory runs, not a proven maximum-capacity or
production-readiness result. A zero failure count in a finite test does not
guarantee that failures will not occur at longer duration, with more traffic,
or under different conditions.

## Reproducibility notes

- The load results include separate 20-, 40-, and 50-VU runs. The checked-in
  [load script](../k6_tests/auth_service/register/register_user_load.js)
  currently targets 50 VUs in a 30-second stage. To reproduce the lower-load
  runs, change that stage's `target` and run each value separately.
- The [stress script](../k6_tests/auth_service/register/register_user_stress.js)
  and [spike script](../k6_tests/auth_service/register/register_user_spike.js)
  contain the stages recorded above.
- The [shared test helper](../k6_tests/auth_service/register/register_common.js)
  creates unique accounts. These tests add rows to the test database; use only
  an isolated database and account for accumulated test data when repeating
  runs.
- For meaningful comparisons, record the API and database resource limits,
  machine/container specifications, k6 version and machine, exact script
  revision, database state, and run ID. Repeat runs under the same conditions
  and compare latency percentiles and throughput, not only the VU count or
  success percentage.

## Raw k6 output

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
