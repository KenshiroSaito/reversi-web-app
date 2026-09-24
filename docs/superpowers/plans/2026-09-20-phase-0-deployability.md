# Phase 0 — Deployability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing single-player Reversi app deployable to Vercel with MySQL on Aiven, with no feature change.

**Architecture:** One Vercel Function (`api/index.ts`) serves the existing Express app for `/api/*`; `static/` is served by Vercel's CDN. Database access goes through one lazily created mysql2 v3 pool per function instance, configured from environment variables, registered with `@vercel/functions`' `attachDatabasePool`, and wrapped so that the existing `await conn.end()` calls roll back and release the connection.

**Tech Stack:** Node.js 24, TypeScript 4.8, Express 4, mysql2 3, `@vercel/functions` 3, Vitest 5, Docker MySQL 8.0 (local), Aiven MySQL (production).

**Spec:** `docs/superpowers/specs/2026-09-20-phase-0-deployability-design.md`

## Global Constraints

- Branch: `feat/phase-0-deployability`. Never commit to or merge into `main`. Never push.
- Every commit leaves `npx tsc --noEmit` and `npm test` passing (and `npm run test:integration` once it exists).
- Only these existing files may change: `src/infrastructure/connection.ts`, `src/main.ts`, `package.json`, `package-lock.json`, `.tool-versions`, `nodemon.json`, `.gitignore`. Anything else → stop and ask.
- Nothing under `src/domain/` changes.
- In existing files, change only the lines required. No reformatting, renaming, import reordering, or drive-by fixes.
- No credentials in code. Local Docker values may appear only in `.env.example` (they already appear in `docker-compose.yaml`).
- All SQL uses placeholders.
- Node version: `24.x` in `engines`, `nodejs 24.21.0` in `.tool-versions`.
- English for code comments, commit messages, and docs.
- Pre-existing bugs found along the way are reported at the end, not fixed.

## Verified facts this plan relies on

Checked on a throwaway copy of the repo before writing this plan:

