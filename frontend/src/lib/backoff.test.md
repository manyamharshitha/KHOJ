# Backoff behaviour

Reference for `src/lib/backoff.js`. Kept as a table rather than a test file
because the frontend has no test runner configured.

## `nextInterval(failures, base = 5000)`

| failures | interval | meaning |
| --- | --- | --- |
| 0 | 5 000 ms | healthy — the normal rate |
| 1 | 10 000 ms | one failure, back off |
| 2 | 20 000 ms | |
| 3 | 40 000 ms | |
| 4 | 60 000 ms | capped at `max` |
| 5 | `null` | circuit open — stop polling entirely |

At `base = 20000` (the notification bell) the cap is reached at two failures.

A success sets `failures` back to 0, so the interval snaps straight back to
`base` rather than walking down.

## `isServerUnwell(err)`

Backs off:

- `status === 0` — a network failure, which is what a CORS-masked 503 looks
  like from `fetch`
- `status === 429` — rate limited
- `500`–`599` — the platform's own errors

Does not back off:

- `401`, `403`, `404`, `409`, `422` — a healthy server disagreeing with the
  request. Waiting longer will not change the answer.

## Why not a fixed interval with a retry

A fixed `setInterval` fires at the same rate whether the backend is healthy or
being OOM-killed, and a dying instance is precisely the one that must not be
polled every five seconds while it restarts. Retrying inside the client library
made this worse rather than better: a blocked request and a rate-limited one
both surface as `status === 0`, so every failure became three requests, which
earned a 429, which produced more failures.
