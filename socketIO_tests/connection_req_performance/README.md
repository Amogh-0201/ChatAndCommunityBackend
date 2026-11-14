# Socket.IO connection-request rate performance

These profiles test how the local API handles **new connection requests per
second**. They do not slowly add a batch and wait for every handshake before
sending the next request.

The runner uses an open-loop 1-second dispatch window for each full round. It
checks the schedule every 8 ms and starts however many requests are due by that
time, without waiting for earlier handshakes to finish. Once the round's
attempts either connect or fail (up to the 10-second connection timeout), it
keeps successful sockets open for a 15-second observation. Earlier successful
sockets remain open during later rounds. Each attempt uses a distinct test
user and is tried only once.

| Profile | Requests per round                 | Total attempts | Holds                 |
| ------- | ---------------------------------- | -------------: | --------------------- |
| Load    | 1,000/s for 11 rounds              |         11,000 | 15 s after each round |
| Stress  | 1,000/s, 2,000/s, 4,000/s, 4,000/s |         11,000 | 15 s after each round |
| Spike   | 1,000/s, 1,000/s, 8,000/s, 1,000/s |         11,000 | 15 s after each round |

The rate is the **offered connection-attempt rate**, not the rate of successful
connections. The report records both the target rate and actual dispatch rate,
round-level success/failure percentages, established and failed handshake
latencies (minimum, maximum, average, median/p50, p90, p95, and p99),
connection and failure throughput, launch scheduling lag, active and peak
sockets, pending attempts, unexpected disconnects, and failure reasons. It
also records client memory, CPU time, and event-loop delay. Reports contain no
tokens and are saved under `results/`.

## Safety and preparation

- Run only against your own local development server and an isolated test
  database. `API_BASE_URL` rejects non-local hosts.
- Your previous 11,000-socket run used about 97% system RAM. Do not start a
  full 11,000-attempt profile unless the machine and Docker/server have
  substantial headroom. First try `MAX_ATTEMPTS=1000`, monitor server,
  database, and client resources, and stop if CPU or memory remains near 90%,
  the database becomes unhealthy, or the server becomes unstable.
- A client-process RSS guard stops at the lower of `MAX_CLIENT_RSS_MB` and half
  of system memory. This cannot observe the server's resource use. It is
  possible for the server to be resource-saturated while the client is not.
- Use the existing 11,000-entry local `scripts/.auth-token-pool.json`. Refresh
  sessions shortly before a run. The runner checks unique users/tokens and
  token/session expiry; tokens are never written into reports.
- Connection failures do not stop the run; their counts, rates, latencies, and
  reasons are recorded so the full profile can complete. The runner still stops
  after an unexpected disconnect or when the client-process RSS safety limit
  is reached. A failure can be caused by invalid credentials or infrastructure,
  not only capacity; inspect recorded failure reasons before interpreting the
  result.
- At the end of each run, the runner disconnects every client socket and waits
  up to 5 seconds for local disconnect confirmation, then allows
  one second for the server to observe closures. Cleanup results are included
  in the report; the runner exits unsuccessfully if any client socket remains
  connected or a disconnect cannot be confirmed. Those cleanup disconnects
  are not counted as unexpected.

## Run a profile

Refresh the local token pool before each profile because access tokens may
expire:

```powershell
node scripts/auth-token-pool.mjs refresh 11000
node socketIO_tests/connection_req_performance/load.mjs

node scripts/auth-token-pool.mjs refresh 11000
node socketIO_tests/connection_req_performance/stress.mjs

node scripts/auth-token-pool.mjs refresh 11000
node socketIO_tests/connection_req_performance/spike.mjs
```

For a lower-risk trial, cap total attempts at 1,000 and refresh the same
number of user sessions:

```powershell
$env:MAX_ATTEMPTS = "1000"
node scripts/auth-token-pool.mjs refresh 1000
node socketIO_tests/connection_req_performance/load.mjs
Remove-Item Env:MAX_ATTEMPTS
```

Optional environment settings are `API_BASE_URL` (local only),
`TOKEN_POOL_FILE`, `MAX_ATTEMPTS` (1-11,000),
`OBSERVATION_SECONDS` (1-300), and `MAX_CLIENT_RSS_MB` (128-2,048).