- Node 24.21.0 + TypeScript 4.8.3 + mysql2 3.24.4 + `@vercel/functions` 3.9.8 + Vitest 5.0.1: `tsc --noEmit` passes on the existing code with the `tsconfig.json` below; `node --env-file=.env -r ts-node/register src/main.ts` runs the app.
- `attachDatabasePool(promisePool)` throws `Unsupported database pool type`; the core pool (`promisePool.pool`) is recognised but its idle timeout is read from a field mysql2 does not set, falling back to 60 s. Passing `{ on, config: { idleTimeout } }` (duck-typed, as the helper's typings allow) works.
- mysql2 closes a free connection once it has been idle longer than `idleTimeout`, checking once per second.
- The `reversi` Docker user cannot read `information_schema.innodb_trx`, and that table is cached (it reported 0 rows mid-transaction). `performance_schema.events_transactions_current` joined to `performance_schema.threads`, queried as root, reports transaction state exactly.
- After `KILL <id>`, `rollback()` on that connection rejects; `destroy()` frees the pool slot and the next `getConnection()` opens a new connection.

## File Structure

| Path | Status | Responsibility |
| --- | --- | --- |
| `.tool-versions` | modify | Local Node 24 |
| `package.json` / `package-lock.json` | modify | `engines`, deps, test scripts |
| `tsconfig.json` | create | One compiler config for ts-node, tsc, and Vercel |
| `vitest.config.ts` | create | `unit` and `integration` test projects |
| `src/infrastructure/dbConfig.ts` | create | Pure env → `mysql.PoolOptions` |
| `src/infrastructure/connection.ts` | modify | Lazy shared pool; `connectMySQL()` with rollback-and-release `end()`; `closePool()` |
| `src/main.ts` | modify | Export `app`; listen only when run directly |
| `api/index.ts` | create | Vercel Function entry point |
| `vercel.json` | create | Framework "Other", CDN output dir, `/api/*` rewrite |
| `.env.example` | create | Documents env vars with local Docker values |
| `.gitignore` | modify | Ignore `.env` |
| `nodemon.json` | modify | Load `.env` for `npm start` |
| `test/unit/dbConfig.test.ts` | create | Unit tests for `loadDbConfig` |
| `test/integration/globalSetup.ts` | create | Rebuild `reversi_test` from `mysql/init.sql` |
| `test/integration/helpers.ts` | create | Admin connection, connection id, transaction probe |
| `test/integration/connection.test.ts` | create | Pool leak / rollback / dead-connection tests |
| `test/integration/vercelEntry.test.ts` | create | `api/index.ts` serves the API |
| `docs/deployment.md` | create | Operator guide |

---

### Task 1: Node 24 runtime and explicit TypeScript config

**Files:**
- Modify: `.tool-versions`
- Modify: `package.json` (add `engines`)
- Modify: `package-lock.json` (regenerated)
- Create: `tsconfig.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `npx tsc --noEmit` as the type-check command used by every later task; Node 24 as the runtime.

- [ ] **Step 1: Pin Node 24 locally**

Replace the single line of `.tool-versions`:

```
nodejs 24.21.0
```

Run: `node -v`
Expected: `v24.21.0` (Node 24.21.0 is already installed via asdf; if not, `asdf install nodejs 24.21.0`).

- [ ] **Step 2: Declare the Node version for Vercel**

In `package.json`, add an `engines` field after `"license": "ISC",`:

```json
  "license": "ISC",
  "engines": {
    "node": "24.x"
  },
```

- [ ] **Step 3: Add `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "api", "test"]
}
```

- [ ] **Step 4: Install dependencies under Node 24 and add Node typings**

Run: `npm install && npm install -D @types/node@^24`
Expected: completes without errors; `package-lock.json` updated.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no output, exit code 0.

- [ ] **Step 6: Smoke-test the app still runs (old hard-coded connection)**

Run (Docker MySQL must be up: `docker-compose up -d`):

```bash
npm start &
sleep 6
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:3000/api/games
curl -s -o /dev/null -w "%{http_code}\n" localhost:3000/api/games
kill %1
```

Expected: `201` then `200`.

- [ ] **Step 7: Commit**

```bash
git add .tool-versions package.json package-lock.json tsconfig.json
git commit -m "Pin Node 24 and add an explicit tsconfig"
```

---

### Task 2: Environment-based database configuration

**Files:**
- Create: `vitest.config.ts`
- Create: `src/infrastructure/dbConfig.ts`
- Test: `test/unit/dbConfig.test.ts`
- Modify: `package.json` (`test` script, `vitest` dev dependency)

**Interfaces:**
- Consumes: Task 1's `tsconfig.json`.
- Produces:
  - `export const IDLE_TIMEOUT_MS = 5000;`
  - `export function loadDbConfig(env: NodeJS.ProcessEnv): mysql.PoolOptions` (`import mysql from "mysql2/promise"`)
  - `npm test` runs the Vitest `unit` project.

- [ ] **Step 1: Install Vitest and add the test script**

Run: `npm install -D vitest@^5.0.1`

In `package.json`, replace the `test` script:

```json
    "test": "vitest run --project unit"
```

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["test/unit/**/*.test.ts"],
        },
      },
    ],
  },
});
```

In `tsconfig.json`, add the config file to `include` so it is type-checked too:

```json
  "include": ["src", "api", "test", "vitest.config.ts"]
```

- [ ] **Step 3: Write the failing tests**

