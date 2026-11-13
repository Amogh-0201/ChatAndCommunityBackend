# Concurrent Socket.IO connection limit

This test opens authenticated, WebSocket-only Socket.IO connections and sends
no application events. It retains successful connections between stages,
starts at 50 connections, adds 50 per stage, observes each stage for 15 seconds,
and writes per-stage counts,
connection latencies, disconnects, and failure reasons to a JSON report.

## Before running

- Run only against your own local development server and an isolated test
  database. The runner rejects non-local `API_BASE_URL` values.
- Start the server and database first. Watch their CPU, memory, database
  connections, and logs in separate windows. Stop if CPU or memory stays near
  90%, the database becomes unhealthy, or the server starts restarting. Each
  socket also runs the gateway's JWT/session checks and presence setup, so this
  test exercises the database as well as Socket.IO.
- The default and hard maximum are 500 simultaneous connections. The run stops
  at the first unhealthy stage; do not continue if your machine or server is
  resource-saturated.
- Use a separate test account for every connection. The runner reads the
  existing ignored `scripts/.auth-token-pool.json` and requires unique users,
  unique access tokens, and enough remaining token/session lifetime. Never
  paste tokens into source files, commits, chat, or reports.
- Keep the test machine cool and powered, close unnecessary heavy applications,
  and avoid running this while relying on the machine for other work. `Ctrl+C`
  stops the run and closes all client sockets. A client-process memory guard
  also stops the run at the lower of its configured limit and half of detected
  system memory.
- A stopped or interrupted run is still saved as a partial report. A
  connection failure can be caused by invalid/expired test credentials or
  infrastructure—not just capacity—so inspect its recorded reason before
  drawing a conclusion.

## Run

Refresh the first 500 test-user sessions shortly before starting. The default
run proceeds through 50, 100, 150, and subsequent 50-connection stages up to
500:

```powershell
node scripts/auth-token-pool.mjs refresh 500
node socketIO_tests/concurrent_connection_limit/run.mjs
```

The test defaults to `http://localhost:3000`. To stop at 50 connections or
choose a different local port:

```powershell
$env:MAX_CONNECTIONS = "50"
$env:API_BASE_URL = "http://localhost:3001"
node scripts/auth-token-pool.mjs refresh 50
node socketIO_tests/concurrent_connection_limit/run.mjs
Remove-Item Env:MAX_CONNECTIONS
Remove-Item Env:API_BASE_URL
```

To cap a run at an intermediate stage, choose a multiple of 50 and refresh that
many test users:

```powershell
$env:MAX_CONNECTIONS = "200"
node scripts/auth-token-pool.mjs refresh 200
node socketIO_tests/concurrent_connection_limit/run.mjs
Remove-Item Env:MAX_CONNECTIONS
```

Optional controls are `OBSERVATION_SECONDS` (15–300), `CONNECT_BATCH_SIZE`
(1–10), `CONNECT_BATCH_DELAY_MS` (250–5000), `MAX_CLIENT_RSS_MB` (128–2048),
and `TOKEN_POOL_FILE`. The default opens at most ten new sockets at once and
waits 250 milliseconds between batches. Results are saved under this folder's
`results` directory and contain no authentication tokens.

## Interpreting a stage

The report separates successful handshakes from connections still active
after observation and records establishment latency (min, max, average,
median/p50, p90, p95, and p99). A stage with any unexpected disconnect stops
the run for investigation. The run also stops when at least two attempts fail
and their failure rate exceeds 1%; a single failure is recorded and flagged,
but is not by itself treated as a capacity boundary.

The highest stable number is the highest stage that remains fully connected
through observation in repeated runs. Keep the first unhealthy stage as the
other side of the measured boundary. This is a limit for the tested
server/database/client setup, not an absolute Socket.IO limit.
