# Phase 0 — Deployability (Vercel + Aiven)

- **Status:** Draft for review
- **Branch:** `feat/phase-0-deployability`
- **Date:** 2026-09-20

## 1. Goal

Make the current single-player Reversi app deployable to Vercel (Hobby) with
its MySQL database on Aiven, **without any feature change**. Phase 1
(identity) starts from this deployed baseline.

Done means:

1. The app runs locally exactly as before (`npm start`, Docker MySQL), with
   DB settings read from environment variables instead of source code.
2. The repository contains everything Vercel needs to build and serve the
   app: a serverless entry point, routing config, and a pinned Node version.
3. Database access goes through a connection pool that is safe for Vercel
   Fluid compute and bounded for Aiven's connection limit, and talks to
   Aiven over verified TLS.
4. Automated tests prove that pooled connections are always returned and
   never carry an open transaction to the next request.

## 2. Non-goals

- No new features, endpoints, tables, or UI changes.
- No changes to `src/domain/`, `src/application/`, `src/presentation/`, or
  `src/infrastructure/repository|query/`.
- No fixes to pre-existing bugs unrelated to deployment (see §10); they are
  reported, not fixed.
- No schema migration tooling (Phase 1). The Aiven schema is loaded once
  from `mysql/init.sql`.
- No rate limiting (Phase 1).
- Actually deploying, creating the Aiven service, and entering credentials
  are done by the repository owner.

## 3. Findings that shape this design

1. **Pooling breaks `conn.end()` in mysql2 2.3.3.** Every use case releases
   its connection with `await conn.end()`. On a pooled connection,
   mysql2 2.3.3's core `PoolConnection.end()` takes no callback
   (`node_modules/mysql2/lib/pool_connection.js:33`), while the promise
   wrapper waits for one — so `await conn.end()` would never resolve and
   every request would hang. `connectMySQL()` must therefore return a
   connection whose `end()` releases it back to the pool.
2. **Open transactions would leak between requests.** `StartNewGameUseCase`
   calls `beginTransaction()`; if it throws before `commit()`, the
   connection is released mid-transaction. With a pool, the next request
   would inherit that transaction (and its `beginTransaction()` would
   implicitly commit the partial write). The release path must roll back.
3. **All use cases already release in `finally`.** Verified in
   `findLastGamesUseCase.ts`, `findLatestGameTurnByTurnCountUseCase.ts`,
   `registerTurnUseCase.ts`, and `startNewGameUseCase.ts`: each acquires
   before `try` and calls `await conn.end()` in `finally`. No use case
   needs to change.
4. **`attachDatabasePool` requires mysql2 v3.** `@vercel/functions`
   recognises a mysql2 pool by `pool.config.idleTimeout`, an option added
   in mysql2 v3. Without it the helper does nothing, and idle connections
   survive function suspension, counting against Aiven's limit.
5. **Vercel serves static files from the CDN only if told where they are.**
   With the zero-config Express preset, `express.static()` is ignored and
   assets must live in `public/`. Using an `api/` function plus
   `outputDirectory: "static"` keeps `static/` in place and serves it from
   the CDN at zero function invocations.
6. **Node 16 is not available on Vercel** (supported: 20.x, 22.x, 24.x;
   24.x is the default).

## 4. Architecture

```
Browser
  ├─ GET /, /game/, *.js, *.css ──► Vercel CDN (outputDirectory: static/)
  └─ /api/* ──rewrite──► api/index.ts (one Vercel Function, Fluid compute)
                            └─ Express app from src/main.ts
                                 └─ use cases ─► connectMySQL()
                                                   └─ shared mysql2 v3 pool
                                                        (attachDatabasePool)
                                                        └─ TLS ─► Aiven MySQL
```

Locally, `src/main.ts` still calls `app.listen(3000)` and serves `static/`
through `express.static()`; the Docker MySQL is used without TLS.

## 5. Components

### 5.1 `src/infrastructure/dbConfig.ts` (new)