Create `test/unit/dbConfig.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { IDLE_TIMEOUT_MS, loadDbConfig } from "../../src/infrastructure/dbConfig";

const baseEnv = {
  DB_HOST: "db.example.com",
  DB_USER: "app",
  DB_PASSWORD: "s3cret-value",
  DB_NAME: "reversi",
};

describe("loadDbConfig", () => {
  it("builds pool options from the environment with defaults", () => {
    expect(loadDbConfig(baseEnv)).toEqual({
      host: "db.example.com",
      port: 3306,
      user: "app",
      password: "s3cret-value",
      database: "reversi",
      ssl: undefined,
      connectionLimit: 3,
      maxIdle: 3,
      idleTimeout: IDLE_TIMEOUT_MS,
      waitForConnections: true,
      queueLimit: 0,
    });
  });

  it("uses DB_PORT and DB_POOL_MAX when set", () => {
    const options = loadDbConfig({ ...baseEnv, DB_PORT: "12345", DB_POOL_MAX: "5" });

    expect(options.port).toBe(12345);
    expect(options.connectionLimit).toBe(5);
    expect(options.maxIdle).toBe(5);
  });

  it.each(["DB_HOST", "DB_USER", "DB_PASSWORD", "DB_NAME"])(
    "throws naming %s when it is missing",
    (name) => {
      const env: NodeJS.ProcessEnv = { ...baseEnv };
      delete env[name];

      expect(() => loadDbConfig(env)).toThrow(name);
    },
  );

  it("treats an empty required variable as missing", () => {
    expect(() => loadDbConfig({ ...baseEnv, DB_HOST: "" })).toThrow("DB_HOST");
  });

  it("never includes the password in error messages", () => {
    let message = "";
    try {
      loadDbConfig({ ...baseEnv, DB_NAME: undefined });
    } catch (e) {
      message = (e as Error).message;
    }

    expect(message).not.toBe("");
    expect(message).not.toContain("s3cret-value");
  });

  it.each([
    ["DB_PORT", "abc"],
    ["DB_PORT", "0"],
    ["DB_PORT", "3306.5"],
    ["DB_POOL_MAX", "-1"],
    ["DB_POOL_MAX", "two"],
  ])("rejects %s=%s", (name, value) => {
    expect(() => loadDbConfig({ ...baseEnv, [name]: value })).toThrow(name);
  });

  it("enables verified TLS when DB_CA_CERT is set", () => {
    const ca = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----";

    expect(loadDbConfig({ ...baseEnv, DB_CA_CERT: ca }).ssl).toEqual({
      ca,
      rejectUnauthorized: true,
    });
  });

  it("requires DB_CA_CERT when running on Vercel", () => {
    expect(() => loadDbConfig({ ...baseEnv, VERCEL: "1" })).toThrow("DB_CA_CERT");
  });

  it("accepts Vercel with DB_CA_CERT set", () => {
    const options = loadDbConfig({ ...baseEnv, VERCEL: "1", DB_CA_CERT: "pem" });

    expect(options.ssl).toEqual({ ca: "pem", rejectUnauthorized: true });
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `../../src/infrastructure/dbConfig`.

- [ ] **Step 5: Implement `src/infrastructure/dbConfig.ts`**

```ts
import mysql from "mysql2/promise";

// Idle pooled connections are closed after this long, so a function instance
// that goes quiet stops holding connections against the database's limit.
export const IDLE_TIMEOUT_MS = 5000;

const DEFAULT_PORT = 3306;
const DEFAULT_POOL_MAX = 3;

/**
 * Builds mysql2 pool options from environment variables.
 * There are deliberately no fallback credentials: a missing setting is an error.
 */
export function loadDbConfig(env: NodeJS.ProcessEnv): mysql.PoolOptions {
  const host = requireVar(env, "DB_HOST");
  const user = requireVar(env, "DB_USER");
  const password = requireVar(env, "DB_PASSWORD");
  const database = requireVar(env, "DB_NAME");
  const port = positiveInt(env, "DB_PORT", DEFAULT_PORT);
  const poolMax = positiveInt(env, "DB_POOL_MAX", DEFAULT_POOL_MAX);

  const caCert = env.DB_CA_CERT || undefined;
  if (env.VERCEL && !caCert) {
    throw new Error(
      "DB_CA_CERT is required when running on Vercel: the database connection must use verified TLS",
    );
  }

  return {
    host,
    port,
    user,
    password,
    database,
    ssl: caCert ? { ca: caCert, rejectUnauthorized: true } : undefined,
    connectionLimit: poolMax,
    maxIdle: poolMax,
    idleTimeout: IDLE_TIMEOUT_MS,
    waitForConnections: true,
    queueLimit: 0,
  };
}

function requireVar(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (!raw) {
    return fallback;
  }
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw new Error(`${name} must be a positive integer`);
  }
  return Number(raw);
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, all `loadDbConfig` tests green.

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: exit code 0.

- [ ] **Step 8: Commit**

```bash
git add vitest.config.ts src/infrastructure/dbConfig.ts test/unit/dbConfig.test.ts package.json package-lock.json
git commit -m "Add environment-based database configuration with unit tests"
```

---

### Task 3: Pooled connections that are always returned clean

**Files:**
- Modify: `package.json` / `package-lock.json` (mysql2 ^3, `@vercel/functions`, `test:integration` script)
- Modify: `vitest.config.ts` (add `integration` project, load `.env`)
- Modify: `src/infrastructure/connection.ts` (whole body)
- Modify: `.gitignore`, `nodemon.json`
- Create: `.env.example`, local `.env` (not committed)
- Create: `test/integration/globalSetup.ts`, `test/integration/helpers.ts`
- Test: `test/integration/connection.test.ts`

