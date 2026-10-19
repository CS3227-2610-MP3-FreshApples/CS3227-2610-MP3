# S-04 integration validation

## Scope

The human authorized a disposable local PostgreSQL database and requested
Increment 3 and Increment 4 testing before the next iteration.

## Environment

- Reused the existing `mp3-postgres` PostgreSQL 17 container, published only
  on `127.0.0.1:5432`.
- Created the ignored root `.env` from the `.env.example` contract with local
  synthetic values and `TEST_DATABASE_URL` pointing to the loopback database.
- No credentials or production data were used.

## Results

- `npm run test:integration`: 8 files and 282 tests passed.
- `npm run test:unit`: 24 files and 355 tests passed.
- Focused auth/status tests: 14 passed.
- Type-check and lint passed.
- `npm run build` still failed because Turbopack could not create a worker or
  bind its process port (`Operation not permitted`) while processing the CSS
  endpoint, even with authorized execution.

Increment 3 and Increment 4 evidence manifests were updated with the actual
integration result. The build limitation remains unresolved, so neither
increment is marked complete by the grader.