A pure function `loadDbConfig(env: NodeJS.ProcessEnv): mysql.PoolOptions`.

| Variable | Required | Meaning |
| --- | --- | --- |
| `DB_HOST` | yes | MySQL host |
| `DB_PORT` | no (default `3306`) | MySQL port (Aiven uses a non-default port) |
| `DB_USER` | yes | MySQL user |
| `DB_PASSWORD` | yes | MySQL password |
| `DB_NAME` | yes | Database name (`reversi`) |
| `DB_CA_CERT` | yes on Vercel | Aiven CA certificate, PEM text |
| `DB_POOL_MAX` | no (default `3`) | Max connections per function instance |

Rules:

- A missing required variable throws an error naming the variable (never
  its value). There are no fallback credentials in code.
- `DB_PORT` and `DB_POOL_MAX` must be positive integers, otherwise throw.
- If `DB_CA_CERT` is set, `ssl = { ca: DB_CA_CERT, rejectUnauthorized: true }`.
- If running on Vercel (`VERCEL` is set) and `DB_CA_CERT` is missing, throw:
  production must never connect without verified TLS.
- Pool options: `connectionLimit = DB_POOL_MAX`, `maxIdle = DB_POOL_MAX`,
  `idleTimeout = 5000` ms (Vercel's recommended short idle timeout),
  `waitForConnections = true`, `queueLimit = 0`.

### 5.2 `src/infrastructure/connection.ts` (modified)

- Holds one module-level pool, created **lazily** on the first
  `connectMySQL()` call, so a configuration error surfaces as a normal
  request error (500 + log) instead of crashing the module at import.
- Right after creation, the pool is registered with
  `attachDatabasePool(pool)` so idle connections are closed before the
  function instance is suspended. Outside Vercel this is a no-op.
- `connectMySQL()` keeps its name and return type (`mysql.Connection`), so
  no caller changes. It acquires a pooled connection and replaces its
  `end()` with a release routine:
  1. `ROLLBACK` — discards any transaction left open by an error path
     (a no-op when none is open).
  2. On success, `release()` the connection back to the pool.
  3. If the rollback fails (e.g. the connection died), `destroy()` it so the
     pool slot is freed and a fresh connection is created next time.
- Nothing that can throw runs between acquiring the connection and
  returning it, so the acquire step cannot orphan a connection.
- Exports `closePool()` for tests and graceful local shutdown.

### 5.3 `src/main.ts` (modified)

- `export` the Express `app`.
- Wrap `app.listen(...)` in `if (require.main === module)` so importing the
  app (Vercel, tests) does not open a port. Local `npm start` behaves as
  before.

### 5.4 `api/index.ts` (new)

Imports `app` from `../src/main` and `export default app`. This is the only
Vercel Function.

### 5.5 `vercel.json` (new)

```json
{
  "framework": null,
  "outputDirectory": "static",
  "rewrites": [{ "source": "/api/(.*)", "destination": "/api" }]
}
```

`framework: null` stops Vercel from auto-detecting the zero-config Express
preset (which expects an entry file such as `src/index.ts` and serves
static files only from `public/`), so the project is built as "Other":
`static/` goes to the CDN and `api/index.ts` becomes the function.

### 5.6 `tsconfig.json` (new)

Today there is none, so `ts-node` falls back to built-in defaults. An
explicit config makes local runs, Vitest, and Vercel's compiler agree:
`target ES2022`, `module commonjs`, `esModuleInterop`, `strict`,
`skipLibCheck`, `noEmit`, including `src`, `api`, and `test`.

### 5.7 Local development

- `.env` (gitignored) holds local settings; `.env.example` (committed)
  documents every variable with the non-secret Docker values that already
  appear in `docker-compose.yaml`.
- `nodemon.json` `exec` becomes
  `node --env-file=.env -r ts-node/register src/main.ts`, using Node's
  built-in env-file loader (no `dotenv` dependency).

### 5.8 Runtime version

- `package.json` `engines.node = "24.x"` (Vercel reads this).
- `.tool-versions`: `nodejs 24.x.y` (latest 24 patch installed via asdf).

### 5.9 `docs/deployment.md` (new)

Operator guide: create the Aiven MySQL service; load the schema once
(`mysql ... < mysql/init.sql` over TLS); Vercel project settings
(framework "Other", root directory, Node 24); the environment variable
list; pool sizing (see §6); region placement; how to verify the
deployment.

**Region placement** gets its own section. Vercel Functions run in `iad1`
(Washington, D.C.) by default, so the Aiven service must be created in the
same region (e.g. AWS `us-east-1`), or the function region must be changed
to match the database. Every query — plus the `ROLLBACK` issued by each
`end()` — pays the function-to-database round trip, and Phase 2 polls every
second, so a cross-continent database would make every request slow.

## 6. Connection budget

Each Fluid compute instance holds at most `DB_POOL_MAX` connections, and
`attachDatabasePool` closes them after 5 s of idleness before suspension.
The worst-case concurrent connections are therefore
`instances × DB_POOL_MAX`. The operator checks Aiven's limit with
`SHOW VARIABLES LIKE 'max_connections'` and keeps
`expected_peak_instances × DB_POOL_MAX` below it with headroom for admin
sessions. The default of 3 is a starting point, tunable without a code
change. Vercel advises against a pool size of 1 in production because it
serialises concurrent requests on an instance without reducing the total.

## 7. Error handling

- Configuration errors: thrown from `loadDbConfig` on first DB use, caught
  by the existing Express error handler → 500 "Unexpected Error occured".
  The message names the missing variable, never a secret.
- Pool exhaustion: requests wait for a free connection (`queueLimit 0`).
  Leaks are prevented by §5.2 and verified by §8.2.
- Broken connection on release: destroyed, not returned (§5.2).

## 8. Testing

Vitest is added. Two projects:

- `npm test` — unit tests only; no database needed.
- `npm run test:integration` — needs Docker MySQL (`docker-compose up -d`).

### 8.1 Unit tests (`test/unit/dbConfig.test.ts`)

- Builds pool options from a full env; defaults for port and pool size.
- Throws naming each missing required variable; error text never contains
  the password.
- Rejects non-integer / non-positive `DB_PORT` and `DB_POOL_MAX`.
- TLS enabled with `rejectUnauthorized: true` when `DB_CA_CERT` is set.
- Throws when `VERCEL` is set and `DB_CA_CERT` is missing.

### 8.2 Integration tests (`test/integration/connection.test.ts`)

Run against a dedicated `reversi_test` database with `DB_POOL_MAX=1`, so a
single leaked connection makes the next acquire wait forever. A 5 s test
timeout turns such a hang into a failure.

Setup (Vitest `globalSetup`): connect as the Docker root user, drop and
recreate `reversi_test`, grant it to the app user, and load the schema from
`mysql/init.sql` with its `drop database` / `create database` / `use`
statements skipped, so `init.sql` stays the single source of truth and the
developer's `reversi` data is never touched.

Cases:

1. **Connections are returned.** Call the real use cases in sequence with
   real repositories: `StartNewGameUseCase` ×3, then
   `FindLastGameUseCase`, `FindLatestGameTurnByTurnCountUseCase`, and
   `RegisterTurnUseCase` (a legal opening move), then
   `FindLatestGameTurnByTurnCountUseCase` again. Every call must complete.
2. **A failed transaction is rolled back and not inherited.** Run
   `StartNewGameUseCase` with the real `GameMYSQLRepository` and a
   `TurnRepository` stub whose `save()` (called after `beginTransaction()`
   and the game insert):
   - records `CONNECTION_ID()` and the inserted game id,
   - asserts the connection is inside a transaction
     (`information_schema.innodb_trx` has a row for `CONNECTION_ID()`) —
     this proves the detector works,
   - throws.

   The test then asserts the use case rejected, acquires the next
   connection via `connectMySQL()`, and verifies: same `CONNECTION_ID()`
   (it really is the reused connection), no `innodb_trx` row for it, and no
   `games` row with the recorded id.
3. **A connection that dies is not returned to the pool.** Kill the
   connection's own session from a second (non-pooled) connection before
   `end()`; `end()` must resolve, and the next `connectMySQL()` must succeed
   with a different `CONNECTION_ID()`.

### 8.3 Manual verification

- `npx tsc --noEmit` passes.
- Local: `npm start`, play a full game through the UI, view history.
- `vercel build` (after `vercel link`, run by the owner) produces the
  function and static output; the owner performs the real deployment.

## 9. Changes to existing code

| File | Change | Why it cannot be avoided | Approval |
| --- | --- | --- | --- |
| `src/infrastructure/connection.ts` | Replace the body: lazy shared pool from `loadDbConfig`, `attachDatabasePool`, `connectMySQL()` returns a pooled connection whose `end()` rolls back then releases/destroys; add `closePool()` | Removes hard-coded credentials; pooling is required for Aiven's connection limit; `end()` must release (§3.1) and roll back (§3.2) | Approved |
| `src/main.ts` | `export` the app; wrap `app.listen` in `if (require.main === module)` | Vercel imports the app rather than running a server | Approved |
| `package.json` | `engines.node: "24.x"`; `mysql2` → `^3`; add `@vercel/functions`; add dev deps `vitest` and (if needed) `@types/node`; `test` and `test:integration` scripts; `typescript` → 5.x **only if** `tsc` cannot type-check the new dependencies' typings | Runtime version, pooling support, test harness | Approved |
| `package-lock.json` | Regenerated by `npm install` | Follows `package.json` | Follows the above |
| `.tool-versions` | `nodejs 16.17.1` → Node 24 | Local runtime must match Vercel | Approved |
| `nodemon.json` | `exec` loads `.env` via `--env-file` | Local dev needs DB settings from the environment | Approved |
| `.gitignore` | Add `.env` | Keep local secrets out of git | Approved |

Nothing in `src/domain/` changes. No other existing file changes; if one
turns out to be necessary, work stops for approval.

New files: `api/index.ts`, `vercel.json`, `tsconfig.json`,
`src/infrastructure/dbConfig.ts`, `vitest.config.ts`, `test/unit/*`,
`test/integration/*`, `.env.example`, `docs/deployment.md`.

## 10. Pre-existing issues (reported, not fixed in Phase 0)

- `RegisterTurnUseCase` calls `commit()` without `beginTransaction()`, so a
  move's turn, squares, move, and result rows are auto-committed one by one
  rather than atomically.
- `Point` accepts non-integers (e.g. `x = 1.5`); `turnRouter` passes
  `parseInt` output without a `NaN` check. (Phase 1 adds server-side
  validation in new code.)
- `hello.ts` at the repository root appears unused.
- `mysql2` uses the process time zone for `DATETIME` values; Vercel runs in
  UTC while local development may not, so stored times differ by
  environment. **This must be resolved at the start of Phase 2**: the
  derived clock depends on `turn_started_at` being interpreted identically
  in every environment.

## 11. Risks

- **TypeScript 4.8 vs new typings.** mysql2 v3 or `@vercel/functions` may
  need a newer TypeScript; if `tsc --noEmit` fails for that reason,
  TypeScript is bumped to 5.x (already covered by the `package.json` row).
- **`ts-node` on Node 24.** Node 24 strips TypeScript types natively; if
  that conflicts with `ts-node/register`, the `nodemon.json` command adds
  `--no-experimental-strip-types`.
- **Vercel routing assumptions** (`framework: null`, `outputDirectory`,
  rewrite to `/api`) are verified by `vercel build` and the first deploy,
  both run by the owner; any correction stays within `vercel.json`.