**Interfaces:**
- Consumes: `loadDbConfig`, `IDLE_TIMEOUT_MS` from Task 2.
- Produces:
  - `export async function connectMySQL(): Promise<mysql.Connection>` (same name and call pattern as today)
  - `export async function closePool(): Promise<void>`
  - Test helpers: `adminConnection(): Promise<mysql.Connection>`, `connectionIdOf(conn: mysql.Connection): Promise<number>`, `activeTransactionCount(admin: mysql.Connection, connectionId: number): Promise<number>`
  - `npm run test:integration` runs the Vitest `integration` project against `reversi_test` with `DB_POOL_MAX=1`.

- [ ] **Step 1: Upgrade mysql2 and add `@vercel/functions`**

Run: `npm install mysql2@^3.24.4 @vercel/functions@^3.9.8`

Run: `npx tsc --noEmit && npm test`
Expected: both pass (existing code is compatible with mysql2 v3).

Commit now, so the upgrade is its own green commit:

```bash
git add package.json package-lock.json
git commit -m "Upgrade mysql2 to v3 and add @vercel/functions"
```

- [ ] **Step 2: Local environment files**

Create `.env.example`:

```bash
# Local development settings for the Docker MySQL in docker-compose.yaml.
# Copy this file to .env (which is gitignored). Production values are set in
# the Vercel project settings; see docs/deployment.md.
DB_HOST=localhost
DB_PORT=3306
DB_USER=reversi
DB_PASSWORD=password
DB_NAME=reversi

# Maximum connections per server instance (default 3).
# DB_POOL_MAX=3

# PEM text of the database's CA certificate. Required on Vercel; leave unset
# locally (the Docker MySQL is used without TLS).
# DB_CA_CERT=

# Integration tests only: root password of the Docker MySQL, used to create
# the reversi_test database.
DB_ROOT_PASSWORD=rootpassword
```

Run: `cp .env.example .env`

Append to `.gitignore` (keep existing lines untouched):

```
.env
```

Run: `git status --short .env`
Expected: no output (`.env` is ignored).

Replace the `exec` line in `nodemon.json`:

```json
  "exec": "node --env-file=.env -r ts-node/register src/main.ts"
```

- [ ] **Step 3: Add the integration test project**

Replace `vitest.config.ts` with:

```ts
import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

// Local database settings come from .env, the same file `npm start` uses.
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["test/unit/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "integration",
          include: ["test/integration/**/*.test.ts"],
          globalSetup: ["test/integration/globalSetup.ts"],
          // A dedicated database keeps the developer's data untouched, and a
          // single-connection pool turns any leaked connection into a hang,
          // which the test timeout reports as a failure.
          env: { DB_NAME: "reversi_test", DB_POOL_MAX: "1" },
          testTimeout: 5000,
          hookTimeout: 30000,
          fileParallelism: false,
        },
      },
    ],
  },
});
```

In `package.json` `scripts`, add after `test`:

```json
    "test:integration": "vitest run --project integration"
```

- [ ] **Step 4: Create `test/integration/helpers.ts`**

```ts
import mysql from "mysql2/promise";

/** A root connection outside the application pool, for inspecting server state. */
export async function adminConnection(): Promise<mysql.Connection> {
  return mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: "root",
    password: process.env.DB_ROOT_PASSWORD,
    multipleStatements: true,
  });
}

export async function connectionIdOf(conn: mysql.Connection): Promise<number> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>("select connection_id() as id");
  return Number(rows[0].id);
}

/**
 * Number of open transactions on the given server connection (0 or 1).
 * performance_schema is used because information_schema.innodb_trx is cached
 * and can lag behind the real transaction state.
 */
export async function activeTransactionCount(
  admin: mysql.Connection,
  connectionId: number,
): Promise<number> {
  const [rows] = await admin.query<mysql.RowDataPacket[]>(
    `select count(*) as n
       from performance_schema.events_transactions_current t
       join performance_schema.threads th on th.thread_id = t.thread_id
      where th.processlist_id = ? and t.state = 'ACTIVE'`,
    [connectionId],
  );
  return Number(rows[0].n);
}

export async function waitUntilDisconnected(
  admin: mysql.Connection,
  connectionId: number,
): Promise<void> {
  for (let i = 0; i < 50; i++) {
    const [rows] = await admin.query<mysql.RowDataPacket[]>(
      "select count(*) as n from performance_schema.threads where processlist_id = ?",
      [connectionId],
    );
    if (Number(rows[0].n) === 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Connection ${connectionId} is still open`);
}
```

- [ ] **Step 5: Create `test/integration/globalSetup.ts`**

```ts
import { readFileSync } from "node:fs";
import { adminConnection } from "./helpers";

const TEST_DATABASE = "reversi_test";

// Statements in mysql/init.sql that target the development database by name.
const DATABASE_STATEMENT = /^(drop database|create database|use)\b/i;

/**
 * Rebuilds the test database from mysql/init.sql so the schema has a single
 * source of truth and every run starts empty.
 */
export default async function setup(): Promise<void> {
  const admin = await adminConnection();
  try {
    const statements = readFileSync("mysql/init.sql", "utf8")
      .split(";")
      .map((statement) => statement.trim())
      .filter((statement) => statement && !DATABASE_STATEMENT.test(statement));

    await admin.query(`drop database if exists ${TEST_DATABASE}`);
    await admin.query(`create database ${TEST_DATABASE}`);
    await admin.query(`grant all on ${TEST_DATABASE}.* to ?@'%'`, [process.env.DB_USER]);
    await admin.query(`use ${TEST_DATABASE}`);
    for (const statement of statements) {
      await admin.query(statement);
    }
  } finally {
    await admin.end();
  }
}
```

- [ ] **Step 6: Write the failing integration tests**

Create `test/integration/connection.test.ts`:

```ts
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePool, connectMySQL } from "../../src/infrastructure/connection";
import { StartNewGameUseCase } from "../../src/application/useCase/startNewGameUseCase";
import { FindLastGameUseCase } from "../../src/application/useCase/findLastGamesUseCase";
import { FindLatestGameTurnByTurnCountUseCase } from "../../src/application/useCase/findLatestGameTurnByTurnCountUseCase";
import { RegisterTurnUseCase } from "../../src/application/useCase/registerTurnUseCase";
import { GameMYSQLRepository } from "../../src/infrastructure/repository/game/gameMYSQLRepository";
import { TurnMYSQLRepository } from "../../src/infrastructure/repository/turn/turnMYSQLRepository";
import { GameResultMYSQLRepository } from "../../src/infrastructure/repository/gameResult/gameResultMYSQLRepository";
import { FindLastGameMySQLQueryService } from "../../src/infrastructure/query/findLastGamesMYSQLQueryService";
import { TurnRepository } from "../../src/domain/model/turn/turnRepository";
import { Turn } from "../../src/domain/model/turn/turn";
import { Disc } from "../../src/domain/model/turn/disc";
import { Point } from "../../src/domain/model/turn/point";
import {
  activeTransactionCount,
  adminConnection,
  connectionIdOf,
  waitUntilDisconnected,
} from "./helpers";

// These tests run with DB_POOL_MAX=1 (see vitest.config.ts): if any path
// fails to return its connection, the next acquire waits forever and the
// test times out.

let admin: mysql.Connection;

beforeAll(async () => {
  admin = await adminConnection();
});

afterAll(async () => {
  await closePool();
  await admin.end();
});

describe("connectMySQL", () => {
  it("returns every connection to the pool across a sequence of use cases", async () => {
    const startNewGame = new StartNewGameUseCase(
      new GameMYSQLRepository(),
      new TurnMYSQLRepository(),
    );
    const findLastGames = new FindLastGameUseCase(new FindLastGameMySQLQueryService());
    const findTurn = new FindLatestGameTurnByTurnCountUseCase(
      new TurnMYSQLRepository(),
      new GameMYSQLRepository(),
      new GameResultMYSQLRepository(),
    );
    const registerTurn = new RegisterTurnUseCase(
      new TurnMYSQLRepository(),
      new GameMYSQLRepository(),
      new GameResultMYSQLRepository(),
    );

    await startNewGame.run();
    await startNewGame.run();
    await startNewGame.run();
    expect((await findLastGames.run()).length).toBeGreaterThanOrEqual(3);
    expect((await findTurn.run(0)).nextDisc).toBe(Disc.Dark);

    // A legal opening move for black: flips the white disc at (4, 3).
    await registerTurn.run(1, Disc.Dark, new Point(4, 2));

    const afterMove = await findTurn.run(1);
    expect(afterMove.board[2][4]).toBe(Disc.Dark);
    expect(afterMove.nextDisc).toBe(Disc.Light);
  });

  it("rolls back a transaction left open by an error before reusing the connection", async () => {
    const observed: { connectionId?: number; gameId?: number; activeInside?: number } = {};

    // Fails after StartNewGameUseCase has begun its transaction and inserted
    // the game row, recording what it saw on the way.
    const failingTurnRepository: TurnRepository = {
      async findForGmaeIdAndTurnCOunt(): Promise<Turn> {
        throw new Error("not used");
      },
      async save(conn: mysql.Connection, turn: Turn): Promise<void> {
        observed.connectionId = await connectionIdOf(conn);
        observed.gameId = turn.gameId;
        observed.activeInside = await activeTransactionCount(admin, observed.connectionId);
        throw new Error("simulated failure after beginTransaction");
      },
    };

    await expect(
      new StartNewGameUseCase(new GameMYSQLRepository(), failingTurnRepository).run(),
    ).rejects.toThrow("simulated failure after beginTransaction");

    // The probe must see the open transaction, or the checks below prove nothing.
    expect(observed.activeInside).toBe(1);

    const next = await connectMySQL();
    try {
      expect(await connectionIdOf(next)).toBe(observed.connectionId);
      expect(await activeTransactionCount(admin, observed.connectionId!)).toBe(0);

      const [rows] = await next.query<mysql.RowDataPacket[]>(
        "select count(*) as n from games where id = ?",
        [observed.gameId],
      );
      expect(Number(rows[0].n)).toBe(0);
    } finally {
      await next.end();
    }
  });

  it("drops a connection that died instead of returning it to the pool", async () => {
    const conn = await connectMySQL();
    const deadId = await connectionIdOf(conn);

    await admin.query("kill ?", [deadId]);
    await waitUntilDisconnected(admin, deadId);

    await conn.end();

    const next = await connectMySQL();
    try {
      expect(await connectionIdOf(next)).not.toBe(deadId);
    } finally {
      await next.end();
    }
  });
});
```

- [ ] **Step 7: Run the integration tests to verify they fail**

Run only the rollback test (Docker MySQL up):

```bash
npx vitest run --project integration -t "rolls back"
```

Expected: FAIL — `expected <new id> to be <old id>`: the old `connectMySQL()` opens a new connection per call, so the next connection is not the reused one. The `afterAll` hook also reports `closePool is not a function`.

Do not run the whole suite at this point: the old `connection.ts` ignores `DB_NAME` and would write the sequence test's games into the development `reversi` database. The rollback test is safe because its transaction is discarded when the old code closes the connection.

- [ ] **Step 8: Implement the pooled `connection.ts`**

Replace the whole file `src/infrastructure/connection.ts` with:

```ts
import mysql from "mysql2/promise";
import { attachDatabasePool } from "@vercel/functions";
import { IDLE_TIMEOUT_MS, loadDbConfig } from "./dbConfig";

// mysql2 looks for idle connections once per second, so a connection can stay
// open up to this much longer than IDLE_TIMEOUT_MS.
const IDLE_CHECK_INTERVAL_MS = 1000;

let pool: mysql.Pool | undefined;

// Created on first use so that a configuration error fails the request (and is
// logged) instead of crashing the function while the module loads.
function getPool(): mysql.Pool {
  if (!pool) {
    const created = mysql.createPool(loadDbConfig(process.env));

    // Keeps a Vercel function instance alive until its idle connections are
    // closed, so a suspended instance never holds database connections.
    // @vercel/functions does not read mysql2's idleTimeout from the pool (it
    // would fall back to 60 s), so it is given the release event and the real
    // timeout through the duck-typed interface it accepts.
    attachDatabasePool({
      on: (event: "release", listener: (...args: any[]) => void) => {
        created.pool.on(event, listener);
      },
      config: { idleTimeout: IDLE_TIMEOUT_MS + IDLE_CHECK_INTERVAL_MS },
    });

    pool = created;
  }
  return pool;
}

/**
 * Returns a pooled connection. Callers release it with `await conn.end()`,
 * which rolls back any transaction an error path left open (so the next
 * request cannot inherit it) and then returns the connection to the pool.
 */
export async function connectMySQL(): Promise<mysql.Connection> {
  const conn = await getPool().getConnection();

  conn.end = async () => {
    try {
      await conn.rollback();
    } catch {
      // The connection is unusable (for example, the server closed it).
      // Destroying it frees the pool slot for a fresh connection.
      conn.destroy();
      return;
    }
    conn.release();
  };

  return conn;
}

export async function closePool(): Promise<void> {
  if (pool) {
    const closing = pool;
    pool = undefined;
    await closing.end();
  }
}
```

- [ ] **Step 9: Run all tests to verify they pass**

Run: `npm run test:integration`
Expected: PASS, 3 tests.

Run: `npm test && npx tsc --noEmit`
Expected: both pass.

- [ ] **Step 10: Manual check — play through the UI locally**

Run: `npm start`, open http://localhost:3000, click "Start a Match", place several stones, return home and confirm the game appears in the history table. Stop the server.
Expected: identical behaviour to before; no `Calling conn.end() to release a pooled connection is deprecated` warning in the console.

- [ ] **Step 11: Commit**

```bash
git add src/infrastructure/connection.ts vitest.config.ts test/integration .env.example .gitignore nodemon.json package.json
git commit -m "Use a pooled, env-configured connection that always returns clean

connectMySQL() now hands out connections from one lazily created mysql2
pool. Its end() rolls back any transaction left open by an error path and
then releases the connection, or destroys it if it is no longer usable.
Integration tests run with a single-connection pool to catch leaks."
```

---

### Task 4: Vercel Function entry point

**Files:**
- Modify: `src/main.ts` (lines `const app = express();` and the `app.listen(...)` block only)
- Create: `api/index.ts`
- Create: `vercel.json`
- Test: `test/integration/vercelEntry.test.ts`

**Interfaces:**
- Consumes: `connectMySQL`, `closePool` from Task 3.
- Produces: `export const app` in `src/main.ts`; `api/index.ts` default-exports the Express app.

- [ ] **Step 1: Write the failing test**

Create `test/integration/vercelEntry.test.ts`:

```ts
import { createServer, Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import handler from "../../api/index";
import { closePool } from "../../src/infrastructure/connection";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await closePool();
});

describe("Vercel entry point", () => {
  it("serves the API through the default export", async () => {
    const created = await fetch(`${baseUrl}/api/games`, { method: "POST" });
    expect(created.status).toBe(201);

    const listed = await fetch(`${baseUrl}/api/games`);
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as { games: unknown[] };
    expect(body.games.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:integration`
Expected: FAIL — cannot resolve `../../api/index`.

- [ ] **Step 3: Export the app and listen only when run directly**

In `src/main.ts`, change exactly these lines.

Replace:

```ts
const app = express();
```

with:

```ts
export const app = express();
```

Replace:

```ts
app.listen(PORT, () => {
  console.log(`Reversi application : http://localhost:${PORT}`);
});
```

with:

```ts
// Vercel imports the app instead of running this file, so only open a port
// when started directly (npm start).
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Reversi application : http://localhost:${PORT}`);
  });
}
```

- [ ] **Step 4: Create `api/index.ts`**

```ts
// Vercel Function entry point. vercel.json rewrites every /api/* request here,
// and the Express app routes it as it does locally.
import { app } from "../src/main";

export default app;
```

- [ ] **Step 5: Create `vercel.json`**

```json
{
  "framework": null,
  "outputDirectory": "static",
  "rewrites": [{ "source": "/api/(.*)", "destination": "/api" }]
}
```

- [ ] **Step 6: Run tests and type-check**

Run: `npm run test:integration && npm test && npx tsc --noEmit`
Expected: all pass (4 integration tests).

- [ ] **Step 7: Confirm `npm start` still listens**

Run:

```bash
npm start &
sleep 6
curl -s -o /dev/null -w "%{http_code}\n" localhost:3000/api/games
kill %1
```

Expected: `Reversi application : http://localhost:3000` in the log and `200`.

- [ ] **Step 8: Commit**

```bash
git add src/main.ts api/index.ts vercel.json test/integration/vercelEntry.test.ts
git commit -m "Add Vercel Function entry point and routing config

api/index.ts exports the Express app for /api/* (rewritten in vercel.json),
and static/ is served by the CDN. main.ts only opens a port when run
directly."
```

---

### Task 5: Deployment guide and final verification

**Files:**
- Create: `docs/deployment.md`

**Interfaces:**
- Consumes: env var names from Task 2, `vercel.json` from Task 4.
- Produces: operator documentation; end-of-phase report.

- [ ] **Step 1: Write `docs/deployment.md`**

````markdown
# Deploying to Vercel and Aiven

The app runs as one Vercel Function (`api/index.ts`) for `/api/*`, with the
pages in `static/` served by Vercel's CDN. The database is MySQL on Aiven.

## 1. Choose the region first

Vercel Functions run in `iad1` (Washington, D.C., USA) by default. Create the
Aiven service in the same area — for example AWS `us-east-1` — or change the
function region to match the database instead (Vercel project **Settings →
Functions → Function Region**, or `"regions": ["<id>"]` in `vercel.json`).

This matters because every query pays the function-to-database round trip,
including the `ROLLBACK` that runs whenever a request returns its connection
to the pool. Later phases poll the server every second during a game, so a
database on another continent would make every request noticeably slow.

## 2. Create the Aiven MySQL service

1. Create a MySQL service in the region chosen above.
2. From the service overview, note the host, port, user (`avnadmin`), and
   password, and download the CA certificate (`ca.pem`).
3. Check the connection limit:

   ```sql
   SHOW VARIABLES LIKE 'max_connections';
   ```

## 3. Load the schema (once)

`mysql/init.sql` creates the `reversi` database and its tables. It starts by
dropping that database, so run it **only against a new, empty service** —
never against a database that holds real data.

```bash
mysql --host=<host> --port=<port> --user=avnadmin --password \
  --ssl-mode=VERIFY_CA --ssl-ca=ca.pem < mysql/init.sql
```

## 4. Create the Vercel project

1. Import the Git repository in Vercel.
2. Leave the framework preset, build command, and output directory at their
   defaults: `vercel.json` sets the project to "Other", serves `static/` from
   the CDN, and routes `/api/*` to the function.
3. The Node.js version comes from `engines.node` in `package.json` (`24.x`).

## 5. Environment variables

Set these in **Settings → Environment Variables** for Production (and Preview,
if preview deployments should reach a database):

| Variable | Value |
| --- | --- |
| `DB_HOST` | Aiven host |
| `DB_PORT` | Aiven port |
| `DB_USER` | `avnadmin` (or a dedicated user) |
| `DB_PASSWORD` | Its password |
| `DB_NAME` | `reversi` |
| `DB_CA_CERT` | Full contents of `ca.pem`, including the `BEGIN`/`END` lines |
| `DB_POOL_MAX` | Optional, default `3` (see below) |

The app refuses to connect on Vercel without `DB_CA_CERT`, and verifies the
server certificate against it. A missing variable is reported by name in the
function logs; values are never logged.

## 6. Sizing the connection pool

Each function instance keeps at most `DB_POOL_MAX` connections and closes them
after about 5 seconds without use, before the instance is suspended. The
worst case is therefore:

```
concurrent instances × DB_POOL_MAX  <  max_connections − headroom for admin sessions
```

Start with the default of 3. If the logs show requests waiting on the pool,
raise it; if Aiven reports too many connections, lower it. Avoid 1 in
production: it serialises concurrent requests on an instance without reducing
the total number of connections.

## 7. Verify the deployment

1. Open the site; the home page and `/game/` load (served by the CDN).
2. Start a match and place a few stones.
3. Return home; the game appears in the history table.
4. In the function logs, check there are no `Missing required environment
   variable` or TLS errors.

## Local development

Local settings live in `.env` (copy `.env.example`); `npm start` loads it.
Integration tests (`npm run test:integration`) use a separate `reversi_test`
database on the Docker MySQL and rebuild it on every run.
````

- [ ] **Step 2: Full verification**

Run each and confirm the expected result:

```bash
npx tsc --noEmit              # exit 0
npm test                      # unit tests pass
npm run test:integration      # 4 integration tests pass (Docker MySQL up)
git status --short            # empty: everything committed, .env ignored
git diff main --stat          # only files listed in the spec's §9 and new files
```

Confirm `git diff main -- src/domain src/application src/presentation src/infrastructure/repository src/infrastructure/query` is empty.

- [ ] **Step 3: Commit**

```bash
git add docs/deployment.md
git commit -m "Add deployment guide for Vercel and Aiven"
```

- [ ] **Step 4: End-of-phase report (to the user, not committed)**

Report: what was built, test results with counts, verification that `vercel build` / first deploy is still to be done by the owner (`vercel link`, then `vercel build`), and the pre-existing issues from spec §10 plus any new ones found during implementation.
