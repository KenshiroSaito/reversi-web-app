# Phase 1 — Identity Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guests identified by an httpOnly cookie, game-ID-based APIs that only let participants act and only the seated colour move, versioned migrations with a startup schema check, real error logging with 503 for an unreachable database, and local play rebuilt on top — with unit, integration, and browser e2e tests.

**Architecture:** New tables (`players`, `game_players`) are added by a small migration runner. Express middleware resolves the player from the cookie and enforces CSRF; new use cases lock the game's seat rows so moves are serialised and atomic; a new domain object (`GameSeats`) owns the seat and turn-ownership rule; the error handler moves into the presentation layer and maps every user-caused condition to 4xx.

**Tech Stack:** Node.js 24, TypeScript 4.8, Express 4, mysql2 3, `cookie-parser`, Vitest 5, `@playwright/test` 1.63, Docker MySQL 8.0 (tests only use `reversi_test`).

**Spec:** `docs/superpowers/specs/2026-09-25-phase-1-identity-design.md`

## Global Constraints

- Branch `feat/phase-1-identity`. Never commit to or merge into `main`. Never push.
- Every commit leaves `npx tsc --noEmit`, `npm test`, and `npm run test:integration` passing (and `npm run test:e2e` once it exists).
- Existing files may change only as listed in spec §15.1 / §15.2. Anything else → stop and ask.
- **No existing file under `src/domain/` changes.** New files only in `src/domain/model/gamePlayer/`.
- In existing files, change only the lines required — no reformatting, renaming, import reordering, or drive-by fixes.
- **The dev `reversi` database is read-only.** Tests, manual checks, and the browser only use `reversi_test`. Never open preview or production URLs.
- No credentials in code. `.env.example` may hold local-only values.
- All SQL uses placeholders; identifiers interpolated into SQL are constants, never input.
- Limits: firewall 300 req / 60 s per IP (documented, set by the owner); **20 new guests per IP hash per rolling hour; 10 new games per player per rolling hour.**
- Cookie: `__Host-rv_player` on Vercel, `rv_player` locally; `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` on Vercel, `Max-Age` 400 days.
- CSRF: non-GET/HEAD/OPTIONS under `/api` need `X-Requested-With: reversi` and a matching `Origin`.
- Display names: `Guest NNNN`, NNNN uniform in 1000–9999.
- English for code comments, commit messages, and docs.
- Pre-existing bugs found along the way are reported at the end, not fixed.

## Review Focus

Inputs the spec implies but no task would otherwise exercise, most likely to bite first; each line's test lives in the named task.

1. **Same game open in two tabs** — the stale tab's click returns 409 and the page re-renders the latest board instead of showing an error. → Task 11, `staleTab.spec.ts`.
2. **Garbage or orphaned cookies** — a cookie value that is not a 43-character base64url token is ignored without a database query; a well-formed token with no player is treated as anonymous and the next `POST /api/games` replaces the cookie. Never a 500. → Task 6 (garbage) and Task 8 (orphaned).
3. **Odd path and body values** — `:gameId` of `01`, `1e3`, `-1`, `2147483648`; body as an array, `null`, missing `move`, `x` of `"3"` or `1.5`; an extra legacy `disc` field → 400 (or ignored for `disc`), never 500. → Task 8.
4. **The move that ends the game** — the result is written in the same transaction, the response has `nextDisc: null` and a `winnerDisc`, and any further move returns 409. → Task 7 (use case) and Task 8 (HTTP).
5. **A database that was never migrated** (no `schema_migrations` table at all) — 503 naming every missing version, not a 500 `ER_NO_SUCH_TABLE`. → Task 2.

## Verified facts this plan relies on

Checked before writing (throwaway scripts; only `reversi_test` touched):

- Two transactions that each start with `SELECT … FOR UPDATE` on the same seat rows: the second blocks (~224 ms in the test) and its following non-locking read sees the first one's committed turn. This is what serialises concurrent moves (§7.3).
- An unreachable database: `localhost` on a closed port throws an `AggregateError` with an **empty message** and code `ECONNREFUSED`, with the real errors in `errors[]`; `127.0.0.1` gives `ECONNREFUSED`, an unknown host `ENOTFOUND`, a blackhole `ETIMEDOUT`. None carries an `sql` field.
- One turn costs ≈ 6.5 KB (spec §17.1).
- Node's `fetch` sends custom `Origin` and `Cookie` headers, `Headers.getSetCookie()` returns every `Set-Cookie`, and a server listening on `127.0.0.1` sees `remoteAddress` `127.0.0.1`.
- A variable set in the process environment wins over the same variable in `node --env-file`.
- Vercel overwrites `X-Forwarded-For`; `x-real-ip` equals it.
- `@playwright/test` 1.63.0 (Node ≥ 20); `cookie-parser` 1.4.7, `@types/cookie-parser` 1.4.10. No Playwright browser is installed yet.

## File Structure

| Path | Status | Responsibility |
| --- | --- | --- |
| `src/infrastructure/migration/migrations.ts` | create | Ordered list of migrations (SQL in TS so it is bundled) |
| `src/infrastructure/migration/migrationRunner.ts` | create | `schema_migrations`, locking, applying pending migrations |
| `src/infrastructure/migration/schemaCheck.ts` | create | `SchemaOutOfDateError`, `checkSchema()` |
| `src/infrastructure/migration/migrateCli.ts` | create | `npm run migrate` with target safety checks |
| `src/infrastructure/connection.ts` | modify | Schema check on first use |
| `src/infrastructure/databaseAvailability.ts` | create | Is this error "database unreachable"? |
| `src/presentation/errorLogging.ts` | create | `describeError()` without SQL or secrets |
| `src/presentation/errorHandler.ts` | create | Error → status/body, logging, 503 |
| `src/domain/model/gamePlayer/gameSeats.ts` | create | Seat and turn-ownership rule |
| `src/domain/model/gamePlayer/gameSeatsRepository.ts` | create | Port for seats |
| `src/infrastructure/repository/gamePlayer/*` | create | Seat gateway/record/repository |
| `src/application/identity/*` | create | `Player`, player port, token and guest-name helpers |
| `src/application/query/{latestTurn,rateLimit}QueryService.ts` | create | Query ports |
| `src/infrastructure/repository/player/*` | create | Player gateway/record/repository |
| `src/infrastructure/query/{latestTurn,rateLimit}MYSQLQueryService.ts` | create | Query implementations |
| `src/application/useCase/{registerGuest,findPlayerByToken,createLocalGame,findGameState,registerMove}UseCase.ts` | create | Use cases |
| `src/presentation/identity/{identityConfig,clientIp,playerCookie}.ts` | create | HTTP-side identity concerns |
| `src/presentation/middleware/{identity,csrfProtection}.ts` | create | `attachPlayer`, `ensurePlayer`, CSRF |
| `src/presentation/{validation,gameStateResponse,meRouter}.ts` | create | Input parsing, response shape, `GET /api/me` |
| `src/presentation/{gameRouter,turnRouter}.ts` | modify | Game-ID API |
| `src/application/error/applicationError.ts` | modify | New error types |
| `src/application/{query/findLastGamesQueryService,useCase/findLastGamesUseCase}.ts`, `src/infrastructure/query/findLastGamesMYSQLQueryService.ts` | modify | History per player |
| `src/main.ts` | modify | Wiring |
| `src/application/useCase/{startNewGame,findLatestGameTurnByTurnCount,registerTurn}UseCase.ts` | delete | Latest-game flow |
| `static/game/main.js` | modify | Local play on the new API |
| `test/support/testDatabase.ts` | create | `reversi_test` safeguard shared by both suites |
| `test/integration/*` | create/modify | See tasks |
| `test/unit/*` | create | See tasks |
| `test/e2e/*`, `playwright.config.ts` | create | Browser suite |
| `vitest.config.ts`, `tsconfig.json`, `package.json`, `.gitignore`, `.env.example` | modify | Config |
| `docs/deployment.md`, `README.md`, `docs/openapi.yaml` | modify | Docs |

---

### Task 1: Migrations, `npm run migrate`, and the test-database safeguard

**Files:**
- Create: `src/infrastructure/migration/migrations.ts`, `src/infrastructure/migration/migrationRunner.ts`, `src/infrastructure/migration/migrateCli.ts`
- Create: `test/support/testDatabase.ts`, `test/integration/setup.ts`
- Modify: `test/integration/globalSetup.ts`, `vitest.config.ts`, `package.json`, `.gitignore`
- Test: `test/unit/migrations.test.ts`, `test/unit/migrateCli.test.ts`, `test/unit/testDatabase.test.ts`, `test/integration/migrations.test.ts`

**Interfaces:**
- Produces:
  - `interface Migration { version: string; statements: string[] }`, `const MIGRATIONS: Migration[]`
  - `appliedVersions(conn: mysql.Connection): Promise<string[]>` (missing table → `[]`)
  - `applyPendingMigrations(conn: mysql.Connection, migrations: Migration[]): Promise<string[]>`
  - `parseMigrateArgs(argv: string[]): { envFile?: string; database?: string }`, `assertSafeTarget(args, options: mysql.PoolOptions): void`
  - `TEST_DATABASE = "reversi_test"`, `assertTestDatabase(env: NodeJS.ProcessEnv): void`
  - `rebuildTestDatabase(): Promise<void>` exported from `test/integration/globalSetup.ts`

- [ ] **Step 1: Write the failing unit tests**

`test/unit/migrations.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { MIGRATIONS } from "../../src/infrastructure/migration/migrations";

describe("MIGRATIONS", () => {
  it("has unique, ordered, well-formed versions", () => {
    const versions = MIGRATIONS.map((m) => m.version);

    expect(new Set(versions).size).toBe(versions.length);
    expect([...versions].sort()).toEqual(versions);
    for (const version of versions) {
      expect(version).toMatch(/^[0-9]{3}_[a-z0-9_]+$/);
      expect(version.length).toBeLessThanOrEqual(64);
    }
  });

  it("gives every migration at least one statement", () => {
    for (const migration of MIGRATIONS) {
      expect(migration.statements.length).toBeGreaterThan(0);
    }
  });
});
```

`test/unit/migrateCli.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { assertSafeTarget, parseMigrateArgs } from "../../src/infrastructure/migration/migrateCli";

describe("parseMigrateArgs", () => {
  it("reads --env-file and --database", () => {
    expect(parseMigrateArgs(["--env-file", ".env.preview", "--database", "reversi_preview"])).toEqual({
      envFile: ".env.preview",
      database: "reversi_preview",
    });
  });

  it("rejects unknown flags and missing values", () => {
    expect(() => parseMigrateArgs(["--force"])).toThrow("--force");
    expect(() => parseMigrateArgs(["--database"])).toThrow("--database");
  });
});

describe("assertSafeTarget", () => {
  const local = { host: "localhost", database: "reversi_test" };

  it("requires --database", () => {
    expect(() => assertSafeTarget({}, local)).toThrow("--database");
  });

  it("requires --database to match DB_NAME", () => {
    expect(() => assertSafeTarget({ database: "reversi" }, local)).toThrow("does not match");
  });

  it("accepts a matching local target without TLS", () => {
    expect(() => assertSafeTarget({ database: "reversi_test" }, local)).not.toThrow();
  });

  it("refuses a remote host without TLS", () => {
    const remote = { host: "mysql-xyz.aivencloud.com", database: "reversi_preview" };
    expect(() => assertSafeTarget({ database: "reversi_preview" }, remote)).toThrow("DB_CA_CERT");
  });

  it("accepts a remote host with TLS", () => {
    const remote = {
      host: "mysql-xyz.aivencloud.com",
      database: "reversi_preview",
      ssl: { ca: "pem", rejectUnauthorized: true },
    };
    expect(() => assertSafeTarget({ database: "reversi_preview" }, remote)).not.toThrow();
  });
});
```

`test/unit/testDatabase.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { assertTestDatabase } from "../support/testDatabase";

const env = { DB_HOST: "localhost", DB_USER: "reversi", DB_PASSWORD: "password" };

describe("assertTestDatabase", () => {
  it("accepts reversi_test", () => {
    expect(() => assertTestDatabase({ ...env, DB_NAME: "reversi_test" })).not.toThrow();
  });

  it.each(["reversi", "reversi_preview", "reversi_test2"])("refuses %s", (name) => {
    expect(() => assertTestDatabase({ ...env, DB_NAME: name })).toThrow("Refusing");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `migrations`, `migrateCli`, `testDatabase`.

- [ ] **Step 3: Implement `src/infrastructure/migration/migrations.ts`**

```ts
export interface Migration {
  version: string;
  statements: string[];
}

// Applied in order by `npm run migrate`. Never edit or reorder a migration
// that has been applied anywhere; add a new one instead. MySQL DDL is not
// transactional, so statements use `if not exists` and a migration that was
// interrupted part-way can simply be run again.
//
// The list lives in TypeScript rather than .sql files so it is always
// bundled into the Vercel Function, where the schema check needs it.
export const MIGRATIONS: Migration[] = [
  {
    version: "001_create_players_and_game_players",
    statements: [
      `create table if not exists players (
        id              int primary key auto_increment,
        token_hash      binary(32) not null,
        display_name    varchar(32) not null,
        created_ip_hash binary(32) null,
        created_at      datetime(3) not null default current_timestamp(3),
        unique key uq_players_token_hash (token_hash),
        key ix_players_ip_created (created_ip_hash, created_at)
      )`,
      `create table if not exists game_players (
        game_id    int not null,
        disc       tinyint not null,
        player_id  int not null,
        created_at datetime(3) not null default current_timestamp(3),
        primary key (game_id, disc),
        key ix_game_players_player_created (player_id, created_at),
        constraint fk_game_players_game foreign key (game_id) references games (id),
        constraint fk_game_players_player foreign key (player_id) references players (id),
        constraint ck_game_players_disc check (disc in (1, 2))
      )`,
    ],
  },
];
```

- [ ] **Step 4: Implement `src/infrastructure/migration/migrationRunner.ts`**

```ts
import mysql from "mysql2/promise";
import { Migration } from "./migrations";

const LOCK_NAME = "reversi_schema_migrations";
const LOCK_TIMEOUT_SECONDS = 10;

const CREATE_SCHEMA_MIGRATIONS = `create table if not exists schema_migrations (
  version    varchar(64) primary key,
  applied_at datetime(3) not null default current_timestamp(3)
)`;

/** Versions recorded as applied; a database never migrated has none. */
export async function appliedVersions(conn: mysql.Connection): Promise<string[]> {
  try {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      "select version from schema_migrations order by version",
    );
    return rows.map((row) => String(row.version));
  } catch (e) {
    if ((e as { code?: unknown }).code === "ER_NO_SUCH_TABLE") {
      return [];
    }
    throw e;
  }
}

/**
 * Applies every migration not yet recorded, in order, and returns the versions
 * it applied. A named lock keeps two concurrent runs from interleaving.
 */
export async function applyPendingMigrations(
  conn: mysql.Connection,
  migrations: Migration[],
): Promise<string[]> {
  const [lockRows] = await conn.query<mysql.RowDataPacket[]>(
    "select get_lock(?, ?) as acquired",
    [LOCK_NAME, LOCK_TIMEOUT_SECONDS],
  );
  if (Number(lockRows[0].acquired) !== 1) {
    throw new Error("Another migration run is in progress (could not take the migration lock)");
  }

  try {
    await conn.query(CREATE_SCHEMA_MIGRATIONS);
    const applied = new Set(await appliedVersions(conn));

    const newlyApplied: string[] = [];
    for (const migration of migrations) {
      if (applied.has(migration.version)) {
        continue;
      }
      for (const statement of migration.statements) {
        await conn.query(statement);
      }
      await conn.execute("insert into schema_migrations (version) values (?)", [migration.version]);
      newlyApplied.push(migration.version);
    }
    return newlyApplied;
  } finally {
    await conn.query("select release_lock(?)", [LOCK_NAME]);
  }
}
```

- [ ] **Step 5: Implement `src/infrastructure/migration/migrateCli.ts`**

```ts
import mysql from "mysql2/promise";
import { loadDbConfig } from "../dbConfig";
import { MIGRATIONS } from "./migrations";
import { applyPendingMigrations } from "./migrationRunner";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1"];

export interface MigrateArgs {
  envFile?: string;
  database?: string;
}

export function parseMigrateArgs(argv: string[]): MigrateArgs {
  const args: MigrateArgs = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag !== "--env-file" && flag !== "--database") {
      throw new Error(`Unknown option ${flag}. Usage: npm run migrate -- [--env-file <path>] --database <name>`);
    }
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${flag} needs a value`);
    }
    if (flag === "--env-file") {
      args.envFile = value;
    } else {
      args.database = value;
    }
  }
  return args;
}

/** Guards against migrating the wrong database, or a remote one without TLS. */
export function assertSafeTarget(args: MigrateArgs, options: mysql.PoolOptions): void {
  if (!args.database) {
    throw new Error("Pass --database <name>; it must match DB_NAME, as a check that this is the intended database");
  }
  if (args.database !== options.database) {
    throw new Error(`--database ${args.database} does not match DB_NAME ${options.database}`);
  }
  if (!LOCAL_HOSTS.includes(options.host ?? "") && !options.ssl) {
    throw new Error("Refusing to migrate a remote database without DB_CA_CERT (verified TLS)");
  }
}

async function main(): Promise<void> {
  const args = parseMigrateArgs(process.argv.slice(2));
  if (args.envFile) {
    process.loadEnvFile(args.envFile);
  }
  const options = loadDbConfig(process.env);
  assertSafeTarget(args, options);

  console.log(`Migrating database ${options.database} on ${options.host}:${options.port}`);
  const pool = mysql.createPool(options);
  try {
    const conn = await pool.getConnection();
    try {
      const applied = await applyPendingMigrations(conn, MIGRATIONS);
      console.log(
        applied.length === 0 ? "Already up to date" : applied.map((v) => `Applied ${v}`).join("\n"),
      );
    } finally {
      conn.release();
    }
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
```

- [ ] **Step 6: Implement `test/support/testDatabase.ts`**

```ts
import { loadDbConfig } from "../../src/infrastructure/dbConfig";

export const TEST_DATABASE = "reversi_test";

/**
 * Stops a test run before it touches any database other than reversi_test,
 * whatever .env or the shell says.
 */
export function assertTestDatabase(env: NodeJS.ProcessEnv): void {
  const database = loadDbConfig(env).database;
  if (database !== TEST_DATABASE) {
    throw new Error(`Refusing to run tests against database "${database}"; expected "${TEST_DATABASE}"`);
  }
}
```

- [ ] **Step 7: Run the unit tests**

Run: `npm test`
Expected: PASS (existing 16 + new).

- [ ] **Step 8: Wire the safeguard and migrations into the integration suite**

Create `test/integration/setup.ts`:

```ts
import { assertTestDatabase } from "../support/testDatabase";

// Runs in every integration test worker before any test file is loaded.
assertTestDatabase(process.env);
```

Replace `test/integration/globalSetup.ts` with:

```ts
import { readFileSync } from "node:fs";
import { MIGRATIONS } from "../../src/infrastructure/migration/migrations";
import { applyPendingMigrations } from "../../src/infrastructure/migration/migrationRunner";
import { TEST_DATABASE } from "../support/testDatabase";
import { adminConnection } from "./helpers";

// Statements in mysql/init.sql that target the development database by name.
const DATABASE_STATEMENT = /^(drop database|create database|use)\b/i;

/**
 * Rebuilds the test database from mysql/init.sql plus every migration, so the
 * schema has a single source of truth and every run starts empty. Also used
 * by the e2e suite.
 */
export async function rebuildTestDatabase(): Promise<void> {
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
    await applyPendingMigrations(admin, MIGRATIONS);
  } finally {
    await admin.end();
  }
}

export default async function setup(): Promise<void> {
  await rebuildTestDatabase();
}
```

In `vitest.config.ts`, inside the `integration` project's `test` object, add after `globalSetup`:

```ts
          setupFiles: ["test/integration/setup.ts"],
```

- [ ] **Step 9: Write the migrations integration test**

`test/integration/migrations.test.ts`:

```ts
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIGRATIONS } from "../../src/infrastructure/migration/migrations";
import { appliedVersions, applyPendingMigrations } from "../../src/infrastructure/migration/migrationRunner";
import { adminConnection } from "./helpers";

let admin: mysql.Connection;

beforeAll(async () => {
  admin = await adminConnection();
  await admin.query("use reversi_test");
});

afterAll(async () => {
  await admin.end();
});

describe("migrations in reversi_test", () => {
  it("records every migration", async () => {
    expect(await appliedVersions(admin)).toEqual(MIGRATIONS.map((m) => m.version));
  });

  it("applies nothing when run again", async () => {
    expect(await applyPendingMigrations(admin, MIGRATIONS)).toEqual([]);
  });

  it("creates the Phase 1 tables", async () => {
    const [rows] = await admin.query<mysql.RowDataPacket[]>(
      "select table_name as name from information_schema.tables where table_schema = 'reversi_test'",
    );
    const names = rows.map((r) => String(r.name));
    expect(names).toEqual(expect.arrayContaining(["players", "game_players", "schema_migrations"]));
  });
});
```

- [ ] **Step 10: Add the `migrate` script and ignore env files**

In `package.json` `scripts`, add after `test:integration`:

```json
    "migrate": "node -r ts-node/register src/infrastructure/migration/migrateCli.ts"
```

Append to `.gitignore` (keep existing lines):

```
.env.*
!.env.example
```

- [ ] **Step 11: Run everything**

Run: `npx tsc --noEmit && npm test && npm run test:integration`
Expected: all pass; integration now 4 existing + 3 new.

Check the CLI guard without touching the dev `reversi` database (which is read-only — never run `npm run migrate` against it):

Run: `npm run migrate -- --database reversi_test`
Expected: `--database reversi_test does not match DB_NAME reversi` (`.env` says `reversi`), exit code 1, no connection made.

Run: `DB_NAME=reversi_test npm run migrate -- --database reversi_test`
Expected: `Migrating database reversi_test on localhost:3306` then `Already up to date`.

Run: `touch .env.preview && git status --short .env.preview; rm .env.preview`
Expected: no output (env files are ignored).

- [ ] **Step 12: Commit**

```bash
git add src/infrastructure/migration test/support test/unit/migrations.test.ts test/unit/migrateCli.test.ts test/unit/testDatabase.test.ts test/integration/setup.ts test/integration/globalSetup.ts test/integration/migrations.test.ts vitest.config.ts package.json .gitignore
git commit -m "Add versioned migrations, npm run migrate, and a reversi_test safeguard

Migration 001 creates players and game_players. The runner records
versions in schema_migrations under a named lock. npm run migrate
refuses a --database that does not match DB_NAME and remote hosts
without TLS. Integration tests abort unless the resolved database is
reversi_test."
```

---

### Task 2: Schema check on first database use

**Files:**
- Create: `src/infrastructure/migration/schemaCheck.ts`
- Modify: `src/infrastructure/connection.ts`
- Test: `test/integration/schemaCheck.test.ts`

**Interfaces:**
- Consumes: `appliedVersions`, `MIGRATIONS` (Task 1).
- Produces: `class SchemaOutOfDateError extends Error { readonly missingVersions: string[] }`, `checkSchema(conn, migrations): Promise<void>`.

- [ ] **Step 1: Write the failing integration test**

`test/integration/schemaCheck.test.ts`:

```ts
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closePool, connectMySQL } from "../../src/infrastructure/connection";
import { MIGRATIONS } from "../../src/infrastructure/migration/migrations";
import { SchemaOutOfDateError } from "../../src/infrastructure/migration/schemaCheck";
import { adminConnection } from "./helpers";

// DB_POOL_MAX=1: if a failed check kept its connection, the next call would hang.

let admin: mysql.Connection;

beforeAll(async () => {
  admin = await adminConnection();
  await admin.query("use reversi_test");
});

afterAll(async () => {
  await closePool();
  await admin.end();
});

describe("schema check", () => {
  it("rejects with the missing version, releases the connection, and recovers", async () => {
    await closePool();
    const version = MIGRATIONS[0].version;
    await admin.query("delete from schema_migrations where version = ?", [version]);
    try {
      await expect(connectMySQL()).rejects.toThrow(version);
      // Not cached, and the connection was released (pool of 1 would hang otherwise).
      await expect(connectMySQL()).rejects.toBeInstanceOf(SchemaOutOfDateError);
    } finally {
      await admin.query("insert into schema_migrations (version) values (?)", [version]);
    }

    const conn = await connectMySQL();
    await conn.end();
  });

  it("treats a database that was never migrated as missing every version", async () => {
    await closePool();
    await admin.query("rename table schema_migrations to schema_migrations_hidden");
    try {
      const error = await connectMySQL().catch((e) => e);
      expect(error).toBeInstanceOf(SchemaOutOfDateError);
      expect((error as SchemaOutOfDateError).missingVersions).toEqual(MIGRATIONS.map((m) => m.version));
    } finally {
      await admin.query("rename table schema_migrations_hidden to schema_migrations");
    }
  });

  it("warns about, but accepts, versions the code does not know", async () => {
    await closePool();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await admin.query("insert into schema_migrations (version) values ('999_from_a_newer_branch')");
    try {
      const conn = await connectMySQL();
      await conn.end();
      expect(warn.mock.calls.flat().join(" ")).toContain("999_from_a_newer_branch");
    } finally {
      await admin.query("delete from schema_migrations where version = '999_from_a_newer_branch'");
      warn.mockRestore();
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:integration`
Expected: FAIL — cannot resolve `schemaCheck`.

- [ ] **Step 3: Implement `src/infrastructure/migration/schemaCheck.ts`**

```ts
import mysql from "mysql2/promise";
import { Migration } from "./migrations";
import { appliedVersions } from "./migrationRunner";

export class SchemaOutOfDateError extends Error {
  constructor(readonly missingVersions: string[]) {
    super(
      `Database schema is missing migrations: ${missingVersions.join(", ")}. ` +
        "Run `npm run migrate` against this database.",
    );
    this.name = "SchemaOutOfDateError";
  }
}

/**
 * Fails if the database lacks a migration this code expects. Versions the
 * code does not know (a newer branch migrated this database) only warn:
 * migrations are additive, so older code keeps working.
 */
export async function checkSchema(conn: mysql.Connection, migrations: Migration[]): Promise<void> {
  const applied = await appliedVersions(conn);
  const appliedSet = new Set(applied);
  const expected = migrations.map((m) => m.version);

  const missing = expected.filter((version) => !appliedSet.has(version));
  if (missing.length > 0) {
    throw new SchemaOutOfDateError(missing);
  }

  const unknown = applied.filter((version) => !expected.includes(version));
  if (unknown.length > 0) {
    console.warn(`Database has migrations this code does not know about: ${unknown.join(", ")}`);
  }
}
```

- [ ] **Step 4: Add the check to `src/infrastructure/connection.ts`**

Add imports after the existing `./dbConfig` import:

```ts
import { MIGRATIONS } from "./migration/migrations";
import { checkSchema } from "./migration/schemaCheck";
```

After `let pool: mysql.Pool | undefined;` add:

```ts
// Set once the schema check has passed for the current pool. A failed check
// is not remembered, so an instance recovers as soon as migrations are applied.
let schemaVerified = false;
```

Replace the doc comment and body of `connectMySQL` with:

```ts
/**
 * Returns a pooled connection. Callers release it with `await conn.end()`,
 * which rolls back any transaction an error path left open (so the next
 * request cannot inherit it) and then returns the connection to the pool.
 *
 * The first successful call per pool also checks that the database has every
 * migration this code expects, and fails with SchemaOutOfDateError otherwise.
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

  if (!schemaVerified) {
    try {
      await checkSchema(conn, MIGRATIONS);
    } catch (e) {
      await conn.end();
      throw e;
    }
    schemaVerified = true;
  }

  return conn;
}
```

In `closePool`, add `schemaVerified = false;` as the first line of the function body.

- [ ] **Step 5: Run everything**

Run: `npx tsc --noEmit && npm test && npm run test:integration`
Expected: all pass (the Phase 0 connection tests still pass: the check runs on the first acquisition and releases normally).

- [ ] **Step 6: Commit**

```bash
git add src/infrastructure/migration/schemaCheck.ts src/infrastructure/connection.ts test/integration/schemaCheck.test.ts
git commit -m "Check the schema version on first database use

connectMySQL() now verifies, once per pool, that schema_migrations has
every migration the code expects, and fails with SchemaOutOfDateError
naming the missing versions. Failures are not cached, so an instance
recovers once the database is migrated."
```

---

### Task 3: Error handler with real error logging and 503

**Files:**
- Create: `src/presentation/errorLogging.ts`, `src/infrastructure/databaseAvailability.ts`, `src/presentation/errorHandler.ts`
- Create: `test/integration/apiClient.ts`
- Modify: `src/main.ts`, `src/application/error/applicationError.ts`
- Test: `test/unit/errorLogging.test.ts`, `test/unit/databaseAvailability.test.ts`, `test/unit/errorHandler.test.ts`, `test/integration/databaseUnavailable.test.ts`

**Interfaces:**
- Consumes: `SchemaOutOfDateError` (Task 2).
- Produces:
  - `describeError(err: unknown): ErrorDescription`
  - `isDatabaseUnavailable(err: unknown): boolean`
  - `errorHandler(err, req, res, next)` and `APPLICATION_ERROR_STATUS: Record<ApplicationErrorType, number>` (later tasks add entries)
  - `export type ApplicationErrorType` from `applicationError.ts`
  - Test client: `startTestServer(handler: RequestListener): Promise<TestServer>`, `class Guest { cookie?: string; get(path); post(path, body?, options?: { csrf?: boolean; origin?: string }) }`, `ApiResponse { status; body; setCookie; headers }`

- [ ] **Step 1: Write the failing unit tests**

`test/unit/errorLogging.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { describeError } from "../../src/presentation/errorLogging";

describe("describeError", () => {
  it("keeps diagnostic fields and drops the SQL text", () => {
    const err = Object.assign(new Error("Duplicate entry"), {
      code: "ER_DUP_ENTRY",
      errno: 1062,
      sqlState: "23000",
      sql: "insert into players (token_hash) values ('secret-value')",
    });

    const described = describeError(err);

    expect(described).toMatchObject({
      name: "Error",
      message: "Duplicate entry",
      code: "ER_DUP_ENTRY",
      errno: 1062,
      sqlState: "23000",
    });
    expect(described.stack).toContain("Duplicate entry");
    expect(JSON.stringify(described)).not.toContain("secret-value");
  });

  it("describes nested causes and AggregateError entries", () => {
    const inner = Object.assign(new Error("connect ECONNREFUSED ::1:3306"), { code: "ECONNREFUSED" });
    const aggregate = Object.assign(new AggregateError([inner], ""), { code: "ECONNREFUSED" });
    const outer = new Error("wrapped", { cause: aggregate });

    const described = describeError(outer);

    expect(described.cause?.code).toBe("ECONNREFUSED");
    expect(described.cause?.errors?.[0].message).toBe("connect ECONNREFUSED ::1:3306");
  });

  it("handles non-Error values", () => {
    expect(describeError("boom")).toEqual({ message: "boom" });
    expect(describeError(undefined)).toEqual({ message: "undefined" });
  });
});
```

`test/unit/databaseAvailability.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isDatabaseUnavailable } from "../../src/infrastructure/databaseAvailability";

const withCode = (code: string) => Object.assign(new Error(code), { code });

describe("isDatabaseUnavailable", () => {
  it.each([
    "ECONNREFUSED",
    "ECONNRESET",
    "ETIMEDOUT",
    "ENOTFOUND",
    "EAI_AGAIN",
    "EHOSTUNREACH",
    "ENETUNREACH",
    "PROTOCOL_CONNECTION_LOST",
    "ER_CON_COUNT_ERROR",
  ])("is true for %s", (code) => {
    expect(isDatabaseUnavailable(withCode(code))).toBe(true);
  });

  it("looks inside AggregateError entries and causes", () => {
    expect(isDatabaseUnavailable(new AggregateError([withCode("ECONNREFUSED")], ""))).toBe(true);
    expect(isDatabaseUnavailable(new Error("x", { cause: withCode("ETIMEDOUT") }))).toBe(true);
  });

  it("is false for query errors and non-errors", () => {
    expect(isDatabaseUnavailable(withCode("ER_DUP_ENTRY"))).toBe(false);
    expect(isDatabaseUnavailable(new Error("plain"))).toBe(false);
    expect(isDatabaseUnavailable(undefined)).toBe(false);
  });
});
```

`test/unit/errorHandler.test.ts`:

```ts
import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../../src/presentation/errorHandler";
import { DomainError } from "../../src/domain/error/domainError";
import { ApplicationError } from "../../src/application/error/applicationError";
import { SchemaOutOfDateError } from "../../src/infrastructure/migration/schemaCheck";

interface FakeResponse {
  statusCode: number;
  body: unknown;
}

function run(err: unknown): FakeResponse {
  const result: FakeResponse = { statusCode: 0, body: undefined };
  const res = {
    status(code: number) {
      result.statusCode = code;
      return res;
    },
    json(body: unknown) {
      result.body = body;
      return res;
    },
    send(body: unknown) {
      result.body = body;
      return res;
    },
  };
  const req = { method: "POST", path: "/api/games" };
  errorHandler(err, req as express.Request, res as unknown as express.Response, () => {});
  return result;
}

let logged: string;

beforeEach(() => {
  logged = "";
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    logged += args.map(String).join(" ");
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("errorHandler", () => {
  it("maps DomainError to 400 without logging", () => {
    expect(run(new DomainError("FlipPointsIsEmpty", "Flip points is empty"))).toEqual({
      statusCode: 400,
      body: { type: "FlipPointsIsEmpty", message: "Flip points is empty" },
    });
    expect(logged).toBe("");
  });

  it("maps ApplicationError by type", () => {
    expect(run(new ApplicationError("LatestGameNotFound", "Latest game not found")).statusCode).toBe(404);
  });

  it("maps body-parser client errors to 400 InvalidRequest", () => {
    const err = Object.assign(new SyntaxError("Unexpected token"), {
      type: "entity.parse.failed",
      status: 400,
      expose: true,
    });
    expect(run(err)).toEqual({
      statusCode: 400,
      body: { type: "InvalidRequest", message: "Request body is not valid JSON" },
    });
  });

  it("returns 503 and logs the missing migrations", () => {
    const response = run(new SchemaOutOfDateError(["001_create_players_and_game_players"]));

    expect(response).toEqual({
      statusCode: 503,
      body: { type: "ServiceUnavailable", message: "Service temporarily unavailable" },
    });
    expect(logged).toContain("001_create_players_and_game_players");
  });

  it("returns 503 and logs the code when the database is unreachable", () => {
    const refused = Object.assign(new Error("connect ECONNREFUSED ::1:3306"), { code: "ECONNREFUSED" });
    const response = run(Object.assign(new AggregateError([refused], ""), { code: "ECONNREFUSED" }));

    expect(response.statusCode).toBe(503);
    expect(logged).toContain("ECONNREFUSED");
    expect(logged).toContain("/api/games");
  });

  it("returns the generic 500 body and logs the real cause, without SQL", () => {
    const err = Object.assign(new Error("Unknown column 'x'"), { sql: "select 'secret-value'" });
    const response = run(err);

    expect(response).toEqual({ statusCode: 500, body: { message: "Unexpected Error occured" } });
    expect(logged).toContain("Unknown column 'x'");
    expect(logged).not.toContain("secret-value");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `errorLogging`, `databaseAvailability`, `errorHandler`.

- [ ] **Step 3: Implement `src/presentation/errorLogging.ts`**

```ts
export interface ErrorDescription {
  name?: string;
  message?: string;
  code?: string;
  errno?: number;
  sqlState?: string;
  stack?: string;
  cause?: ErrorDescription;
  errors?: ErrorDescription[];
}

const MAX_DEPTH = 3;

/**
 * Picks the fields needed to diagnose a failure. The error object itself is
 * never logged: mysql2 errors carry the SQL text (with inlined values for
 * `query`), and nothing logged here may contain secrets or request data.
 */
export function describeError(err: unknown, depth = 0): ErrorDescription {
  if (typeof err !== "object" || err === null) {
    return { message: String(err) };
  }

  const e = err as Record<string, unknown>;
  const description: ErrorDescription = {};
  if (typeof e.name === "string") description.name = e.name;
  if (typeof e.message === "string") description.message = e.message;
  if (typeof e.code === "string") description.code = e.code;
  if (typeof e.errno === "number") description.errno = e.errno;
  if (typeof e.sqlState === "string") description.sqlState = e.sqlState;
  if (typeof e.stack === "string") description.stack = e.stack;

  if (depth < MAX_DEPTH) {
    if (e.cause !== undefined) {
      description.cause = describeError(e.cause, depth + 1);
    }
    // Node reports a refused dual-stack connection as an AggregateError whose
    // own message is empty; the useful detail is in its entries.
    if (Array.isArray(e.errors)) {
      description.errors = e.errors.map((entry) => describeError(entry, depth + 1));
    }
  }
  return description;
}
```

- [ ] **Step 4: Implement `src/infrastructure/databaseAvailability.ts`**

```ts
// Error codes meaning the database could not be reached at all (as opposed
// to a query failing). A powered-off Aiven service shows up as one of these.
const UNAVAILABLE_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "PROTOCOL_CONNECTION_LOST",
  "ER_CON_COUNT_ERROR",
]);

const MAX_DEPTH = 3;

export function isDatabaseUnavailable(err: unknown, depth = 0): boolean {
  if (typeof err !== "object" || err === null || depth > MAX_DEPTH) {
    return false;
  }
  const e = err as { code?: unknown; cause?: unknown; errors?: unknown };
  if (typeof e.code === "string" && UNAVAILABLE_CODES.has(e.code)) {
    return true;
  }
  if (isDatabaseUnavailable(e.cause, depth + 1)) {
    return true;
  }
  return Array.isArray(e.errors) && e.errors.some((entry) => isDatabaseUnavailable(entry, depth + 1));
}
```

- [ ] **Step 5: Export the error type union**

In `src/application/error/applicationError.ts`, change only the first line:

```ts
type ApplicationErrorType = "LatestGameNotFound";
```

to:

```ts
export type ApplicationErrorType = "LatestGameNotFound";
```

- [ ] **Step 6: Implement `src/presentation/errorHandler.ts`**

```ts
import express from "express";
import { DomainError } from "../domain/error/domainError";
import { ApplicationError, ApplicationErrorType } from "../application/error/applicationError";
import { SchemaOutOfDateError } from "../infrastructure/migration/schemaCheck";
import { isDatabaseUnavailable } from "../infrastructure/databaseAvailability";
import { describeError } from "./errorLogging";

// Every ApplicationError type must have a status; the compiler enforces it.
export const APPLICATION_ERROR_STATUS: Record<ApplicationErrorType, number> = {
  LatestGameNotFound: 404,
};

export function errorHandler(
  err: any,
  req: express.Request,
  res: express.Response,
  _next: express.NextFunction,
) {
  if (err instanceof DomainError) {
    res.status(400).json({ type: err.type, message: err.message });
    return;
  }

  if (err instanceof ApplicationError) {
    res.status(APPLICATION_ERROR_STATUS[err.type]).json({ type: err.type, message: err.message });
    return;
  }

  if (isClientBodyError(err)) {
    res.status(400).json({ type: "InvalidRequest", message: "Request body is not valid JSON" });
    return;
  }

  logServerError(req, err);

  if (err instanceof SchemaOutOfDateError || isDatabaseUnavailable(err)) {
    res.status(503).json({ type: "ServiceUnavailable", message: "Service temporarily unavailable" });
    return;
  }

  res.status(500).send({ message: "Unexpected Error occured" });
}

// body-parser marks errors caused by the request body (malformed JSON, too
// large) with `expose` and a 4xx `status`.
function isClientBodyError(err: any): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    err.expose === true &&
    typeof err.status === "number" &&
    err.status >= 400 &&
    err.status < 500
  );
}

// One JSON line so nested causes are not truncated by the log viewer.
function logServerError(req: express.Request, err: unknown) {
  console.error(
    `Request failed: ${JSON.stringify({ method: req.method, path: req.path, error: describeError(err) })}`,
  );
}
```

- [ ] **Step 7: Use it from `src/main.ts`**

Replace the two imports

```ts
import { DomainError } from "./domain/error/domainError";
import { ApplicationError } from "./application/error/applicationError";
```

with

```ts
import { errorHandler } from "./presentation/errorHandler";
```

and delete the whole `function errorHandler(...) { ... }` at the end of the file. Nothing else in `main.ts` changes.

- [ ] **Step 8: Run the unit tests**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 9: Create the HTTP test client `test/integration/apiClient.ts`**

```ts
import { createServer, RequestListener } from "node:http";
import { AddressInfo } from "node:net";

export interface TestServer {
  baseUrl: string;
  close(): Promise<void>;
}

/** Serves the handler on 127.0.0.1 and a random free port. */
export async function startTestServer(handler: RequestListener): Promise<TestServer> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

export interface ApiResponse {
  status: number;
  body: any;
  setCookie: string | undefined;
  headers: Headers;
}

export interface PostOptions {
  /** Send the CSRF header (default true). */
  csrf?: boolean;
  /** Origin header to send (default: the server's own origin). */
  origin?: string;
}

/**
 * A browser-like client with its own cookie jar. By default it sends what the
 * real frontend sends on POST: the CSRF header and a same-origin Origin.
 */
export class Guest {
  cookie: string | undefined;

  constructor(private _server: TestServer) {}

  get(path: string): Promise<ApiResponse> {
    return this.send("GET", path, undefined, {});
  }

  post(path: string, body?: unknown, options: PostOptions = {}): Promise<ApiResponse> {
    return this.send("POST", path, body, options);
  }

  private async send(
    method: string,
    path: string,
    body: unknown,
    options: PostOptions,
  ): Promise<ApiResponse> {
    const headers: Record<string, string> = {};
    if (this.cookie) {
      headers.Cookie = this.cookie;
    }
    if (method !== "GET") {
      if (options.csrf !== false) {
        headers["X-Requested-With"] = "reversi";
      }
      headers.Origin = options.origin ?? this._server.baseUrl;
    }
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(this._server.baseUrl + path, {
      method,
      headers,
      // A string is sent as-is, so tests can send malformed JSON.
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    });

    const setCookie = response.headers.getSetCookie()[0];
    if (setCookie) {
      this.cookie = setCookie.split(";")[0];
    }
    return {
      status: response.status,
      body: parseBody(await response.text()),
      setCookie,
      headers: response.headers,
    };
  }
}

// JSON when it is JSON; Express's default 404 page (before a route exists) is HTML.
function parseBody(text: string): any {
  if (text === "") {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
```

- [ ] **Step 10: Write the failing integration test**

`test/integration/databaseUnavailable.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { app } from "../../src/main";
import { closePool } from "../../src/infrastructure/connection";
import { Guest, startTestServer, TestServer } from "./apiClient";

let server: TestServer;

beforeAll(async () => {
  // The pool is created on first use, so this redirects it to a closed port.
  vi.stubEnv("DB_HOST", "127.0.0.1");
  vi.stubEnv("DB_PORT", "1");
  server = await startTestServer(app);
});

afterAll(async () => {
  await server.close();
  await closePool();
  vi.unstubAllEnvs();
});

describe("when the database is unreachable", () => {
  it("returns 503 and logs the underlying error code", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await new Guest(server).post("/api/games");

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ type: "ServiceUnavailable", message: "Service temporarily unavailable" });
    expect(error.mock.calls.flat().join(" ")).toContain("ECONNREFUSED");
    error.mockRestore();
  });
});
```

- [ ] **Step 11: Run all suites**

Run: `npx tsc --noEmit && npm test && npm run test:integration`
Expected: all pass. (Before Step 6/7 this test would have received a 500 with only "Unexpected Error occured" in the log.)

- [ ] **Step 12: Commit**

```bash
git add src/presentation/errorLogging.ts src/presentation/errorHandler.ts src/infrastructure/databaseAvailability.ts src/application/error/applicationError.ts src/main.ts test/unit/errorLogging.test.ts test/unit/databaseAvailability.test.ts test/unit/errorHandler.test.ts test/integration/apiClient.ts test/integration/databaseUnavailable.test.ts
git commit -m "Log the real cause of server errors and return 503 when the database is down

The error handler moves to src/presentation/errorHandler.ts. For 500 and
503 it logs one JSON line with the method, path, and the error's name,
message, code, stack, causes, and AggregateError entries, never the SQL
text. An unreachable database or an out-of-date schema returns 503;
malformed JSON returns 400."
```

---

### Task 4: Game seats (domain) and their repository

**Files:**
- Create: `src/domain/model/gamePlayer/gameSeats.ts`, `src/domain/model/gamePlayer/gameSeatsRepository.ts`
- Create: `src/infrastructure/repository/gamePlayer/gameSeatRecord.ts`, `gameSeatGateway.ts`, `gameSeatsMYSQLRepository.ts`
- Test: `test/unit/gameSeats.test.ts`, `test/integration/gameSeatsRepository.test.ts`

**Interfaces:**
- Produces:
  - `interface Seat { disc: Disc; playerId: number }`
  - `class GameSeats { constructor(gameId: number, seats: Seat[]); static forLocalGame(gameId, playerId); gameId; seats: readonly Seat[]; isParticipant(playerId): boolean; discsOf(playerId): Disc[]; mayMove(playerId, nextDisc: Disc | undefined): boolean }`
  - `interface GameSeatsRepository { findForGameId(conn, gameId, options?: { forUpdate: boolean }): Promise<GameSeats | undefined>; save(conn, seats): Promise<void> }`
  - `class GameSeatsMYSQLRepository implements GameSeatsRepository`

- [ ] **Step 1: Write the failing unit test**

`test/unit/gameSeats.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { GameSeats } from "../../src/domain/model/gamePlayer/gameSeats";
import { Disc } from "../../src/domain/model/turn/disc";

describe("GameSeats", () => {
  describe("local game", () => {
    const seats = GameSeats.forLocalGame(7, 1);

    it("seats one player on both colours", () => {
      expect(seats.gameId).toBe(7);
      expect(seats.isParticipant(1)).toBe(true);
      expect(seats.discsOf(1)).toEqual([Disc.Dark, Disc.Light]);
    });

    it("lets that player move either colour", () => {
      expect(seats.mayMove(1, Disc.Dark)).toBe(true);
      expect(seats.mayMove(1, Disc.Light)).toBe(true);
    });

    it("gives nobody else a seat", () => {
      expect(seats.isParticipant(2)).toBe(false);
      expect(seats.discsOf(2)).toEqual([]);
      expect(seats.mayMove(2, Disc.Dark)).toBe(false);
    });

    it("lets nobody move once the game has ended", () => {
      expect(seats.mayMove(1, undefined)).toBe(false);
    });
  });

  describe("two players", () => {
    const seats = new GameSeats(8, [
      { disc: Disc.Light, playerId: 20 },
      { disc: Disc.Dark, playerId: 10 },
    ]);

    it("lets each player move only their own colour", () => {
      expect(seats.mayMove(10, Disc.Dark)).toBe(true);
      expect(seats.mayMove(10, Disc.Light)).toBe(false);
      expect(seats.mayMove(20, Disc.Light)).toBe(true);
      expect(seats.mayMove(20, Disc.Dark)).toBe(false);
      expect(seats.discsOf(20)).toEqual([Disc.Light]);
    });
  });

  describe("invariant", () => {
    it.each([
      ["no seats", []],
      ["one seat", [{ disc: Disc.Dark, playerId: 1 }]],
      ["two dark seats", [{ disc: Disc.Dark, playerId: 1 }, { disc: Disc.Dark, playerId: 2 }]],
      ["a non-playing disc", [{ disc: Disc.Dark, playerId: 1 }, { disc: Disc.Emoty, playerId: 2 }]],
    ])("rejects %s", (_label, seats) => {
      expect(() => new GameSeats(1, seats)).toThrow("exactly one seat for each colour");
    });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `gameSeats`.

- [ ] **Step 3: Implement `src/domain/model/gamePlayer/gameSeats.ts`**

```ts
import { Disc } from "../turn/disc";

export interface Seat {
  disc: Disc;
  playerId: number;
}

const PLAYING_DISCS: Disc[] = [Disc.Dark, Disc.Light];

/**
 * Who sits on which colour in a game, and therefore who may move.
 * A local game seats the same player on both colours.
 */
export class GameSeats {
  private _seats: Seat[];

  constructor(
    private _gameId: number,
    seats: Seat[],
  ) {
    const oneSeatPerColour =
      seats.length === PLAYING_DISCS.length &&
      PLAYING_DISCS.every((disc) => seats.filter((seat) => seat.disc === disc).length === 1);
    // Not a DomainError: seats come from the server itself (a new local game
    // or rows constrained by the schema), so a violation is a server bug.
    if (!oneSeatPerColour) {
      throw new Error(`Game ${_gameId} must have exactly one seat for each colour`);
    }
    this._seats = seats.map((seat) => ({ ...seat }));
  }

  static forLocalGame(gameId: number, playerId: number): GameSeats {
    return new GameSeats(gameId, [
      { disc: Disc.Dark, playerId },
      { disc: Disc.Light, playerId },
    ]);
  }

  get gameId() {
    return this._gameId;
  }

  get seats(): readonly Seat[] {
    return this._seats;
  }

  isParticipant(playerId: number): boolean {
    return this._seats.some((seat) => seat.playerId === playerId);
  }

  discsOf(playerId: number): Disc[] {
    return this._seats
      .filter((seat) => seat.playerId === playerId)
      .map((seat) => seat.disc)
      .sort((a, b) => a - b);
  }

  /** `nextDisc` is undefined once the game has ended, and then nobody may move. */
  mayMove(playerId: number, nextDisc: Disc | undefined): boolean {
    if (nextDisc === undefined) {
      return false;
    }
    return this._seats.some((seat) => seat.disc === nextDisc && seat.playerId === playerId);
  }
}
```

- [ ] **Step 4: Implement `src/domain/model/gamePlayer/gameSeatsRepository.ts`**

```ts
import mysql from "mysql2/promise";
import { GameSeats } from "./gameSeats";

export interface GameSeatsRepository {
  /** Undefined when the game has no seats (a pre-Phase-1 game, or no such game). */
  findForGameId(
    conn: mysql.Connection,
    gameId: number,
    options?: { forUpdate: boolean },
  ): Promise<GameSeats | undefined>;

  save(conn: mysql.Connection, seats: GameSeats): Promise<void>;
}
```

- [ ] **Step 5: Run the unit test**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Write the failing integration test**

`test/integration/gameSeatsRepository.test.ts`:

```ts
import { randomBytes } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { closePool, connectMySQL } from "../../src/infrastructure/connection";
import { GameSeatsMYSQLRepository } from "../../src/infrastructure/repository/gamePlayer/gameSeatsMYSQLRepository";
import { GameMYSQLRepository } from "../../src/infrastructure/repository/game/gameMYSQLRepository";
import { GameSeats } from "../../src/domain/model/gamePlayer/gameSeats";
import { Game } from "../../src/domain/model/game/game";
import { Disc } from "../../src/domain/model/turn/disc";

const repository = new GameSeatsMYSQLRepository();
let conn: mysql.Connection;

async function insertPlayer(): Promise<number> {
  const [result] = await conn.execute<mysql.ResultSetHeader>(
    "insert into players (token_hash, display_name) values (?, 'Guest 1000')",
    [randomBytes(32)],
  );
  return result.insertId;
}

async function insertGame(): Promise<number> {
  const game = await new GameMYSQLRepository().save(conn, new Game(undefined, new Date()));
  return game.id!;
}

beforeEach(async () => {
  conn = await connectMySQL();
});

afterEach(async () => {
  await conn.end();
});

afterAll(async () => {
  await closePool();
});

describe("GameSeatsMYSQLRepository", () => {
  it("saves and reads back a local game's seats", async () => {
    const playerId = await insertPlayer();
    const gameId = await insertGame();

    await repository.save(conn, GameSeats.forLocalGame(gameId, playerId));
    const seats = await repository.findForGameId(conn, gameId);

    expect(seats?.discsOf(playerId)).toEqual([Disc.Dark, Disc.Light]);
  });

  it("reads seats with a row lock inside a transaction", async () => {
    const playerId = await insertPlayer();
    const gameId = await insertGame();
    await repository.save(conn, GameSeats.forLocalGame(gameId, playerId));

    await conn.beginTransaction();
    const seats = await repository.findForGameId(conn, gameId, { forUpdate: true });
    await conn.rollback();

    expect(seats?.isParticipant(playerId)).toBe(true);
  });

  it("returns undefined for a game without seats and for an unknown game", async () => {
    const gameId = await insertGame();

    expect(await repository.findForGameId(conn, gameId)).toBeUndefined();
    expect(await repository.findForGameId(conn, 2147483647)).toBeUndefined();
  });

  it("rejects a game with a single seat as a server fault", async () => {
    const playerId = await insertPlayer();
    const gameId = await insertGame();
    await conn.execute("insert into game_players (game_id, disc, player_id) values (?, 1, ?)", [
      gameId,
      playerId,
    ]);

    await expect(repository.findForGameId(conn, gameId)).rejects.toThrow("exactly one seat");
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npm run test:integration`
Expected: FAIL — cannot resolve `gameSeatsMYSQLRepository`.

- [ ] **Step 8: Implement the infrastructure files**

`src/infrastructure/repository/gamePlayer/gameSeatRecord.ts`:

```ts
export class GameSeatRecord {
  constructor(
    private _gameId: number,
    private _disc: number,
    private _playerId: number,
  ) {}

  get gameId() {
    return this._gameId;
  }

  get disc() {
    return this._disc;
  }

  get playerId() {
    return this._playerId;
  }
}
```

`src/infrastructure/repository/gamePlayer/gameSeatGateway.ts`:

```ts
import mysql from "mysql2/promise";
import { GameSeatRecord } from "./gameSeatRecord";

export class GameSeatGateway {
  async findForGameId(
    conn: mysql.Connection,
    gameId: number,
    forUpdate: boolean,
  ): Promise<GameSeatRecord[]> {
    const sql =
      "select game_id, disc, player_id from game_players where game_id = ? order by disc" +
      (forUpdate ? " for update" : "");
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(sql, [gameId]);

    return rows.map((r) => new GameSeatRecord(r["game_id"], r["disc"], r["player_id"]));
  }

  /** One multi-row insert, so a game never ends up with only some of its seats. */
  async insertAll(
    conn: mysql.Connection,
    gameId: number,
    seats: readonly { disc: number; playerId: number }[],
  ) {
    const sql =
      "insert into game_players (game_id, disc, player_id) values " +
      seats.map(() => "(?, ?, ?)").join(", ");
    const values = seats.flatMap((seat) => [gameId, seat.disc, seat.playerId]);

    await conn.execute(sql, values);
  }
}
```

`src/infrastructure/repository/gamePlayer/gameSeatsMYSQLRepository.ts`:

```ts
import mysql from "mysql2/promise";
import { GameSeats } from "../../../domain/model/gamePlayer/gameSeats";
import { GameSeatsRepository } from "../../../domain/model/gamePlayer/gameSeatsRepository";
import { toDisc } from "../../../domain/model/turn/disc";
import { GameSeatGateway } from "./gameSeatGateway";

const gameSeatGateway = new GameSeatGateway();

export class GameSeatsMYSQLRepository implements GameSeatsRepository {
  async findForGameId(
    conn: mysql.Connection,
    gameId: number,
    options: { forUpdate: boolean } = { forUpdate: false },
  ): Promise<GameSeats | undefined> {
    const records = await gameSeatGateway.findForGameId(conn, gameId, options.forUpdate);

    // No rows: a game created before Phase 1, or no such game. Callers treat
    // both as "not found"; GameSeats is never built from an empty set.
    if (records.length === 0) {
      return undefined;
    }

    return new GameSeats(
      gameId,
      records.map((r) => ({ disc: toDisc(r.disc), playerId: r.playerId })),
    );
  }

  async save(conn: mysql.Connection, seats: GameSeats) {
    await gameSeatGateway.insertAll(conn, seats.gameId, seats.seats);
  }
}
```

- [ ] **Step 9: Run all suites**

Run: `npx tsc --noEmit && npm test && npm run test:integration`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add src/domain/model/gamePlayer src/infrastructure/repository/gamePlayer test/unit/gameSeats.test.ts test/integration/gameSeatsRepository.test.ts
git commit -m "Add GameSeats: who sits on which colour and may move

A local game seats one player on both colours. The repository returns
undefined for games without seats (pre-Phase-1 games and unknown IDs)
and writes both seats in one insert."
```

---

### Task 5: Guest players (application and infrastructure)

**Files:**
- Create: `src/application/identity/player.ts`, `playerRepository.ts`, `playerToken.ts`, `guestName.ts`
- Create: `src/application/query/rateLimitQueryService.ts`, `src/infrastructure/query/rateLimitMYSQLQueryService.ts`
- Create: `src/infrastructure/repository/player/playerRecord.ts`, `playerGateway.ts`, `playerMYSQLRepository.ts`
- Create: `src/application/useCase/registerGuestUseCase.ts`, `findPlayerByTokenUseCase.ts`
- Modify: `src/application/error/applicationError.ts`, `src/presentation/errorHandler.ts`
- Test: `test/unit/playerToken.test.ts`, `test/unit/guestName.test.ts`, `test/integration/guests.test.ts`

**Interfaces:**
- Produces:
  - `interface Player { id: number; displayName: string }`
  - `interface PlayerRepository { findByTokenHash(conn, tokenHash: Buffer): Promise<Player | undefined>; insert(conn, tokenHash: Buffer, displayName: string, createdIpHash: Buffer): Promise<Player>; lockForUpdate(conn, playerId: number): Promise<void> }`
  - `generatePlayerToken(): string`, `hashPlayerToken(token: string): Buffer`, `isWellFormedPlayerToken(value: unknown): value is string`
  - `generateGuestName(random?: (min: number, max: number) => number): string`
  - `interface RateLimitQueryService { countGuestsCreatedInLastHour(conn, ipHash: Buffer): Promise<number>; countGamesCreatedInLastHour(conn, playerId: number): Promise<number> }`
  - `const GUESTS_PER_IP_PER_HOUR = 20`; `RegisterGuestUseCase(playerRepository, rateLimitQuery).run(clientIpHash: Buffer): Promise<{ player: Player; token: string }>`
  - `FindPlayerByTokenUseCase(playerRepository).run(token: string): Promise<Player | undefined>`
  - `ApplicationErrorType` gains `"GuestCreationLimitReached"` (429) and `"PlayerNotFound"` (404)

- [ ] **Step 1: Write the failing unit tests**

`test/unit/playerToken.test.ts`:

```ts
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  generatePlayerToken,
  hashPlayerToken,
  isWellFormedPlayerToken,
} from "../../src/application/identity/playerToken";

describe("player tokens", () => {
  it("are 43-character base64url strings and unique", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generatePlayerToken()));

    expect(tokens.size).toBe(100);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(isWellFormedPlayerToken(token)).toBe(true);
    }
  });

  it("hash to SHA-256", () => {
    const token = generatePlayerToken();
    expect(hashPlayerToken(token).equals(createHash("sha256").update(token).digest())).toBe(true);
  });

  it.each(["", "short", "a".repeat(44), "a".repeat(42) + "!", undefined, 42])(
    "reject malformed value %s",
    (value) => {
      expect(isWellFormedPlayerToken(value)).toBe(false);
    },
  );
});
```

`test/unit/guestName.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { generateGuestName } from "../../src/application/identity/guestName";

describe("generateGuestName", () => {
  it("formats the number drawn from 1000 to 9999", () => {
    const calls: [number, number][] = [];
    const name = generateGuestName((min, max) => {
      calls.push([min, max]);
      return 4821;
    });

    expect(name).toBe("Guest 4821");
    expect(calls).toEqual([[1000, 10000]]);
  });

  it("uses a secure random source by default", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateGuestName()).toMatch(/^Guest [1-9][0-9]{3}$/);
    }
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `playerToken`, `guestName`.

- [ ] **Step 3: Implement the identity helpers**

`src/application/identity/player.ts`:

```ts
export interface Player {
  id: number;
  displayName: string;
}
```

`src/application/identity/playerToken.ts`:

```ts
import { createHash, randomBytes } from "node:crypto";

const TOKEN_BYTES = 32;
const PLAYER_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** The secret a guest's browser holds in its cookie. */
export function generatePlayerToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** Only this hash is stored, so a database leak cannot be used to impersonate players. */
export function hashPlayerToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

export function isWellFormedPlayerToken(value: unknown): value is string {
  return typeof value === "string" && PLAYER_TOKEN_PATTERN.test(value);
}
```

`src/application/identity/guestName.ts`:

```ts
import { randomInt } from "node:crypto";

/** "Guest 1000" to "Guest 9999". Not unique; the player ID identifies a guest. */
export function generateGuestName(
  random: (min: number, max: number) => number = randomInt,
): string {
  return `Guest ${random(1000, 10000)}`;
}
```

`src/application/identity/playerRepository.ts`:

```ts
import mysql from "mysql2/promise";
import { Player } from "./player";

export interface PlayerRepository {
  findByTokenHash(conn: mysql.Connection, tokenHash: Buffer): Promise<Player | undefined>;

  insert(
    conn: mysql.Connection,
    tokenHash: Buffer,
    displayName: string,
    createdIpHash: Buffer,
  ): Promise<Player>;

  /** Locks the player's row for the rest of the transaction. */
  lockForUpdate(conn: mysql.Connection, playerId: number): Promise<void>;
}
```

`src/application/query/rateLimitQueryService.ts`:

```ts
import mysql from "mysql2/promise";

// Both windows are measured with the database clock on both sides of the
// comparison, so they do not depend on the app's time zone.
export interface RateLimitQueryService {
  countGuestsCreatedInLastHour(conn: mysql.Connection, ipHash: Buffer): Promise<number>;
  countGamesCreatedInLastHour(conn: mysql.Connection, playerId: number): Promise<number>;
}
```

- [ ] **Step 4: Run the unit tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Write the failing integration test**

`test/integration/guests.test.ts`:

```ts
import { createHash, randomBytes } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePool } from "../../src/infrastructure/connection";
import { RegisterGuestUseCase, GUESTS_PER_IP_PER_HOUR } from "../../src/application/useCase/registerGuestUseCase";
import { FindPlayerByTokenUseCase } from "../../src/application/useCase/findPlayerByTokenUseCase";
import { PlayerMYSQLRepository } from "../../src/infrastructure/repository/player/playerMYSQLRepository";
import { RateLimitMySQLQueryService } from "../../src/infrastructure/query/rateLimitMYSQLQueryService";
import { ApplicationError } from "../../src/application/error/applicationError";
import { generatePlayerToken } from "../../src/application/identity/playerToken";
import { adminConnection } from "./helpers";

const registerGuest = new RegisterGuestUseCase(new PlayerMYSQLRepository(), new RateLimitMySQLQueryService());
const findPlayerByToken = new FindPlayerByTokenUseCase(new PlayerMYSQLRepository());

let admin: mysql.Connection;

beforeAll(async () => {
  admin = await adminConnection();
  await admin.query("use reversi_test");
});

afterAll(async () => {
  await closePool();
  await admin.end();
});

// Each test uses its own IP hash so the per-IP cap is never shared.
const freshIpHash = () => randomBytes(32);

async function insertGuestsFromIp(ipHash: Buffer, count: number, createdAt = "current_timestamp(3)") {
  for (let i = 0; i < count; i++) {
    await admin.execute(
      `insert into players (token_hash, display_name, created_ip_hash, created_at) values (?, 'Guest 1000', ?, ${createdAt})`,
      [randomBytes(32), ipHash],
    );
  }
}

describe("guest players", () => {
  it("registers a guest that can be found by its token", async () => {
    const { player, token } = await registerGuest.run(freshIpHash());

    expect(player.displayName).toMatch(/^Guest [1-9][0-9]{3}$/);
    expect(await findPlayerByToken.run(token)).toEqual(player);
  });

  it("stores only the token's hash", async () => {
    const { player, token } = await registerGuest.run(freshIpHash());

    const [rows] = await admin.query<mysql.RowDataPacket[]>("select * from players where id = ?", [player.id]);
    expect(Buffer.from(rows[0].token_hash).equals(createHash("sha256").update(token).digest())).toBe(true);
    expect(JSON.stringify(rows[0])).not.toContain(token);
  });

  it("returns undefined for malformed and unknown tokens", async () => {
    expect(await findPlayerByToken.run("not-a-token")).toBeUndefined();
    expect(await findPlayerByToken.run(generatePlayerToken())).toBeUndefined();
  });

  it(`refuses the ${GUESTS_PER_IP_PER_HOUR + 1}st guest from one IP within an hour`, async () => {
    const ipHash = freshIpHash();
    await insertGuestsFromIp(ipHash, GUESTS_PER_IP_PER_HOUR);

    const error = await registerGuest.run(ipHash).catch((e) => e);

    expect(error).toBeInstanceOf(ApplicationError);
    expect((error as ApplicationError).type).toBe("GuestCreationLimitReached");
  });

  it("does not count guests created more than an hour ago", async () => {
    const ipHash = freshIpHash();
    await insertGuestsFromIp(ipHash, GUESTS_PER_IP_PER_HOUR, "current_timestamp(3) - interval 2 hour");

    await expect(registerGuest.run(ipHash)).resolves.toBeDefined();
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npm run test:integration`
Expected: FAIL — cannot resolve `registerGuestUseCase`.

- [ ] **Step 7: Add the error types**

In `src/application/error/applicationError.ts`, replace

```ts
export type ApplicationErrorType = "LatestGameNotFound";
```

with

```ts
export type ApplicationErrorType =
  | "LatestGameNotFound"
  | "PlayerNotFound"
  | "GuestCreationLimitReached";
```

In `src/presentation/errorHandler.ts`, replace the status map with:

```ts
export const APPLICATION_ERROR_STATUS: Record<ApplicationErrorType, number> = {
  LatestGameNotFound: 404,
  PlayerNotFound: 404,
  GuestCreationLimitReached: 429,
};
```

- [ ] **Step 8: Implement the player infrastructure**

`src/infrastructure/repository/player/playerRecord.ts`:

```ts
export class PlayerRecord {
  constructor(
    private _id: number,
    private _displayName: string,
  ) {}

  get id() {
    return this._id;
  }

  get displayName() {
    return this._displayName;
  }
}
```

`src/infrastructure/repository/player/playerGateway.ts`:

```ts
import mysql from "mysql2/promise";
import { PlayerRecord } from "./playerRecord";

export class PlayerGateway {
  async findByTokenHash(conn: mysql.Connection, tokenHash: Buffer): Promise<PlayerRecord | undefined> {
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      "select id, display_name from players where token_hash = ?",
      [tokenHash],
    );
    const record = rows[0];
    if (!record) {
      return undefined;
    }
    return new PlayerRecord(record["id"], record["display_name"]);
  }

  async insert(
    conn: mysql.Connection,
    tokenHash: Buffer,
    displayName: string,
    createdIpHash: Buffer,
  ): Promise<PlayerRecord> {
    const [result] = await conn.execute<mysql.ResultSetHeader>(
      "insert into players (token_hash, display_name, created_ip_hash) values (?, ?, ?)",
      [tokenHash, displayName, createdIpHash],
    );
    return new PlayerRecord(result.insertId, displayName);
  }

  async lockForUpdate(conn: mysql.Connection, playerId: number): Promise<boolean> {
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      "select id from players where id = ? for update",
      [playerId],
    );
    return rows.length > 0;
  }
}
```

`src/infrastructure/repository/player/playerMYSQLRepository.ts`:

```ts
import mysql from "mysql2/promise";
import { Player } from "../../../application/identity/player";
import { PlayerRepository } from "../../../application/identity/playerRepository";
import { PlayerGateway } from "./playerGateway";

const playerGateway = new PlayerGateway();

export class PlayerMYSQLRepository implements PlayerRepository {
  async findByTokenHash(conn: mysql.Connection, tokenHash: Buffer): Promise<Player | undefined> {
    const record = await playerGateway.findByTokenHash(conn, tokenHash);
    if (!record) {
      return undefined;
    }
    return { id: record.id, displayName: record.displayName };
  }

  async insert(
    conn: mysql.Connection,
    tokenHash: Buffer,
    displayName: string,
    createdIpHash: Buffer,
  ): Promise<Player> {
    const record = await playerGateway.insert(conn, tokenHash, displayName, createdIpHash);
    return { id: record.id, displayName: record.displayName };
  }

  async lockForUpdate(conn: mysql.Connection, playerId: number) {
    // Players are never deleted, and callers only pass IDs they just resolved.
    if (!(await playerGateway.lockForUpdate(conn, playerId))) {
      throw new Error(`Player ${playerId} does not exist`);
    }
  }
}
```

`src/infrastructure/query/rateLimitMYSQLQueryService.ts`:

```ts
import mysql from "mysql2/promise";
import { RateLimitQueryService } from "../../application/query/rateLimitQueryService";

export class RateLimitMySQLQueryService implements RateLimitQueryService {
  async countGuestsCreatedInLastHour(conn: mysql.Connection, ipHash: Buffer): Promise<number> {
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      `select count(*) as n from players
        where created_ip_hash = ? and created_at > current_timestamp(3) - interval 1 hour`,
      [ipHash],
    );
    return Number(rows[0].n);
  }

  async countGamesCreatedInLastHour(conn: mysql.Connection, playerId: number): Promise<number> {
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      `select count(distinct game_id) as n from game_players
        where player_id = ? and created_at > current_timestamp(3) - interval 1 hour`,
      [playerId],
    );
    return Number(rows[0].n);
  }
}
```

- [ ] **Step 9: Implement the use cases**

`src/application/useCase/registerGuestUseCase.ts`:

```ts
import { connectMySQL } from "../../infrastructure/connection";
import { ApplicationError } from "../error/applicationError";
import { Player } from "../identity/player";
import { PlayerRepository } from "../identity/playerRepository";
import { generatePlayerToken, hashPlayerToken } from "../identity/playerToken";
import { generateGuestName } from "../identity/guestName";
import { RateLimitQueryService } from "../query/rateLimitQueryService";

export const GUESTS_PER_IP_PER_HOUR = 20;

export interface RegisteredGuest {
  player: Player;
  /** Returned once, for the cookie; only its hash is stored. */
  token: string;
}

export class RegisterGuestUseCase {
  constructor(
    private _playerRepository: PlayerRepository,
    private _rateLimitQuery: RateLimitQueryService,
  ) {}

  async run(clientIpHash: Buffer): Promise<RegisteredGuest> {
    const conn = await connectMySQL();
    try {
      // Not locked: concurrent requests from one IP can overshoot the cap by
      // at most the number in flight, which is acceptable here.
      const recent = await this._rateLimitQuery.countGuestsCreatedInLastHour(conn, clientIpHash);
      if (recent >= GUESTS_PER_IP_PER_HOUR) {
        throw new ApplicationError(
          "GuestCreationLimitReached",
          "Too many new players from this network. Try again later.",
        );
      }

      const token = generatePlayerToken();
      const player = await this._playerRepository.insert(
        conn,
        hashPlayerToken(token),
        generateGuestName(),
        clientIpHash,
      );
      return { player, token };
    } finally {
      await conn.end();
    }
  }
}
```

`src/application/useCase/findPlayerByTokenUseCase.ts`:

```ts
import { connectMySQL } from "../../infrastructure/connection";
import { Player } from "../identity/player";
import { PlayerRepository } from "../identity/playerRepository";
import { hashPlayerToken, isWellFormedPlayerToken } from "../identity/playerToken";

export class FindPlayerByTokenUseCase {
  constructor(private _playerRepository: PlayerRepository) {}

  async run(token: string): Promise<Player | undefined> {
    // Malformed cookie values never reach the database.
    if (!isWellFormedPlayerToken(token)) {
      return undefined;
    }

    const conn = await connectMySQL();
    try {
      return await this._playerRepository.findByTokenHash(conn, hashPlayerToken(token));
    } finally {
      await conn.end();
    }
  }
}
```

- [ ] **Step 10: Run all suites**

Run: `npx tsc --noEmit && npm test && npm run test:integration`
Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add src/application/identity src/application/query/rateLimitQueryService.ts src/application/useCase/registerGuestUseCase.ts src/application/useCase/findPlayerByTokenUseCase.ts src/infrastructure/repository/player src/infrastructure/query/rateLimitMYSQLQueryService.ts src/application/error/applicationError.ts src/presentation/errorHandler.ts test/unit/playerToken.test.ts test/unit/guestName.test.ts test/integration/guests.test.ts
git commit -m "Register guest players with hashed tokens and a per-IP cap

A guest gets a random 32-byte token (only its SHA-256 is stored) and a
'Guest NNNN' name. At most 20 guests per IP hash per rolling hour,
measured with the database clock."
```

---

### Task 6: Identity over HTTP — cookie, `attachPlayer`, `GET /api/me`

**Files:**
- Create: `src/presentation/identity/identityConfig.ts`, `clientIp.ts`, `playerCookie.ts`
- Create: `src/presentation/middleware/identity.ts`, `src/presentation/meRouter.ts`
- Modify: `src/main.ts`, `package.json` / `package-lock.json`, `.env.example`, local `.env` (not committed)
- Test: `test/unit/identityConfig.test.ts`, `test/unit/clientIp.test.ts`, `test/unit/playerCookie.test.ts`, `test/integration/identityApi.test.ts`

**Interfaces:**
- Consumes: `RegisterGuestUseCase`, `FindPlayerByTokenUseCase`, `Player` (Task 5); `Guest`, `startTestServer` (Task 3).
- Produces:
  - `loadIdentityConfig(env): { ipHashSecret: string; onVercel: boolean }`
  - `clientIpOf(req, onVercel: boolean): string`, `hashClientIp(ip: string, secret: string): Buffer`
  - `playerCookieName(onVercel?: boolean): string`, `readPlayerToken(req): string | undefined`, `setPlayerCookie(res, token): void`
  - `attachPlayer` middleware; `currentPlayer(res): Player | undefined`; `ensurePlayer(req, res): Promise<Player>`
  - `meRouter` (`GET /api/me`)

- [ ] **Step 1: Install cookie-parser and add the secret**

Run: `npm install cookie-parser@^1.4.7 && npm install -D @types/cookie-parser@^1.4.10`

Append to `.env.example`:

```bash

# Secret for hashing client IPs (used by the new-guest cap). Required.
# On Vercel, use at least 32 random characters: openssl rand -base64 48
IP_HASH_SECRET=local-development-only
```

Append the same `IP_HASH_SECRET=local-development-only` line to your local `.env` (gitignored).

- [ ] **Step 2: Write the failing unit tests**

`test/unit/identityConfig.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { loadIdentityConfig } from "../../src/presentation/identity/identityConfig";

describe("loadIdentityConfig", () => {
  it("requires IP_HASH_SECRET", () => {
    expect(() => loadIdentityConfig({})).toThrow("IP_HASH_SECRET");
  });

  it("accepts a short secret locally", () => {
    expect(loadIdentityConfig({ IP_HASH_SECRET: "dev" })).toEqual({ ipHashSecret: "dev", onVercel: false });
  });

  it("requires 32 characters on Vercel and never echoes the value", () => {
    let message = "";
    try {
      loadIdentityConfig({ VERCEL: "1", IP_HASH_SECRET: "too-short-secret" });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("at least 32");
    expect(message).not.toContain("too-short-secret");
  });

  it("accepts a long secret on Vercel", () => {
    const secret = "x".repeat(32);
    expect(loadIdentityConfig({ VERCEL: "1", IP_HASH_SECRET: secret })).toEqual({
      ipHashSecret: secret,
      onVercel: true,
    });
  });
});
```

`test/unit/clientIp.test.ts`:

```ts
import express from "express";
import { describe, expect, it } from "vitest";
import { clientIpOf, hashClientIp } from "../../src/presentation/identity/clientIp";

function request(headers: Record<string, string>, remoteAddress = "10.0.0.5"): express.Request {
  return { headers, socket: { remoteAddress } } as unknown as express.Request;
}

describe("clientIpOf", () => {
  it("uses x-real-ip on Vercel", () => {
    expect(clientIpOf(request({ "x-real-ip": "203.0.113.7" }), true)).toBe("203.0.113.7");
  });

  it("ignores forwarding headers outside Vercel", () => {
    const req = request({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" });
    expect(clientIpOf(req, false)).toBe("10.0.0.5");
  });

  it("falls back to the socket address when the header is missing", () => {
    expect(clientIpOf(request({}), true)).toBe("10.0.0.5");
  });
});

describe("hashClientIp", () => {
  it("is deterministic for one secret and differs across secrets", () => {
    expect(hashClientIp("203.0.113.7", "a").equals(hashClientIp("203.0.113.7", "a"))).toBe(true);
    expect(hashClientIp("203.0.113.7", "a").equals(hashClientIp("203.0.113.7", "b"))).toBe(false);
    expect(hashClientIp("203.0.113.7", "a")).toHaveLength(32);
  });
});
```

`test/unit/playerCookie.test.ts`:

```ts
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { playerCookieName, setPlayerCookie } from "../../src/presentation/identity/playerCookie";

function captureCookie(): { name?: string; value?: string; options?: express.CookieOptions; res: express.Response } {
  const captured: { name?: string; value?: string; options?: express.CookieOptions; res: express.Response } = {
    res: undefined as unknown as express.Response,
  };
  captured.res = {
    cookie(name: string, value: string, options: express.CookieOptions) {
      Object.assign(captured, { name, value, options });
      return captured.res;
    },
  } as unknown as express.Response;
  return captured;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("player cookie", () => {
  it("is a plain, non-Secure cookie locally", () => {
    vi.stubEnv("VERCEL", "");
    const captured = captureCookie();

    setPlayerCookie(captured.res, "token");

    expect(playerCookieName()).toBe("rv_player");
    expect(captured).toMatchObject({
      name: "rv_player",
      value: "token",
      options: { httpOnly: true, sameSite: "lax", secure: false, path: "/", maxAge: 400 * 24 * 60 * 60 * 1000 },
    });
  });

  it("uses the __Host- prefix and Secure on Vercel", () => {
    vi.stubEnv("VERCEL", "1");
    const captured = captureCookie();

    setPlayerCookie(captured.res, "token");

    expect(playerCookieName()).toBe("__Host-rv_player");
    expect(captured).toMatchObject({ name: "__Host-rv_player", options: { secure: true, path: "/" } });
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `identityConfig`, `clientIp`, `playerCookie`.

- [ ] **Step 4: Implement the presentation identity helpers**

`src/presentation/identity/identityConfig.ts`:

```ts
export interface IdentityConfig {
  ipHashSecret: string;
  onVercel: boolean;
}

const MIN_SECRET_LENGTH_ON_VERCEL = 32;

/** Read on first guest creation, so a missing secret fails that request only. */
export function loadIdentityConfig(env: NodeJS.ProcessEnv): IdentityConfig {
  const secret = env.IP_HASH_SECRET;
  if (!secret) {
    throw new Error("Missing required environment variable IP_HASH_SECRET");
  }
  const onVercel = Boolean(env.VERCEL);
  if (onVercel && secret.length < MIN_SECRET_LENGTH_ON_VERCEL) {
    throw new Error(`IP_HASH_SECRET must be at least ${MIN_SECRET_LENGTH_ON_VERCEL} characters on Vercel`);
  }
  return { ipHashSecret: secret, onVercel };
}
```

`src/presentation/identity/clientIp.ts`:

```ts
import { createHmac } from "node:crypto";
import express from "express";

/**
 * Vercel overwrites X-Forwarded-For and sets x-real-ip to the same value, so
 * the header can be trusted there. Anywhere else forwarding headers are
 * client-controlled, and the socket address is used.
 */
export function clientIpOf(req: express.Request, onVercel: boolean): string {
  if (onVercel) {
    const header = req.headers["x-real-ip"];
    if (typeof header === "string" && header !== "") {
      return header;
    }
  }
  return req.socket.remoteAddress ?? "unknown";
}

/** Keyed so the stored value cannot be reversed by hashing every IPv4 address. */
export function hashClientIp(ip: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(ip).digest();
}
```

`src/presentation/identity/playerCookie.ts`:

```ts
import express from "express";

// Browsers cap cookie lifetime at 400 days.
const MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000;

// The __Host- prefix requires Secure, which plain-http localhost cannot use
// reliably, so it is only used on Vercel.
export function playerCookieName(onVercel = Boolean(process.env.VERCEL)): string {
  return onVercel ? "__Host-rv_player" : "rv_player";
}

export function readPlayerToken(req: express.Request): string | undefined {
  const value = req.cookies?.[playerCookieName()];
  return typeof value === "string" ? value : undefined;
}

export function setPlayerCookie(res: express.Response, token: string) {
  const onVercel = Boolean(process.env.VERCEL);
  res.cookie(playerCookieName(onVercel), token, {
    httpOnly: true,
    sameSite: "lax",
    secure: onVercel,
    path: "/",
    maxAge: MAX_AGE_MS,
  });
}
```

- [ ] **Step 5: Run the unit tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Write the failing integration test**

`test/integration/identityApi.test.ts`:

```ts
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../../src/main";
import { closePool } from "../../src/infrastructure/connection";
import { RegisterGuestUseCase } from "../../src/application/useCase/registerGuestUseCase";
import { PlayerMYSQLRepository } from "../../src/infrastructure/repository/player/playerMYSQLRepository";
import { RateLimitMySQLQueryService } from "../../src/infrastructure/query/rateLimitMYSQLQueryService";
import { generatePlayerToken } from "../../src/application/identity/playerToken";
import { Guest, startTestServer, TestServer } from "./apiClient";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer(app);
});

afterAll(async () => {
  await server.close();
  await closePool();
});

describe("GET /api/me", () => {
  it("returns 404 without a cookie", async () => {
    const response = await new Guest(server).get("/api/me");

    expect(response.status).toBe(404);
    expect(response.body.type).toBe("PlayerNotFound");
  });

  it("returns the guest's display name with a valid cookie", async () => {
    const registered = await new RegisterGuestUseCase(
      new PlayerMYSQLRepository(),
      new RateLimitMySQLQueryService(),
    ).run(randomBytes(32));
    const guest = new Guest(server);
    guest.cookie = `rv_player=${registered.token}`;

    const response = await guest.get("/api/me");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ displayName: registered.player.displayName });
  });

  it.each([
    ["a garbage value", "not-a-token; drop table players"],
    ["a well-formed token with no player", generatePlayerToken()],
  ])("treats %s as no cookie", async (_label, value) => {
    const guest = new Guest(server);
    guest.cookie = `rv_player=${encodeURIComponent(value)}`;

    const response = await guest.get("/api/me");

    expect(response.status).toBe(404);
    expect(response.body.type).toBe("PlayerNotFound");
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npm run test:integration`
Expected: FAIL — `GET /api/me` returns 404 with no JSON `type` (no route yet).

- [ ] **Step 8: Implement the middleware and router**

`src/presentation/middleware/identity.ts`:

```ts
import express from "express";
import { Player } from "../../application/identity/player";
import { FindPlayerByTokenUseCase } from "../../application/useCase/findPlayerByTokenUseCase";
import { RegisterGuestUseCase } from "../../application/useCase/registerGuestUseCase";
import { PlayerMYSQLRepository } from "../../infrastructure/repository/player/playerMYSQLRepository";
import { RateLimitMySQLQueryService } from "../../infrastructure/query/rateLimitMYSQLQueryService";
import { loadIdentityConfig } from "../identity/identityConfig";
import { clientIpOf, hashClientIp } from "../identity/clientIp";
import { readPlayerToken, setPlayerCookie } from "../identity/playerCookie";

const findPlayerByTokenUseCase = new FindPlayerByTokenUseCase(new PlayerMYSQLRepository());
const registerGuestUseCase = new RegisterGuestUseCase(
  new PlayerMYSQLRepository(),
  new RateLimitMySQLQueryService(),
);

/** Resolves the player from the cookie, if there is a valid one. Never creates one. */
export async function attachPlayer(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  const token = readPlayerToken(req);
  if (token !== undefined) {
    const player = await findPlayerByTokenUseCase.run(token);
    if (player) {
      res.locals.player = player;
    }
  }
  next();
}

export function currentPlayer(res: express.Response): Player | undefined {
  return res.locals.player as Player | undefined;
}

/** The current player, registering a new guest (and setting its cookie) if there is none. */
export async function ensurePlayer(req: express.Request, res: express.Response): Promise<Player> {
  const existing = currentPlayer(res);
  if (existing) {
    return existing;
  }

  const config = loadIdentityConfig(process.env);
  const ipHash = hashClientIp(clientIpOf(req, config.onVercel), config.ipHashSecret);
  const { player, token } = await registerGuestUseCase.run(ipHash);

  setPlayerCookie(res, token);
  res.locals.player = player;
  return player;
}
```

`src/presentation/meRouter.ts`:

```ts
import express from "express";
import { ApplicationError } from "../application/error/applicationError";
import { currentPlayer } from "./middleware/identity";

export const meRouter = express.Router();

interface GetMeResponseBody {
  displayName: string;
}

meRouter.get("/api/me", (req, res: express.Response<GetMeResponseBody>) => {
  const player = currentPlayer(res);
  if (!player) {
    throw new ApplicationError("PlayerNotFound", "This browser has no player yet");
  }
  res.json({ displayName: player.displayName });
});
```

In `src/main.ts`:
- add `import cookieParser from "cookie-parser";` after `import "express-async-errors";`
- add `import { meRouter } from "./presentation/meRouter";` after the `turnRouter` import
- add `import { attachPlayer } from "./presentation/middleware/identity";` after the `meRouter` import
- after `app.use(express.json());` add:

```ts
app.use(cookieParser());
app.use("/api", attachPlayer);
```

- after `app.use(turnRouter);` add `app.use(meRouter);`

- [ ] **Step 9: Run all suites**

Run: `npx tsc --noEmit && npm test && npm run test:integration`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add src/presentation/identity src/presentation/middleware/identity.ts src/presentation/meRouter.ts src/main.ts package.json package-lock.json .env.example test/unit/identityConfig.test.ts test/unit/clientIp.test.ts test/unit/playerCookie.test.ts test/integration/identityApi.test.ts
git commit -m "Resolve the player from an httpOnly cookie and add GET /api/me

attachPlayer looks up the player for a well-formed token and never
creates one. ensurePlayer registers a guest, keyed by an HMAC of the
client IP (x-real-ip on Vercel only), and sets the cookie."
```

---

### Task 7: Game use cases — create, read, move

**Files:**
- Create: `src/application/query/latestTurnQueryService.ts`, `src/infrastructure/query/latestTurnMYSQLQueryService.ts`
- Create: `src/application/useCase/createLocalGameUseCase.ts`, `findGameStateUseCase.ts`, `registerMoveUseCase.ts`
- Modify: `src/application/error/applicationError.ts`, `src/presentation/errorHandler.ts`
- Test: `test/integration/gameUseCases.test.ts`

**Interfaces:**
- Consumes: `GameSeats`, `GameSeatsMYSQLRepository` (Task 4); `PlayerRepository`, `RateLimitQueryService`, `RegisterGuestUseCase` (Task 5); existing `GameRepository`, `TurnRepository`, `GameResultRepository`, `firstTurn`, `Turn`, `GameResult`.
- Produces:
  - `interface LatestTurnQueryService { findLatestTurnCount(conn, gameId): Promise<number | undefined> }`
  - `const GAMES_PER_PLAYER_PER_HOUR = 10`
  - `CreateLocalGameUseCase(gameRepository, turnRepository, gameSeatsRepository, playerRepository, rateLimitQuery).run(playerId): Promise<number>`
  - `interface GameStateOutput { gameId: number; turnCount: number; board: Disc[][]; nextDisc: Disc | undefined; winnerDisc: WinnerDisc | undefined; yourDiscs: Disc[] }`, `toGameState(turn, seats, playerId, winnerDisc)`
  - `FindGameStateUseCase(turnRepository, gameResultRepository, gameSeatsRepository, latestTurnQuery).run(gameId, playerId): Promise<GameStateOutput>`
  - `RegisterMoveUseCase(turnRepository, gameResultRepository, gameSeatsRepository, latestTurnQuery).run(gameId, playerId, turnCount, point): Promise<GameStateOutput>`
  - `ApplicationErrorType` gains `"GameNotFound"` (404), `"NotYourTurn"`, `"StaleTurn"`, `"GameAlreadyEnded"` (409), `"GameCreationLimitReached"` (429)

- [ ] **Step 1: Write the failing integration test**

`test/integration/gameUseCases.test.ts`:

```ts
import { randomBytes } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closePool, connectMySQL } from "../../src/infrastructure/connection";
import { RegisterGuestUseCase } from "../../src/application/useCase/registerGuestUseCase";
import { CreateLocalGameUseCase, GAMES_PER_PLAYER_PER_HOUR } from "../../src/application/useCase/createLocalGameUseCase";
import { FindGameStateUseCase } from "../../src/application/useCase/findGameStateUseCase";
import { RegisterMoveUseCase } from "../../src/application/useCase/registerMoveUseCase";
import { ApplicationError, ApplicationErrorType } from "../../src/application/error/applicationError";
import { DomainError } from "../../src/domain/error/domainError";
import { GameMYSQLRepository } from "../../src/infrastructure/repository/game/gameMYSQLRepository";
import { TurnMYSQLRepository } from "../../src/infrastructure/repository/turn/turnMYSQLRepository";
import { GameResultMYSQLRepository } from "../../src/infrastructure/repository/gameResult/gameResultMYSQLRepository";
import { GameSeatsMYSQLRepository } from "../../src/infrastructure/repository/gamePlayer/gameSeatsMYSQLRepository";
import { PlayerMYSQLRepository } from "../../src/infrastructure/repository/player/playerMYSQLRepository";
import { LatestTurnMySQLQueryService } from "../../src/infrastructure/query/latestTurnMYSQLQueryService";
import { RateLimitMySQLQueryService } from "../../src/infrastructure/query/rateLimitMYSQLQueryService";
import { GameSeats } from "../../src/domain/model/gamePlayer/gameSeats";
import { Game } from "../../src/domain/model/game/game";
import { Turn } from "../../src/domain/model/turn/turn";
import { Board } from "../../src/domain/model/turn/board";
import { Disc } from "../../src/domain/model/turn/disc";
import { Point } from "../../src/domain/model/turn/point";
import { WinnerDisc } from "../../src/domain/model/gameResult/winnerDisc";
import { adminConnection } from "./helpers";

const registerGuest = new RegisterGuestUseCase(new PlayerMYSQLRepository(), new RateLimitMySQLQueryService());
const createLocalGame = new CreateLocalGameUseCase(
  new GameMYSQLRepository(),
  new TurnMYSQLRepository(),
  new GameSeatsMYSQLRepository(),
  new PlayerMYSQLRepository(),
  new RateLimitMySQLQueryService(),
);
const findGameState = new FindGameStateUseCase(
  new TurnMYSQLRepository(),
  new GameResultMYSQLRepository(),
  new GameSeatsMYSQLRepository(),
  new LatestTurnMySQLQueryService(),
);
const registerMove = new RegisterMoveUseCase(
  new TurnMYSQLRepository(),
  new GameResultMYSQLRepository(),
  new GameSeatsMYSQLRepository(),
  new LatestTurnMySQLQueryService(),
);

let admin: mysql.Connection;

beforeAll(async () => {
  // Two connections, so two moves can really run at the same time below.
  vi.stubEnv("DB_POOL_MAX", "2");
  admin = await adminConnection();
  await admin.query("use reversi_test");
});

afterAll(async () => {
  await closePool();
  await admin.end();
  vi.unstubAllEnvs();
});

const newPlayer = async () => (await registerGuest.run(randomBytes(32))).player.id;

async function expectApplicationError(promise: Promise<unknown>, type: ApplicationErrorType) {
  const error = await promise.catch((e) => e);
  expect(error).toBeInstanceOf(ApplicationError);
  expect((error as ApplicationError).type).toBe(type);
}

const E = Disc.Emoty;
const D = Disc.Dark;
const L = Disc.Light;

describe("CreateLocalGameUseCase", () => {
  it("creates a game with the player on both colours at turn 0", async () => {
    const playerId = await newPlayer();

    const gameId = await createLocalGame.run(playerId);
    const state = await findGameState.run(gameId, playerId);

    expect(state).toMatchObject({ gameId, turnCount: 0, nextDisc: Disc.Dark, winnerDisc: undefined });
    expect(state.yourDiscs).toEqual([Disc.Dark, Disc.Light]);
  });

  it(`refuses game ${GAMES_PER_PLAYER_PER_HOUR + 1} within an hour, and forgets older games`, async () => {
    const playerId = await newPlayer();
    for (let i = 0; i < GAMES_PER_PLAYER_PER_HOUR; i++) {
      await createLocalGame.run(playerId);
    }

    await expectApplicationError(createLocalGame.run(playerId), "GameCreationLimitReached");

    await admin.execute(
      "update game_players set created_at = current_timestamp(3) - interval 2 hour where player_id = ?",
      [playerId],
    );
    await expect(createLocalGame.run(playerId)).resolves.toBeGreaterThan(0);
  });
});

describe("FindGameStateUseCase", () => {
  it("hides a game from other players, unknown IDs, and games without seats", async () => {
    const owner = await newPlayer();
    const stranger = await newPlayer();
    const gameId = await createLocalGame.run(owner);

    const conn = await connectMySQL();
    let seatlessGameId: number;
    try {
      seatlessGameId = (await new GameMYSQLRepository().save(conn, new Game(undefined, new Date()))).id!;
    } finally {
      await conn.end();
    }

    await expectApplicationError(findGameState.run(gameId, stranger), "GameNotFound");
    await expectApplicationError(findGameState.run(2147483647, owner), "GameNotFound");
    await expectApplicationError(findGameState.run(seatlessGameId, owner), "GameNotFound");
  });
});

describe("RegisterMoveUseCase", () => {
  it("applies a legal move and returns the new state", async () => {
    const playerId = await newPlayer();
    const gameId = await createLocalGame.run(playerId);

    const state = await registerMove.run(gameId, playerId, 1, new Point(4, 2));

    expect(state.turnCount).toBe(1);
    expect(state.board[2][4]).toBe(Disc.Dark);
    expect(state.board[3][4]).toBe(Disc.Dark);
    expect(state.nextDisc).toBe(Disc.Light);
  });

  it("rejects an illegal move with the existing DomainError", async () => {
    const playerId = await newPlayer();
    const gameId = await createLocalGame.run(playerId);

    await expect(registerMove.run(gameId, playerId, 1, new Point(3, 3))).rejects.toBeInstanceOf(DomainError);
    await expect(registerMove.run(gameId, playerId, 1, new Point(0, 0))).rejects.toBeInstanceOf(DomainError);
  });

  it("rejects a stale turn count and a non-participant", async () => {
    const playerId = await newPlayer();
    const stranger = await newPlayer();
    const gameId = await createLocalGame.run(playerId);

    await expectApplicationError(registerMove.run(gameId, playerId, 5, new Point(4, 2)), "StaleTurn");
    await expectApplicationError(registerMove.run(gameId, stranger, 1, new Point(4, 2)), "GameNotFound");
  });

  it("rejects a move by the player not on the colour to move", async () => {
    const black = await newPlayer();
    const white = await newPlayer();
    const conn = await connectMySQL();
    let gameId: number;
    try {
      await conn.beginTransaction();
      gameId = (await new GameMYSQLRepository().save(conn, new Game(undefined, new Date()))).id!;
      await new TurnMYSQLRepository().save(
        conn,
        new Turn(gameId, 0, Disc.Dark, undefined, new Board(initialDiscs()), new Date()),
      );
      await new GameSeatsMYSQLRepository().save(
        conn,
        new GameSeats(gameId, [
          { disc: Disc.Dark, playerId: black },
          { disc: Disc.Light, playerId: white },
        ]),
      );
      await conn.commit();
    } finally {
      await conn.end();
    }

    await expectApplicationError(registerMove.run(gameId, white, 1, new Point(4, 2)), "NotYourTurn");
    await expect(registerMove.run(gameId, black, 1, new Point(4, 2))).resolves.toMatchObject({ turnCount: 1 });
  });

  it("finishes the game atomically on its last move, then refuses further moves", async () => {
    const playerId = await newPlayer();
    const gameId = await createLocalGame.run(playerId);
    // Turn 1: every square black except (0, 0) empty and (1, 0) white, black to move.
    // Black at (0, 0) flips (1, 0) and fills the board, ending the game.
    const discs = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => D as Disc));
    discs[0][0] = E;
    discs[0][1] = L;
    const conn = await connectMySQL();
    try {
      await new TurnMYSQLRepository().save(
        conn,
        new Turn(gameId, 1, Disc.Dark, undefined, new Board(discs), new Date()),
      );
    } finally {
      await conn.end();
    }

    const state = await registerMove.run(gameId, playerId, 2, new Point(0, 0));

    expect(state.nextDisc).toBeUndefined();
    expect(state.winnerDisc).toBe(WinnerDisc.Dark);
    const [rows] = await admin.query<mysql.RowDataPacket[]>(
      "select winner_disc from game_results where game_id = ?",
      [gameId],
    );
    expect(rows.map((r) => r.winner_disc)).toEqual([WinnerDisc.Dark]);
    await expectApplicationError(registerMove.run(gameId, playerId, 3, new Point(0, 0)), "GameAlreadyEnded");
    expect((await findGameState.run(gameId, playerId)).winnerDisc).toBe(WinnerDisc.Dark);
  });

  it("accepts exactly one of two identical moves sent at the same time", async () => {
    const playerId = await newPlayer();
    const gameId = await createLocalGame.run(playerId);

    const results = await Promise.allSettled([
      registerMove.run(gameId, playerId, 1, new Point(4, 2)),
      registerMove.run(gameId, playerId, 1, new Point(4, 2)),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ApplicationError);
    expect((rejected.reason as ApplicationError).type).toBe("StaleTurn");
    const [rows] = await admin.query<mysql.RowDataPacket[]>(
      "select count(*) as n from turns where game_id = ?",
      [gameId],
    );
    expect(Number(rows[0].n)).toBe(2);
  });
});

function initialDiscs(): Disc[][] {
  const discs = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => E as Disc));
  discs[3][3] = D;
  discs[3][4] = L;
  discs[4][3] = L;
  discs[4][4] = D;
  return discs;
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:integration`
Expected: FAIL — cannot resolve `createLocalGameUseCase`.

- [ ] **Step 3: Add the error types**

In `src/application/error/applicationError.ts`, replace the union with:

```ts
export type ApplicationErrorType =
  | "LatestGameNotFound"
  | "PlayerNotFound"
  | "GuestCreationLimitReached"
  | "GameNotFound"
  | "NotYourTurn"
  | "StaleTurn"
  | "GameAlreadyEnded"
  | "GameCreationLimitReached";
```

In `src/presentation/errorHandler.ts`, replace the status map with:

```ts
export const APPLICATION_ERROR_STATUS: Record<ApplicationErrorType, number> = {
  LatestGameNotFound: 404,
  PlayerNotFound: 404,
  GuestCreationLimitReached: 429,
  GameNotFound: 404,
  NotYourTurn: 409,
  StaleTurn: 409,
  GameAlreadyEnded: 409,
  GameCreationLimitReached: 429,
};
```

- [ ] **Step 4: Implement the latest-turn query**

`src/application/query/latestTurnQueryService.ts`:

```ts
import mysql from "mysql2/promise";

export interface LatestTurnQueryService {
  /** Undefined when the game has no turns. */
  findLatestTurnCount(conn: mysql.Connection, gameId: number): Promise<number | undefined>;
}
```

`src/infrastructure/query/latestTurnMYSQLQueryService.ts`:

```ts
import mysql from "mysql2/promise";
import { LatestTurnQueryService } from "../../application/query/latestTurnQueryService";

export class LatestTurnMySQLQueryService implements LatestTurnQueryService {
  async findLatestTurnCount(conn: mysql.Connection, gameId: number): Promise<number | undefined> {
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      "select max(turn_count) as latest from turns where game_id = ?",
      [gameId],
    );
    const latest = rows[0].latest;
    return latest === null ? undefined : Number(latest);
  }
}
```

- [ ] **Step 5: Implement `src/application/useCase/createLocalGameUseCase.ts`**

```ts
import { connectMySQL } from "../../infrastructure/connection";
import { Game } from "../../domain/model/game/game";
import { GameRepository } from "../../domain/model/game/gameRepository";
import { firstTurn } from "../../domain/model/turn/turn";
import { TurnRepository } from "../../domain/model/turn/turnRepository";
import { GameSeats } from "../../domain/model/gamePlayer/gameSeats";
import { GameSeatsRepository } from "../../domain/model/gamePlayer/gameSeatsRepository";
import { ApplicationError } from "../error/applicationError";
import { PlayerRepository } from "../identity/playerRepository";
import { RateLimitQueryService } from "../query/rateLimitQueryService";

export const GAMES_PER_PLAYER_PER_HOUR = 10;

export class CreateLocalGameUseCase {
  constructor(
    private _gameRepository: GameRepository,
    private _turnRepository: TurnRepository,
    private _gameSeatsRepository: GameSeatsRepository,
    private _playerRepository: PlayerRepository,
    private _rateLimitQuery: RateLimitQueryService,
  ) {}

  /** Creates a game with the player on both colours and returns its ID. */
  async run(playerId: number): Promise<number> {
    const now = new Date();

    const conn = await connectMySQL();
    try {
      await conn.beginTransaction();

      // Serialises game creation per player, so the cap below is exact.
      await this._playerRepository.lockForUpdate(conn, playerId);
      const recent = await this._rateLimitQuery.countGamesCreatedInLastHour(conn, playerId);
      if (recent >= GAMES_PER_PLAYER_PER_HOUR) {
        throw new ApplicationError(
          "GameCreationLimitReached",
          "Too many new games. Try again later.",
        );
      }

      const game = await this._gameRepository.save(conn, new Game(undefined, now));
      if (!game.id) {
        throw new Error("game.id does not exist");
      }
      await this._turnRepository.save(conn, firstTurn(game.id, now));
      await this._gameSeatsRepository.save(conn, GameSeats.forLocalGame(game.id, playerId));

      await conn.commit();
      return game.id;
    } finally {
      await conn.end();
    }
  }
}
```

- [ ] **Step 6: Implement `src/application/useCase/findGameStateUseCase.ts`**

```ts
import { connectMySQL } from "../../infrastructure/connection";
import { Disc } from "../../domain/model/turn/disc";
import { Turn } from "../../domain/model/turn/turn";
import { TurnRepository } from "../../domain/model/turn/turnRepository";
import { WinnerDisc } from "../../domain/model/gameResult/winnerDisc";
import { GameResultRepository } from "../../domain/model/gameResult/gameResultRepository";
import { GameSeats } from "../../domain/model/gamePlayer/gameSeats";
import { GameSeatsRepository } from "../../domain/model/gamePlayer/gameSeatsRepository";
import { ApplicationError } from "../error/applicationError";
import { LatestTurnQueryService } from "../query/latestTurnQueryService";

export interface GameStateOutput {
  gameId: number;
  turnCount: number;
  board: Disc[][];
  /** Undefined once the game has ended. */
  nextDisc: Disc | undefined;
  /** Undefined until the game has ended. */
  winnerDisc: WinnerDisc | undefined;
  yourDiscs: Disc[];
}

export function toGameState(
  turn: Turn,
  seats: GameSeats,
  playerId: number,
  winnerDisc: WinnerDisc | undefined,
): GameStateOutput {
  return {
    gameId: turn.gameId,
    turnCount: turn.turnCount,
    board: turn.board.discs,
    nextDisc: turn.nextDisc,
    winnerDisc,
    yourDiscs: seats.discsOf(playerId),
  };
}

export function gameNotFound(): ApplicationError {
  return new ApplicationError("GameNotFound", "Game not found");
}

export class FindGameStateUseCase {
  constructor(
    private _turnRepository: TurnRepository,
    private _gameResultRepository: GameResultRepository,
    private _gameSeatsRepository: GameSeatsRepository,
    private _latestTurnQuery: LatestTurnQueryService,
  ) {}

  async run(gameId: number, playerId: number): Promise<GameStateOutput> {
    const conn = await connectMySQL();
    try {
      const seats = await this._gameSeatsRepository.findForGameId(conn, gameId);
      if (!seats || !seats.isParticipant(playerId)) {
        throw gameNotFound();
      }

      const latest = await this._latestTurnQuery.findLatestTurnCount(conn, gameId);
      if (latest === undefined) {
        throw new Error(`Game ${gameId} has seats but no turns`);
      }
      const turn = await this._turnRepository.findForGmaeIdAndTurnCOunt(conn, gameId, latest);

      const result = turn.gameEnded()
        ? await this._gameResultRepository.findForGameId(conn, gameId)
        : undefined;

      return toGameState(turn, seats, playerId, result?.winnerDisc);
    } finally {
      await conn.end();
    }
  }
}
```

- [ ] **Step 7: Implement `src/application/useCase/registerMoveUseCase.ts`**

```ts
import { connectMySQL } from "../../infrastructure/connection";
import { Point } from "../../domain/model/turn/point";
import { TurnRepository } from "../../domain/model/turn/turnRepository";
import { GameResult } from "../../domain/model/gameResult/gameResult";
import { GameResultRepository } from "../../domain/model/gameResult/gameResultRepository";
import { WinnerDisc } from "../../domain/model/gameResult/winnerDisc";
import { GameSeatsRepository } from "../../domain/model/gamePlayer/gameSeatsRepository";
import { ApplicationError } from "../error/applicationError";
import { LatestTurnQueryService } from "../query/latestTurnQueryService";
import { GameStateOutput, gameNotFound, toGameState } from "./findGameStateUseCase";

export class RegisterMoveUseCase {
  constructor(
    private _turnRepository: TurnRepository,
    private _gameResultRepository: GameResultRepository,
    private _gameSeatsRepository: GameSeatsRepository,
    private _latestTurnQuery: LatestTurnQueryService,
  ) {}

  /**
   * Plays `point` for whoever's colour is next, if that is this player.
   * `turnCount` is the turn this move creates (latest + 1), so a move made
   * from an out-of-date board is rejected instead of applied.
   */
  async run(
    gameId: number,
    playerId: number,
    turnCount: number,
    point: Point,
  ): Promise<GameStateOutput> {
    const conn = await connectMySQL();
    try {
      await conn.beginTransaction();

      // Must be the first statement: concurrent moves on this game queue on
      // these row locks, and each later one then reads what the earlier one
      // committed.
      const seats = await this._gameSeatsRepository.findForGameId(conn, gameId, { forUpdate: true });
      if (!seats || !seats.isParticipant(playerId)) {
        throw gameNotFound();
      }

      const latest = await this._latestTurnQuery.findLatestTurnCount(conn, gameId);
      if (latest === undefined) {
        throw new Error(`Game ${gameId} has seats but no turns`);
      }
      const turn = await this._turnRepository.findForGmaeIdAndTurnCOunt(conn, gameId, latest);

      const nextDisc = turn.nextDisc;
      if (nextDisc === undefined) {
        throw new ApplicationError("GameAlreadyEnded", "The game has already ended");
      }
      if (turnCount !== latest + 1) {
        throw new ApplicationError("StaleTurn", `This move is for turn ${turnCount}, but the next turn is ${latest + 1}`);
      }
      if (!seats.mayMove(playerId, nextDisc)) {
        throw new ApplicationError("NotYourTurn", "It is not your turn");
      }

      // Illegal moves throw the existing DomainErrors (400).
      const newTurn = turn.placeNext(nextDisc, point);
      try {
        await this._turnRepository.save(conn, newTurn);
      } catch (e) {
        // unique (game_id, turn_count) is a backstop behind the row lock.
        if ((e as { code?: unknown }).code === "ER_DUP_ENTRY") {
          throw new ApplicationError("StaleTurn", "Another move was made first");
        }
        throw e;
      }

      let winnerDisc: WinnerDisc | undefined;
      if (newTurn.gameEnded()) {
        winnerDisc = newTurn.winnerDisc();
        await this._gameResultRepository.save(conn, new GameResult(gameId, winnerDisc, newTurn.endAt));
      }

      await conn.commit();
      return toGameState(newTurn, seats, playerId, winnerDisc);
    } finally {
      await conn.end();
    }
  }
}
```

- [ ] **Step 8: Run all suites**

Run: `npx tsc --noEmit && npm test && npm run test:integration`
Expected: all pass. If the concurrency test is flaky, stop and investigate — do not retry it into passing.

- [ ] **Step 9: Commit**

```bash
git add src/application/query/latestTurnQueryService.ts src/infrastructure/query/latestTurnMYSQLQueryService.ts src/application/useCase/createLocalGameUseCase.ts src/application/useCase/findGameStateUseCase.ts src/application/useCase/registerMoveUseCase.ts src/application/error/applicationError.ts src/presentation/errorHandler.ts test/integration/gameUseCases.test.ts
git commit -m "Add game-ID use cases: create a local game, read it, make a move

Moves lock the game's seat rows first, so concurrent moves are
serialised; the disc comes from the seats, stale turn counts and ended
games return 409, and the move plus any result commit together. Game
creation is capped at 10 per player per rolling hour."
```

---

### Task 8: Switch the API and the page to game IDs; retire the latest-game flow

**Files:**
- Create: `src/presentation/validation.ts`, `src/presentation/gameStateResponse.ts`
- Modify: `src/presentation/gameRouter.ts`, `src/presentation/turnRouter.ts`, `src/presentation/errorHandler.ts`, `src/application/error/applicationError.ts`
- Modify: `src/application/query/findLastGamesQueryService.ts`, `src/application/useCase/findLastGamesUseCase.ts`, `src/infrastructure/query/findLastGamesMYSQLQueryService.ts`
- Delete: `src/application/useCase/startNewGameUseCase.ts`, `findLatestGameTurnByTurnCountUseCase.ts`, `registerTurnUseCase.ts`
- Modify: `test/integration/connection.test.ts`, `test/integration/vercelEntry.test.ts`, `static/game/main.js`
- Test: `test/unit/validation.test.ts`, `test/integration/api.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 3–7.
- Produces: `class ValidationError extends Error`, `parseGameId(value: unknown): number`, `parseMoveRequest(body: unknown): { turnCount: number; point: Point }`, `interface GameStateResponseBody`, `toGameStateResponse(state: GameStateOutput): GameStateResponseBody`; `FindLastGameUseCase.run(playerId: number)`; `FindLastGamesQueryService.query(conn, playerId, limit)`.

- [ ] **Step 1: Write the failing unit test**

`test/unit/validation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseGameId, parseMoveRequest, ValidationError } from "../../src/presentation/validation";

describe("parseGameId", () => {
  it.each([["1", 1], ["42", 42], ["2147483647", 2147483647]])("accepts %s", (value, expected) => {
    expect(parseGameId(value)).toBe(expected);
  });

  it.each(["0", "01", "-1", "1e3", "1.0", " 1", "abc", "", "2147483648", "99999999999", undefined])(
    "rejects %s",
    (value) => {
      expect(() => parseGameId(value)).toThrow(ValidationError);
    },
  );
});

describe("parseMoveRequest", () => {
  it("parses a valid request and ignores a legacy disc field", () => {
    const parsed = parseMoveRequest({ turnCount: 3, move: { x: 0, y: 7, disc: 1 } });

    expect(parsed.turnCount).toBe(3);
    expect(parsed.point.x).toBe(0);
    expect(parsed.point.y).toBe(7);
  });

  it.each([
    ["an array body", []],
    ["a null body", null],
    ["a string body", "move"],
    ["a missing turnCount", { move: { x: 1, y: 1 } }],
    ["turnCount 0", { turnCount: 0, move: { x: 1, y: 1 } }],
    ["turnCount 1.5", { turnCount: 1.5, move: { x: 1, y: 1 } }],
    ["turnCount as a string", { turnCount: "1", move: { x: 1, y: 1 } }],
    ["a missing move", { turnCount: 1 }],
    ["move as an array", { turnCount: 1, move: [1, 1] }],
    ["x as a string", { turnCount: 1, move: { x: "3", y: 1 } }],
    ["x of 1.5", { turnCount: 1, move: { x: 1.5, y: 1 } }],
    ["x of 8", { turnCount: 1, move: { x: 8, y: 1 } }],
    ["y of -1", { turnCount: 1, move: { x: 1, y: -1 } }],
    ["a missing y", { turnCount: 1, move: { x: 1 } }],
  ])("rejects %s", (_label, body) => {
    expect(() => parseMoveRequest(body)).toThrow(ValidationError);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `validation`.

- [ ] **Step 3: Implement `src/presentation/validation.ts`**

```ts
import { Point } from "../domain/model/turn/point";

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

// games.id is a MySQL signed int.
const MAX_GAME_ID = 2147483647;

export function parseGameId(value: unknown): number {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,9}$/.test(value) || Number(value) > MAX_GAME_ID) {
    throw new ValidationError("gameId must be a positive integer");
  }
  return Number(value);
}

export interface MoveRequest {
  turnCount: number;
  point: Point;
}

/** `{ "turnCount": <int >= 1>, "move": { "x": <int 0-7>, "y": <int 0-7> } }`; other fields are ignored. */
export function parseMoveRequest(body: unknown): MoveRequest {
  if (!isPlainObject(body)) {
    throw new ValidationError("Request body must be a JSON object");
  }
  const { turnCount, move } = body;
  if (typeof turnCount !== "number" || !Number.isInteger(turnCount) || turnCount < 1) {
    throw new ValidationError("turnCount must be an integer of at least 1");
  }
  if (!isPlainObject(move)) {
    throw new ValidationError("move must be an object with x and y");
  }
  const { x, y } = move;
  if (!isCoordinate(x) || !isCoordinate(y)) {
    throw new ValidationError("move.x and move.y must be integers from 0 to 7");
  }
  return { turnCount, point: new Point(x, y) };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 7;
}
```

- [ ] **Step 4: Run the unit test**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Write the failing API integration test**

`test/integration/api.test.ts`:

```ts
import mysql from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/main";
import { closePool } from "../../src/infrastructure/connection";
import { generatePlayerToken } from "../../src/application/identity/playerToken";
import { GUESTS_PER_IP_PER_HOUR } from "../../src/application/useCase/registerGuestUseCase";
import { GAMES_PER_PLAYER_PER_HOUR } from "../../src/application/useCase/createLocalGameUseCase";
import { adminConnection } from "./helpers";
import { Guest, startTestServer, TestServer } from "./apiClient";

let server: TestServer;
let admin: mysql.Connection;

beforeAll(async () => {
  server = await startTestServer(app);
  admin = await adminConnection();
  await admin.query("use reversi_test");
});

// Every guest here comes from 127.0.0.1; forget earlier ones so tests do not
// share the per-IP cap.
beforeEach(async () => {
  await admin.query("update players set created_ip_hash = null where created_ip_hash is not null");
});

afterAll(async () => {
  await server.close();
  await closePool();
  await admin.end();
});

async function startGame(guest: Guest): Promise<number> {
  const response = await guest.post("/api/games");
  expect(response.status).toBe(201);
  return response.body.id;
}

describe("POST /api/games", () => {
  it("creates a guest with a secure cookie and a local game", async () => {
    const guest = new Guest(server);

    const response = await guest.post("/api/games");

    expect(response.status).toBe(201);
    expect(response.body.id).toBeGreaterThan(0);
    expect(response.headers.get("location")).toBe(`/api/games/${response.body.id}`);
    expect(response.setCookie).toMatch(/^rv_player=[A-Za-z0-9_-]{43};/);
    expect(response.setCookie).toContain("Max-Age=34560000");
    expect(response.setCookie).toContain("Path=/");
    expect(response.setCookie).toContain("HttpOnly");
    expect(response.setCookie).toContain("SameSite=Lax");
    expect((await guest.get("/api/me")).body.displayName).toMatch(/^Guest [1-9][0-9]{3}$/);
  });

  it("reuses the guest on later games", async () => {
    const guest = new Guest(server);
    await startGame(guest);
    const cookie = guest.cookie;

    const response = await guest.post("/api/games");

    expect(response.status).toBe(201);
    expect(response.setCookie).toBeUndefined();
    expect(guest.cookie).toBe(cookie);
  });

  it("replaces a cookie whose player no longer exists", async () => {
    const guest = new Guest(server);
    const orphan = `rv_player=${generatePlayerToken()}`;
    guest.cookie = orphan;

    const response = await guest.post("/api/games");

    expect(response.status).toBe(201);
    expect(guest.cookie).not.toBe(orphan);
    expect((await guest.get("/api/me")).status).toBe(200);
  });

  it(`refuses the ${GUESTS_PER_IP_PER_HOUR + 1}st new guest from one IP`, { timeout: 30000 }, async () => {
    for (let i = 0; i < GUESTS_PER_IP_PER_HOUR; i++) {
      await startGame(new Guest(server));
    }

    const response = await new Guest(server).post("/api/games");

    expect(response.status).toBe(429);
    expect(response.body.type).toBe("GuestCreationLimitReached");
  });

  it(`refuses a player's game ${GAMES_PER_PLAYER_PER_HOUR + 1} within an hour`, { timeout: 30000 }, async () => {
    const guest = new Guest(server);
    for (let i = 0; i < GAMES_PER_PLAYER_PER_HOUR; i++) {
      await startGame(guest);
    }

    const response = await guest.post("/api/games");

    expect(response.status).toBe(429);
    expect(response.body.type).toBe("GameCreationLimitReached");
  });
});

describe("GET /api/games/:gameId", () => {
  it("returns the state to its player", async () => {
    const guest = new Guest(server);
    const gameId = await startGame(guest);

    const response = await guest.get(`/api/games/${gameId}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ id: gameId, turnCount: 0, nextDisc: 1, winnerDisc: null, yourDiscs: [1, 2] });
    expect(response.body.board).toHaveLength(8);
  });

  it("is not found for another guest, for no cookie, for unknown IDs, and for seatless games", async () => {
    const owner = new Guest(server);
    const gameId = await startGame(owner);
    const other = new Guest(server);
    await startGame(other);
    const [inserted] = await admin.execute<mysql.ResultSetHeader>(
      "insert into games (started_at) values (current_timestamp)",
    );

    expect((await other.get(`/api/games/${gameId}`)).status).toBe(404);
    expect((await new Guest(server).get(`/api/games/${gameId}`)).status).toBe(404);
    expect((await owner.get("/api/games/2147483647")).status).toBe(404);
    expect((await owner.get(`/api/games/${inserted.insertId}`)).body.type).toBe("GameNotFound");
  });

  it.each(["01", "1e3", "-1", "2147483648", "abc"])("rejects the ID %s with 400", async (id) => {
    const guest = new Guest(server);
    await startGame(guest);

    const response = await guest.get(`/api/games/${id}`);

    expect(response.status).toBe(400);
    expect(response.body.type).toBe("InvalidRequest");
  });
});

describe("POST /api/games/:gameId/turns", () => {
  it("applies a legal move and returns the new state", async () => {
    const guest = new Guest(server);
    const gameId = await startGame(guest);

    const response = await guest.post(`/api/games/${gameId}/turns`, { turnCount: 1, move: { x: 4, y: 2 } });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ id: gameId, turnCount: 1, nextDisc: 2, winnerDisc: null });
    expect(response.body.board[2][4]).toBe(1);
  });

  it("answers illegal, stale, and malformed moves with 4xx", async () => {
    const guest = new Guest(server);
    const gameId = await startGame(guest);
    const path = `/api/games/${gameId}/turns`;

    expect((await guest.post(path, { turnCount: 1, move: { x: 3, y: 3 } })).status).toBe(400);
    expect((await guest.post(path, { turnCount: 1, move: { x: 1.5, y: 2 } })).status).toBe(400);
    expect((await guest.post(path, { turnCount: 1, move: { x: 8, y: 2 } })).status).toBe(400);
    expect((await guest.post(path, { turnCount: 1, move: { x: "3", y: 2 } })).status).toBe(400);
    expect((await guest.post(path, [])).status).toBe(400);
    expect((await guest.post(path, "{not json")).body.type).toBe("InvalidRequest");
    expect((await guest.post(path, { turnCount: 5, move: { x: 4, y: 2 } })).body.type).toBe("StaleTurn");
  });

  it("ignores a legacy disc field", async () => {
    const guest = new Guest(server);
    const gameId = await startGame(guest);

    const response = await guest.post(`/api/games/${gameId}/turns`, {
      turnCount: 1,
      move: { disc: 2, x: 4, y: 2 },
    });

    expect(response.status).toBe(201);
    expect(response.body.board[2][4]).toBe(1);
  });

  it("does not let another guest move in the game", async () => {
    const owner = new Guest(server);
    const gameId = await startGame(owner);
    const other = new Guest(server);
    await startGame(other);

    const response = await other.post(`/api/games/${gameId}/turns`, { turnCount: 1, move: { x: 4, y: 2 } });

    expect(response.status).toBe(404);
    expect((await owner.get(`/api/games/${gameId}`)).body.turnCount).toBe(0);
  });

  it("finishes the game, then refuses further moves with 409", async () => {
    const guest = new Guest(server);
    const gameId = await startGame(guest);
    await insertNearlyFinishedTurn(gameId);

    const last = await guest.post(`/api/games/${gameId}/turns`, { turnCount: 2, move: { x: 0, y: 0 } });

    expect(last.status).toBe(201);
    expect(last.body).toMatchObject({ nextDisc: null, winnerDisc: 1 });
    const after = await guest.post(`/api/games/${gameId}/turns`, { turnCount: 3, move: { x: 0, y: 0 } });
    expect(after.status).toBe(409);
    expect(after.body.type).toBe("GameAlreadyEnded");
  });
});

describe("GET /api/games", () => {
  it("lists only the caller's games, and nothing without a cookie", async () => {
    const mine = new Guest(server);
    const gameId = await startGame(mine);
    const theirs = new Guest(server);
    const theirGameId = await startGame(theirs);

    const ids = (await mine.get("/api/games")).body.games.map((g: { id: number }) => g.id);

    expect(ids).toContain(gameId);
    expect(ids).not.toContain(theirGameId);
    expect((await new Guest(server).get("/api/games")).body).toEqual({ games: [] });
  });
});

/** Turn 1: all black but (0, 0) empty and (1, 0) white; black at (0, 0) ends the game. */
async function insertNearlyFinishedTurn(gameId: number) {
  const [turn] = await admin.execute<mysql.ResultSetHeader>(
    "insert into turns (game_id, turn_count, next_disc, end_at) values (?, 1, 1, current_timestamp)",
    [gameId],
  );
  const values: number[] = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const disc = x === 0 && y === 0 ? 0 : x === 1 && y === 0 ? 2 : 1;
      values.push(turn.insertId, x, y, disc);
    }
  }
  await admin.execute(
    "insert into squares (turn_id, x, y, disc) values " + Array(64).fill("(?, ?, ?, ?)").join(", "),
    values,
  );
}
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npm run test:integration`
Expected: FAIL — `api.test.ts` gets 404/201-without-body from the old routes.

- [ ] **Step 7: Scope history to the player**

`src/application/query/findLastGamesQueryService.ts` — change only the interface:

```ts
export interface FindLastGamesQueryService {
  query (
    conn: mysql.Connection, 
    playerId: number,
    limitL: number
  ): Promise<FindLastGamesQueryModel[]>
}
```

`src/application/useCase/findLastGamesUseCase.ts` — change `run()` to:

```ts
  async run(playerId: number): Promise<FindLastGamesQueryModel[]> {
    const conn = await connectMySQL();
    try {
      return await this._queryService.query(conn, playerId, FIND_COUNT);
    } finally {
      await conn.end();
    }
  }
```

`src/infrastructure/query/findLastGamesMYSQLQueryService.ts` — change the signature, add the `where` line, and pass `playerId` first:

```ts
  async query(
    conn: mysql.Connection,
    playerId: number,
    limit: number
  ): Promise<FindLastGamesQueryModel[]> {
```

```sql
left join moves m on m.turn_id = t.id
where g.id in (select game_id from game_players where player_id = ?)
group by g.id
```

```ts
      [playerId, limit.toString()]
```

- [ ] **Step 8: Add the response shape and ValidationError mapping**

`src/presentation/gameStateResponse.ts`:

```ts
import { GameStateOutput } from "../application/useCase/findGameStateUseCase";

export interface GameStateResponseBody {
  id: number;
  turnCount: number;
  board: number[][];
  nextDisc: number | null;
  winnerDisc: number | null;
  yourDiscs: number[];
}

export function toGameStateResponse(state: GameStateOutput): GameStateResponseBody {
  return {
    id: state.gameId,
    turnCount: state.turnCount,
    board: state.board,
    nextDisc: state.nextDisc ?? null,
    winnerDisc: state.winnerDisc ?? null,
    yourDiscs: state.yourDiscs,
  };
}
```

In `src/presentation/errorHandler.ts`, add the import `import { ValidationError } from "./validation";` and, right after the `DomainError` branch:

```ts
  if (err instanceof ValidationError) {
    res.status(400).json({ type: "InvalidRequest", message: err.message });
    return;
  }
```

- [ ] **Step 9: Rewrite the routers**

`src/presentation/gameRouter.ts` — keep the first import line and the `GetGamesResponseBody` interface exactly as they are; replace the rest so the file reads:

```ts
import express, { response } from "express";
import { CreateLocalGameUseCase } from "../application/useCase/createLocalGameUseCase";
import { FindGameStateUseCase, gameNotFound } from "../application/useCase/findGameStateUseCase";
import { GameMYSQLRepository } from "../infrastructure/repository/game/gameMYSQLRepository";
import { TurnMYSQLRepository } from "../infrastructure/repository/turn/turnMYSQLRepository";
import { GameResultMYSQLRepository } from "../infrastructure/repository/gameResult/gameResultMYSQLRepository";
import { GameSeatsMYSQLRepository } from "../infrastructure/repository/gamePlayer/gameSeatsMYSQLRepository";
import { PlayerMYSQLRepository } from "../infrastructure/repository/player/playerMYSQLRepository";
import { LatestTurnMySQLQueryService } from "../infrastructure/query/latestTurnMYSQLQueryService";
import { RateLimitMySQLQueryService } from "../infrastructure/query/rateLimitMYSQLQueryService";
import { FindLastGameUseCase } from "../application/useCase/findLastGamesUseCase";
import { FindLastGameMySQLQueryService } from "../infrastructure/query/findLastGamesMYSQLQueryService";
import { currentPlayer, ensurePlayer } from "./middleware/identity";
import { parseGameId } from "./validation";
import { GameStateResponseBody, toGameStateResponse } from "./gameStateResponse";

export const gameRouter = express.Router();

const createLocalGameUseCase = new CreateLocalGameUseCase(
  new GameMYSQLRepository(),
  new TurnMYSQLRepository(),
  new GameSeatsMYSQLRepository(),
  new PlayerMYSQLRepository(),
  new RateLimitMySQLQueryService(),
);

const findLastGamesUseCase = new FindLastGameUseCase(
  new FindLastGameMySQLQueryService(),
);

const findGameStateUseCase = new FindGameStateUseCase(
  new TurnMYSQLRepository(),
  new GameResultMYSQLRepository(),
  new GameSeatsMYSQLRepository(),
  new LatestTurnMySQLQueryService(),
);

interface GetGamesResponseBody {
  games: {
    id: number;
    darkMoveCount: number;
    lightMoveCount: number;
    winnerDisc: number;
    startedAt: Date;
    endAt: Date;
  }[];
}

gameRouter.get(
  "/api/games",
  async (req, res: express.Response<GetGamesResponseBody>) => {
    const player = currentPlayer(res);
    if (!player) {
      res.json({ games: [] });
      return;
    }

    const output = await findLastGamesUseCase.run(player.id);

    const responseBodyGames = output.map((g) => {
      return {
        id: g.gameId,
        darkMoveCount: g.darkMoveCount,
        lightMoveCount: g.lightMoveCount,
        winnerDisc: g.winnerDisc,
        startedAt: g.startedAt,
        endAt: g.endAt,
      };
    });

    const responseBody = {
      games: responseBodyGames,
    };
    res.json(responseBody);
  },
);

gameRouter.post("/api/games", async (req, res) => {
  const player = await ensurePlayer(req, res);
  const gameId = await createLocalGameUseCase.run(player.id);

  res.status(201).location(`/api/games/${gameId}`).json({ id: gameId });
});

gameRouter.get(
  "/api/games/:gameId",
  async (req, res: express.Response<GameStateResponseBody>) => {
    const gameId = parseGameId(req.params.gameId);
    const player = currentPlayer(res);
    if (!player) {
      throw gameNotFound();
    }

    const state = await findGameStateUseCase.run(gameId, player.id);

    res.json(toGameStateResponse(state));
  },
);
```

`src/presentation/turnRouter.ts` — replace the whole file:

```ts
import express from "express";
import { RegisterMoveUseCase } from "../application/useCase/registerMoveUseCase";
import { gameNotFound } from "../application/useCase/findGameStateUseCase";
import { TurnMYSQLRepository } from "../infrastructure/repository/turn/turnMYSQLRepository";
import { GameResultMYSQLRepository } from "../infrastructure/repository/gameResult/gameResultMYSQLRepository";
import { GameSeatsMYSQLRepository } from "../infrastructure/repository/gamePlayer/gameSeatsMYSQLRepository";
import { LatestTurnMySQLQueryService } from "../infrastructure/query/latestTurnMYSQLQueryService";
import { currentPlayer } from "./middleware/identity";
import { parseGameId, parseMoveRequest } from "./validation";
import { GameStateResponseBody, toGameStateResponse } from "./gameStateResponse";

export const turnRouter = express.Router();

const registerMoveUseCase = new RegisterMoveUseCase(
  new TurnMYSQLRepository(),
  new GameResultMYSQLRepository(),
  new GameSeatsMYSQLRepository(),
  new LatestTurnMySQLQueryService(),
);

turnRouter.post(
  "/api/games/:gameId/turns",
  async (req, res: express.Response<GameStateResponseBody>) => {
    const gameId = parseGameId(req.params.gameId);
    const { turnCount, point } = parseMoveRequest(req.body);
    const player = currentPlayer(res);
    if (!player) {
      throw gameNotFound();
    }

    const state = await registerMoveUseCase.run(gameId, player.id, turnCount, point);

    res.status(201).json(toGameStateResponse(state));
  },
);
```

- [ ] **Step 10: Delete the latest-game use cases and their error type**

```bash
git rm src/application/useCase/startNewGameUseCase.ts src/application/useCase/findLatestGameTurnByTurnCountUseCase.ts src/application/useCase/registerTurnUseCase.ts
```

In `src/application/error/applicationError.ts`, remove the `| "LatestGameNotFound"` line from the union (it now starts with `| "PlayerNotFound"`); in `src/presentation/errorHandler.ts`, remove `LatestGameNotFound: 404,` from the status map; in `test/unit/errorHandler.test.ts`, change the "maps ApplicationError by type" case to:

```ts
  it("maps ApplicationError by type", () => {
    expect(run(new ApplicationError("GameNotFound", "Game not found")).statusCode).toBe(404);
    expect(run(new ApplicationError("StaleTurn", "stale")).statusCode).toBe(409);
    expect(run(new ApplicationError("GameCreationLimitReached", "slow down")).statusCode).toBe(429);
  });
```

- [ ] **Step 11: Port the Phase 0 tests (every assertion kept)**

Replace `test/integration/connection.test.ts` with the version shown in spec §14.5 (full file):

```ts
import { createHash } from "node:crypto";
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePool, connectMySQL } from "../../src/infrastructure/connection";
import { RegisterGuestUseCase } from "../../src/application/useCase/registerGuestUseCase";
import { CreateLocalGameUseCase } from "../../src/application/useCase/createLocalGameUseCase";
import { FindLastGameUseCase } from "../../src/application/useCase/findLastGamesUseCase";
import { FindGameStateUseCase } from "../../src/application/useCase/findGameStateUseCase";
import { RegisterMoveUseCase } from "../../src/application/useCase/registerMoveUseCase";
import { GameMYSQLRepository } from "../../src/infrastructure/repository/game/gameMYSQLRepository";
import { TurnMYSQLRepository } from "../../src/infrastructure/repository/turn/turnMYSQLRepository";
import { GameResultMYSQLRepository } from "../../src/infrastructure/repository/gameResult/gameResultMYSQLRepository";
import { GameSeatsMYSQLRepository } from "../../src/infrastructure/repository/gamePlayer/gameSeatsMYSQLRepository";
import { PlayerMYSQLRepository } from "../../src/infrastructure/repository/player/playerMYSQLRepository";
import { FindLastGameMySQLQueryService } from "../../src/infrastructure/query/findLastGamesMYSQLQueryService";
import { LatestTurnMySQLQueryService } from "../../src/infrastructure/query/latestTurnMYSQLQueryService";
import { RateLimitMySQLQueryService } from "../../src/infrastructure/query/rateLimitMYSQLQueryService";
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

// A fixed client-IP hash, distinct from the one HTTP tests produce, so the
// per-IP guest cap is never shared with other test files.
const TEST_IP_HASH = createHash("sha256").update("connection.test").digest();

let admin: mysql.Connection;
let playerId: number;

beforeAll(async () => {
  admin = await adminConnection();
  const registerGuest = new RegisterGuestUseCase(
    new PlayerMYSQLRepository(),
    new RateLimitMySQLQueryService(),
  );
  playerId = (await registerGuest.run(TEST_IP_HASH)).player.id;
});

afterAll(async () => {
  await closePool();
  await admin.end();
});

describe("connectMySQL", () => {
  it("returns every connection to the pool across a sequence of use cases", async () => {
    const createLocalGame = new CreateLocalGameUseCase(
      new GameMYSQLRepository(),
      new TurnMYSQLRepository(),
      new GameSeatsMYSQLRepository(),
      new PlayerMYSQLRepository(),
      new RateLimitMySQLQueryService(),
    );
    const findLastGames = new FindLastGameUseCase(new FindLastGameMySQLQueryService());
    const findGameState = new FindGameStateUseCase(
      new TurnMYSQLRepository(),
      new GameResultMYSQLRepository(),
      new GameSeatsMYSQLRepository(),
      new LatestTurnMySQLQueryService(),
    );
    const registerMove = new RegisterMoveUseCase(
      new TurnMYSQLRepository(),
      new GameResultMYSQLRepository(),
      new GameSeatsMYSQLRepository(),
      new LatestTurnMySQLQueryService(),
    );

    await createLocalGame.run(playerId);
    await createLocalGame.run(playerId);
    const gameId = await createLocalGame.run(playerId);
    expect((await findLastGames.run(playerId)).length).toBeGreaterThanOrEqual(3);
    expect((await findGameState.run(gameId, playerId)).nextDisc).toBe(Disc.Dark);

    // A legal opening move for black: flips the white disc at (4, 3).
    await registerMove.run(gameId, playerId, 1, new Point(4, 2));

    const afterMove = await findGameState.run(gameId, playerId);
    expect(afterMove.board[2][4]).toBe(Disc.Dark);
    expect(afterMove.nextDisc).toBe(Disc.Light);
  });

  it("rolls back a transaction left open by an error before reusing the connection", async () => {
    const observed: { connectionId?: number; gameId?: number; activeInside?: number } = {};

    // Fails after CreateLocalGameUseCase has begun its transaction and inserted
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
      new CreateLocalGameUseCase(
        new GameMYSQLRepository(),
        failingTurnRepository,
        new GameSeatsMYSQLRepository(),
        new PlayerMYSQLRepository(),
        new RateLimitMySQLQueryService(),
      ).run(playerId),
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

Verify the assertions are unchanged:

```bash
git diff -U0 test/integration/connection.test.ts | grep -E '^[-+].*expect\(' 
```

Expected: only the two lines whose wrapped call changed (`findLastGames.run(playerId)` and `findGameState.run(gameId, playerId)`), as a `-`/`+` pair each; `grep -c 'expect(' test/integration/connection.test.ts` still prints `10`.

Replace `test/integration/vercelEntry.test.ts` with (same three assertions; the POST now carries the CSRF headers and the GET the returned cookie):

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import handler from "../../api/index";
import { closePool } from "../../src/infrastructure/connection";
import { Guest, startTestServer, TestServer } from "./apiClient";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer(handler);
});

afterAll(async () => {
  await server.close();
  await closePool();
});

describe("Vercel entry point", () => {
  it("serves the API through the default export", async () => {
    const guest = new Guest(server);

    const created = await guest.post("/api/games");
    expect(created.status).toBe(201);

    const listed = await guest.get("/api/games");
    expect(listed.status).toBe(200);
    expect(listed.body.games.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 12: Rewrite `static/game/main.js` for the new API**

Replace the whole file:

```js
const EMPTY = 0;
const DARK = 1;
const LIGHT = 2;

const WINNER_DRAW = 0;
const WINNER_DARK = 1;
const WINNER_LIGHT = 2;

// Sent on every POST: the server rejects state-changing requests without it (CSRF).
const POST_HEADERS = {
  "Content-Type": "application/json",
  "X-Requested-With": "reversi",
};

const boardElement = document.getElementById("board");
const nextDiscMessageElement = document.getElementById("next-disc-message");
const warningMessageElement = document.getElementById("warning-message");

let gameId;
let currentState;

async function main() {
  const idParam = new URLSearchParams(location.search).get("id");
  if (idParam === null) {
    const response = await fetch("/api/games", { method: "POST", headers: POST_HEADERS });
    if (!response.ok) {
      showErrorForStatus(response.status);
      return;
    }
    gameId = (await response.json()).id;
    // Keep the game in the URL so a reload resumes it instead of starting a new one.
    history.replaceState(null, "", `/game/?id=${gameId}`);
  } else {
    gameId = idParam;
  }

  await refreshState();
}

async function refreshState() {
  const response = await fetch(`/api/games/${encodeURIComponent(gameId)}`);
  if (!response.ok) {
    showErrorForStatus(response.status);
    return;
  }
  render(await response.json(), undefined);
}

function render(state, previousDisc) {
  currentState = state;

  showWarningMessage(previousDisc, state.nextDisc, state.winnerDisc);
  showNextDiscMessage(state.nextDisc);

  while (boardElement.firstChild) {
    boardElement.removeChild(boardElement.firstChild);
  }

  state.board.forEach((line, y) => {
    line.forEach((square, x) => {
      const squareElement = document.createElement("div");
      squareElement.className = "square";

      if (square !== EMPTY) {
        const stoneElement = document.createElement("div");
        const color = square === DARK ? "dark" : "light";
        stoneElement.className = `stone ${color}`;

        squareElement.appendChild(stoneElement);
      } else if (state.nextDisc !== null) {
        squareElement.addEventListener("click", () => registerMove(x, y));
      }

      boardElement.appendChild(squareElement);
    });
  });
}

async function registerMove(x, y) {
  const previousDisc = currentState.nextDisc;
  const response = await fetch(`/api/games/${encodeURIComponent(gameId)}/turns`, {
    method: "POST",
    headers: POST_HEADERS,
    body: JSON.stringify({ turnCount: currentState.turnCount + 1, move: { x, y } }),
  });

  if (response.status === 201) {
    render(await response.json(), previousDisc);
  } else if (response.status === 400) {
    showCannotPlaceMessage();
  } else if (response.status === 409) {
    // The board is out of date (another tab moved, or the game ended): reload it.
    await refreshState();
  } else {
    showErrorForStatus(response.status);
  }
}

function discToString(disc) {
  return disc === DARK ? "Black" : "White";
}

function showWarningMessage(previousDisc, nextDisc, winnerDisc) {
  const message = warningMessage(previousDisc, nextDisc, winnerDisc);

  warningMessageElement.innerText = message;

  if (message === null) {
    warningMessageElement.style.display = "none";
  } else {
    warningMessageElement.style.display = "block";
  }

  warningMessageElement.style.background = warningMessageColor(
    previousDisc,
    nextDisc,
    winnerDisc,
  );
}

function warningMessageColor(previousDisc, nextDisc, winnerDisc) {
  if (nextDisc !== null) {
    if (previousDisc === nextDisc) {
      return "#c94542";
    } else {
      return "";
    }
  } else {
    if (winnerDisc === WINNER_DRAW) {
      return "";
    } else {
      return "#469c3d";
    }
  }
}

function warningMessage(previousDisc, nextDisc, winnerDisc) {
  if (nextDisc !== null) {
    if (previousDisc === nextDisc) {
      const skipped = nextDisc === DARK ? LIGHT : DARK;
      return `Skip ${discToString(skipped)} turn`;
    } else {
      return null;
    }
  } else {
    if (winnerDisc === WINNER_DRAW) {
      return "Draw";
    } else {
      return `Congratulations: ${discToString(winnerDisc)} won!!!`;
    }
  }
}

function showNextDiscMessage(nextDisc) {
  if (nextDisc) {
    nextDiscMessageElement.innerText = `Next: ${discToString(nextDisc)} turn`;
  } else {
    nextDiscMessageElement.innerText = "";
  }
  nextDiscMessageElement.style.background = "";
}

function showCannotPlaceMessage() {
  nextDiscMessageElement.innerText = "You can't place a stone there";
  nextDiscMessageElement.style.background = "#fffc63";
}

function showErrorForStatus(status) {
  const messages = {
    404: "Game not found",
    429: "Too many new games — try again later",
    503: "The server is temporarily unavailable",
  };

  while (boardElement.firstChild) {
    boardElement.removeChild(boardElement.firstChild);
  }
  warningMessageElement.style.display = "none";
  nextDiscMessageElement.innerText = messages[status] ?? "Something went wrong";
  nextDiscMessageElement.style.background = "#fffc63";
}

main();
```

- [ ] **Step 13: Run all suites**

Run: `npx tsc --noEmit && npm test && npm run test:integration`
Expected: all pass. `grep -rn "latest" src/presentation src/application` prints nothing.

- [ ] **Step 14: Manual API smoke test against `reversi_test`**

```bash
DB_NAME=reversi_test npm start &
sleep 8
curl -s -i -X POST -H 'X-Requested-With: reversi' -H 'Origin: http://localhost:3000' localhost:3000/api/games | grep -iE '^(HTTP|set-cookie|location)'
kill %1
```

Expected: `HTTP/1.1 201`, a `Set-Cookie: rv_player=…; Max-Age=34560000; Path=/; …; HttpOnly; SameSite=Lax`, and `Location: /api/games/<id>`.

- [ ] **Step 15: Commit**

```bash
git add -A src/presentation src/application static/game/main.js test/unit/validation.test.ts test/unit/errorHandler.test.ts test/integration/api.test.ts test/integration/connection.test.ts test/integration/vercelEntry.test.ts src/infrastructure/query/findLastGamesMYSQLQueryService.ts
git status --short
git commit -m "Switch the API and the game page to game IDs

POST /api/games creates a guest if needed and a local game;
GET /api/games/:gameId and POST /api/games/:gameId/turns act only for
the game's participants; GET /api/games lists only the caller's games.
The latest-game routes and use cases are removed. The Phase 0
connection and Vercel entry tests are ported with every assertion kept.
The page keeps the game ID in the URL, so a reload resumes the game."
```

(Before committing, confirm `git status --short` shows the three deleted use cases as `D` and nothing unexpected.)

---

### Task 9: CSRF protection

**Files:**
- Create: `src/presentation/middleware/csrfProtection.ts`
- Modify: `src/main.ts`, `src/presentation/errorHandler.ts`, `test/integration/api.test.ts`
- Test: `test/unit/csrfProtection.test.ts`

**Interfaces:**
- Produces: `csrfProtection(req, res, next)`, `class CsrfRejectedError extends Error`.

- [ ] **Step 1: Write the failing unit test**

`test/unit/csrfProtection.test.ts`:

```ts
import express from "express";
import { describe, expect, it } from "vitest";
import { csrfProtection, CsrfRejectedError } from "../../src/presentation/middleware/csrfProtection";

function check(method: string, headers: Record<string, string>, protocol = "http"): unknown {
  const req = {
    method,
    protocol,
    get: (name: string) => headers[name.toLowerCase()],
  } as unknown as express.Request;
  let passed: unknown = "not called";
  csrfProtection(req, {} as express.Response, (err?: unknown) => {
    passed = err;
  });
  return passed;
}

const sameOrigin = { host: "localhost:3000", origin: "http://localhost:3000", "x-requested-with": "reversi" };

describe("csrfProtection", () => {
  it.each(["GET", "HEAD", "OPTIONS"])("lets %s through without checks", (method) => {
    expect(check(method, {})).toBeUndefined();
  });

  it("accepts a same-origin POST with the header", () => {
    expect(check("POST", sameOrigin)).toBeUndefined();
  });

  it("uses x-forwarded-proto behind Vercel", () => {
    const headers = { ...sameOrigin, origin: "https://reversi.example", host: "reversi.example", "x-forwarded-proto": "https" };
    expect(check("POST", headers)).toBeUndefined();
  });

  it.each([
    ["without the header", { host: "localhost:3000", origin: "http://localhost:3000" }],
    ["with a wrong header value", { ...sameOrigin, "x-requested-with": "XMLHttpRequest" }],
    ["without an Origin", { host: "localhost:3000", "x-requested-with": "reversi" }],
    ["from another origin", { ...sameOrigin, origin: "http://evil.example" }],
    ["from another port", { ...sameOrigin, origin: "http://localhost:4000" }],
    ["from another scheme", { ...sameOrigin, origin: "https://localhost:3000" }],
  ])("rejects a POST %s", (_label, headers) => {
    expect(check("POST", headers)).toBeInstanceOf(CsrfRejectedError);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `csrfProtection`.

- [ ] **Step 3: Implement `src/presentation/middleware/csrfProtection.ts`**

```ts
import express from "express";

export class CsrfRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsrfRejectedError";
  }
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const CSRF_HEADER = "x-requested-with";
const CSRF_HEADER_VALUE = "reversi";

/**
 * On top of SameSite=Lax cookies: a custom header forces a CORS preflight for
 * cross-origin scripts (which this API never approves) and cannot be set by
 * an HTML form, and the Origin must be this site.
 */
export function csrfProtection(
  req: express.Request,
  _res: express.Response,
  next: express.NextFunction,
) {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }
  if (req.get(CSRF_HEADER) !== CSRF_HEADER_VALUE) {
    next(new CsrfRejectedError("Missing or invalid X-Requested-With header"));
    return;
  }
  const origin = req.get("origin");
  if (!origin || origin !== expectedOrigin(req)) {
    next(new CsrfRejectedError("Cross-origin request rejected"));
    return;
  }
  next();
}

function expectedOrigin(req: express.Request): string {
  const forwardedProto = req.get("x-forwarded-proto")?.split(",")[0].trim();
  return `${forwardedProto || req.protocol}://${req.get("host")}`;
}
```

- [ ] **Step 4: Map it and wire it**

In `src/presentation/errorHandler.ts`, add `import { CsrfRejectedError } from "./middleware/csrfProtection";` and, after the `ValidationError` branch:

```ts
  if (err instanceof CsrfRejectedError) {
    res.status(403).json({ type: "CsrfRejected", message: err.message });
    return;
  }
```

In `src/main.ts`, add `import { csrfProtection } from "./presentation/middleware/csrfProtection";` after the `attachPlayer` import, and add `app.use("/api", csrfProtection);` on the line **before** `app.use("/api", attachPlayer);` (rejected requests never reach the database).

- [ ] **Step 5: Add the HTTP cases to `test/integration/api.test.ts`**

Append:

```ts
describe("CSRF protection", () => {
  it("rejects a POST without the header, and creates no guest", async () => {
    const response = await new Guest(server).post("/api/games", undefined, { csrf: false });

    expect(response.status).toBe(403);
    expect(response.body.type).toBe("CsrfRejected");
    expect(response.setCookie).toBeUndefined();
  });

  it("rejects a POST from another origin", async () => {
    const response = await new Guest(server).post("/api/games", undefined, { origin: "http://evil.example" });

    expect(response.status).toBe(403);
  });

  it("rejects a move without the header and records nothing", async () => {
    const guest = new Guest(server);
    const gameId = await startGame(guest);

    const response = await guest.post(
      `/api/games/${gameId}/turns`,
      { turnCount: 1, move: { x: 4, y: 2 } },
      { csrf: false },
    );

    expect(response.status).toBe(403);
    expect((await guest.get(`/api/games/${gameId}`)).body.turnCount).toBe(0);
  });

  it("lets GET requests through without the header", async () => {
    expect((await new Guest(server).get("/api/games")).status).toBe(200);
  });
});
```

- [ ] **Step 6: Run all suites**

Run: `npx tsc --noEmit && npm test && npm run test:integration`
Expected: all pass (the test client and the page already send the header).

- [ ] **Step 7: Commit**

```bash
git add src/presentation/middleware/csrfProtection.ts src/presentation/errorHandler.ts src/main.ts test/unit/csrfProtection.test.ts test/integration/api.test.ts
git commit -m "Protect state-changing API requests against CSRF

Beyond SameSite=Lax, every non-GET request under /api must carry
X-Requested-With: reversi and a same-origin Origin header, and is
rejected with 403 before any database work."
```

---

### Task 10: Documentation

**Files:**
- Modify: `docs/deployment.md`, `README.md`, `docs/openapi.yaml`, `docs/superpowers/specs/2026-09-25-phase-1-identity-design.md` (fix one cross-reference)

- [ ] **Step 1: `docs/deployment.md`**

1. In the table of section 5, add after the `DB_POOL_MAX` row:

```markdown
| `IP_HASH_SECRET` | At least 32 random characters (`openssl rand -base64 48`); used to hash client IPs for the new-guest cap. Use a different value per environment |
```

2. Replace the whole of section 6 ("Preview deployments") with:

````markdown
## 6. Preview deployments

Every push to a non-production branch (for example a `feat/phase-N-*` branch)
creates a Preview deployment. Feature branches can change the schema, so a
preview must never point at the production database.

Aiven's free tier allows **one** MySQL service, so previews use a second
database, `reversi_preview`, on the same service. This is the intended setup,
not a fallback. Load the schema into it under its own name:

```bash
sed -e 's/ reversi;/ reversi_preview;/' mysql/init.sql | \
  mysql --host=<host> --port=<port> --user=avnadmin --password \
    --ssl-mode=VERIFY_CA --ssl-ca=ca.pem
```

In Vercel, each environment variable is assigned to one or more environments
(Production, Preview, Development). Add every `DB_*` variable and
`IP_HASH_SECRET` **twice**:

- once scoped to **Production**, with `DB_NAME=reversi`;
- once scoped to **Preview**, with `DB_NAME=reversi_preview`.

Never tick Preview on a production value. If a variable is missing from the
Preview scope, preview deployments fail with `Missing required environment
variable` rather than silently falling back to production.

Both databases share the service's 76 connections, so the pool budget in
section 7 covers production and preview instances together.
````

3. Insert a new section before "## 7. Sizing the connection pool" and renumber the later sections (7 → 9, 8 → 10):

````markdown
## 7. Migrations (before every deploy)

Schema changes are versioned in `src/infrastructure/migration/migrations.ts`
and recorded in each database's `schema_migrations` table. Apply them by hand
**before** deploying code that needs them — to `reversi_preview` before a
preview deploy, and to `reversi` before a production deploy:

```bash
npm run migrate -- --env-file .env.preview --database reversi_preview
```

The env file holds that environment's `DB_*` values, including `DB_CA_CERT`
(`.env.*` files are gitignored). The command refuses to run if `--database`
does not match `DB_NAME`, or if a remote host is used without `DB_CA_CERT`.
Migrations only add to the schema, so the currently deployed code keeps
working while they are applied.

If code is deployed before its migrations, API requests return 503 and the
function logs contain a line like:

```
Request failed: {"method":"POST","path":"/api/games","error":{"name":"SchemaOutOfDateError","message":"Database schema is missing migrations: 001_create_players_and_game_players. Run `npm run migrate` against this database."}}
```

## 8. Firewall rate limit

Add one rate-limit rule in **Firewall → Configure → New Rule** (Hobby allows
one): if the request path starts with `/api/`, rate limit with a fixed window
of **60 s** and **300 requests** per **IP**, action **Default (429)**.
Blocked requests never reach the function, so they do not count towards the
monthly invocation limit. The app additionally caps new guests at 20 per IP
per hour and new games at 10 per player per hour.
````

4. Update the pool sizing text (now section 9) by appending:

```markdown
On the free tier, `max_connections` is 76 and is shared by `reversi` and
`reversi_preview`; with `DB_POOL_MAX=3`, keep the total number of concurrent
instances across both environments under about 23.
```

5. In the "Verify the deployment" section (now 10), append a troubleshooting item:

```markdown
5. If the API returns 503, open the function logs: `ECONNREFUSED`,
   `ETIMEDOUT`, or `ENOTFOUND` means the database is unreachable (an idle
   Aiven free-tier service powers off; power it on in the Aiven console);
   `SchemaOutOfDateError` means migrations are missing (section 7).
```

6. Update cross-references that pointed at "section 7" for pool sizing to "section 9".

- [ ] **Step 2: `README.md`**

1. Replace the "API Endpoints" table with:

```markdown
| Method | Path | Description |
| --- | --- | --- |
| `GET`  | `/api/me` | The current guest's display name (404 if this browser has no player yet) |
| `POST` | `/api/games` | Start a local game (creates a guest and its cookie if needed) |
| `GET`  | `/api/games` | The current player's recent games |
| `GET`  | `/api/games/:gameId` | The game's current state (participants only) |
| `POST` | `/api/games/:gameId/turns` | Make a move: `{ "turnCount": n, "move": { "x": 0-7, "y": 0-7 } }` |

POST requests must send `X-Requested-With: reversi` (CSRF protection).
```

2. In "Setup", after step 3 (loading the DDL), add:

````markdown
### 3b. Apply migrations

```bash
npm run migrate -- --database reversi
```
````

3. Add a section before "Project Structure":

````markdown
## Tests

```bash
npm test                  # unit tests
npm run test:integration  # needs the Docker MySQL; uses the reversi_test database
npx playwright install chromium   # once
npm run test:e2e          # browser tests; starts the app on port 3000 against reversi_test
```

The integration and e2e suites both rebuild `reversi_test`; run them one
after the other.
````

- [ ] **Step 3: `docs/openapi.yaml`** — replace the whole file:

```yaml
openapi: '3.0.3'

info:
  title: reversi-web-app
  version: 2.0.0
  description: >
    Guests are identified by an httpOnly cookie set by POST /api/games.
    Every POST must send `X-Requested-With: reversi` and a same-origin
    `Origin` header, or it is rejected with 403.

components:
  schemas:
    Error:
      type: object
      required: [type, message]
      properties:
        type:
          type: string
          example: GameNotFound
        message:
          type: string
    GameState:
      type: object
      required: [id, turnCount, board, nextDisc, winnerDisc, yourDiscs]
      properties:
        id:
          type: integer
          example: 42
        turnCount:
          type: integer
          example: 1
        board:
          type: array
          items:
            type: array
            items:
              type: integer
              enum: [0, 1, 2]
          example:
            [
              [0, 0, 0, 0, 0, 0, 0, 0],
              [0, 0, 0, 0, 0, 0, 0, 0],
              [0, 0, 0, 0, 1, 0, 0, 0],
              [0, 0, 0, 1, 1, 0, 0, 0],
              [0, 0, 0, 2, 1, 0, 0, 0],
              [0, 0, 0, 0, 0, 0, 0, 0],
              [0, 0, 0, 0, 0, 0, 0, 0],
              [0, 0, 0, 0, 0, 0, 0, 0],
            ]
        nextDisc:
          type: integer
          nullable: true
          enum: [1, 2]
          description: null once the game has ended
        winnerDisc:
          type: integer
          nullable: true
          enum: [0, 1, 2]
          description: null until the game has ended; 0 = draw
        yourDiscs:
          type: array
          items:
            type: integer
            enum: [1, 2]
          example: [1, 2]
  responses:
    Error:
      description: Error
      content:
        application/json:
          schema:
            $ref: '#/components/schemas/Error'
  parameters:
    GameId:
      name: gameId
      in: path
      required: true
      schema:
        type: integer
        minimum: 1
        maximum: 2147483647

paths:
  /api/me:
    get:
      responses:
        200:
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  displayName:
                    type: string
                    example: Guest 4821
        404:
          $ref: '#/components/responses/Error'

  /api/games:
    get:
      description: The current player's 10 most recent games (empty without a cookie).
      responses:
        200:
          description: OK
          content:
            application/json:
              schema:
                type: object
                properties:
                  games:
                    type: array
                    items:
                      type: object
                      properties:
                        id:
                          type: integer
                          example: 1
                        darkMoveCount:
                          type: integer
                          example: 1
                        lightMoveCount:
                          type: integer
                          example: 1
                        winnerDisc:
                          type: integer
                          nullable: true
                          example: 1
                        startedAt:
                          type: string
                          example: 2017-07-21T17:32:28Z
                        endAt:
                          type: string
                          example: 2017-07-21T17:32:28Z
    post:
      description: Starts a local game (one player on both colours), creating a guest and its cookie if needed.
      responses:
        201:
          description: Created
          headers:
            Location:
              schema:
                type: string
                example: /api/games/42
          content:
            application/json:
              schema:
                type: object
                properties:
                  id:
                    type: integer
                    example: 42
        403:
          $ref: '#/components/responses/Error'
        429:
          $ref: '#/components/responses/Error'
        503:
          $ref: '#/components/responses/Error'

  /api/games/{gameId}:
    parameters:
      - $ref: '#/components/parameters/GameId'
    get:
      responses:
        200:
          description: OK
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/GameState'
        400:
          $ref: '#/components/responses/Error'
        404:
          $ref: '#/components/responses/Error'

  /api/games/{gameId}/turns:
    parameters:
      - $ref: '#/components/parameters/GameId'
    post:
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [turnCount, move]
              properties:
                turnCount:
                  type: integer
                  minimum: 1
                  description: The turn this move creates (current turnCount + 1)
                  example: 1
                move:
                  type: object
                  required: [x, y]
                  properties:
                    x:
                      type: integer
                      minimum: 0
                      maximum: 7
                      example: 4
                    y:
                      type: integer
                      minimum: 0
                      maximum: 7
                      example: 2
      responses:
        201:
          description: Created; the new state
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/GameState'
        400:
          $ref: '#/components/responses/Error'
        403:
          $ref: '#/components/responses/Error'
        404:
          $ref: '#/components/responses/Error'
        409:
          description: NotYourTurn, StaleTurn, or GameAlreadyEnded
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
```

- [ ] **Step 4: Fix the spec cross-reference**

In `docs/superpowers/specs/2026-09-25-phase-1-identity-design.md` §16 item 1, change `(§17.1)` to `(§17.2)`.

- [ ] **Step 5: Verify and commit**

Run: `grep -n "section [0-9]" docs/deployment.md` — every reference points at the right section.

```bash
git add docs/deployment.md README.md docs/openapi.yaml docs/superpowers/specs/2026-09-25-phase-1-identity-design.md
git commit -m "Docs: migrations, firewall rule, IP_HASH_SECRET, preview database, new API"
```

---

### Task 11: Browser end-to-end suite, manual browser checks, final verification

**Files:**
- Create: `playwright.config.ts`, `test/e2e/globalSetup.ts`, `test/e2e/support.ts`, `test/e2e/localPlay.spec.ts`, `test/e2e/guestIsolation.spec.ts`, `test/e2e/csrf.spec.ts`, `test/e2e/staleTab.spec.ts`
- Modify: `package.json` / `package-lock.json`, `tsconfig.json`, `.gitignore`

**Interfaces:**
- Consumes: `rebuildTestDatabase`, `assertTestDatabase`, `TEST_DATABASE` (Task 1); the page from Task 8; CSRF from Task 9.

- [ ] **Step 1: Install Playwright**

Run: `npm install -D @playwright/test@^1.63.0 && npx playwright install chromium`

In `package.json` `scripts`, add after `test:integration`:

```json
    "test:e2e": "playwright test",
```

In `tsconfig.json`, change `include` to:

```json
  "include": ["src", "api", "test", "vitest.config.ts", "playwright.config.ts"]
```

Append to `.gitignore`:

```
test-results/
playwright-report/
```

- [ ] **Step 2: Create `playwright.config.ts`**

```ts
import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Same local settings as npm start; DB_NAME is overridden below.
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

const BASE_URL = "http://localhost:3000";

// The app under test always uses reversi_test: a variable set in the process
// environment wins over the same one in .env (loaded by --env-file).
const serverEnv: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (value !== undefined) {
    serverEnv[key] = value;
  }
}
serverEnv.DB_NAME = "reversi_test";

export default defineConfig({
  testDir: "test/e2e",
  testMatch: "*.spec.ts",
  // The specs share reversi_test; run them one at a time.
  workers: 1,
  fullyParallel: false,
  globalSetup: "./test/e2e/globalSetup.ts",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node --env-file=.env -r ts-node/register src/main.ts",
    url: `${BASE_URL}/`,
    env: serverEnv,
    // Never reuse a server already on port 3000: it may be a dev server
    // pointing at the reversi database.
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
```

- [ ] **Step 3: Create `test/e2e/globalSetup.ts` and `test/e2e/support.ts`**

`test/e2e/globalSetup.ts`:

```ts
import { FullConfig } from "@playwright/test";
import { assertTestDatabase } from "../support/testDatabase";
import { rebuildTestDatabase } from "../integration/globalSetup";

export default async function globalSetup(config: FullConfig): Promise<void> {
  // Check the environment the app will actually start with.
  const webServers = config.webServer ? [config.webServer] : [];
  for (const server of webServers) {
    assertTestDatabase({ ...process.env, ...(server.env ?? {}) });
  }
  if (webServers.length === 0) {
    throw new Error("The e2e suite must start its own app (webServer)");
  }
  await rebuildTestDatabase();
}
```

`test/e2e/support.ts`:

```ts
import { expect, Page } from "@playwright/test";

export const POST_HEADERS = { "Content-Type": "application/json", "X-Requested-With": "reversi" };

export function squares(page: Page) {
  return page.locator("#board .square");
}

export function stones(page: Page) {
  return page.locator("#board .stone");
}

/** Opens /game/, which starts a new game, and waits for the initial board. */
export async function startGame(page: Page): Promise<string> {
  await page.goto("/game/");
  await expect(page).toHaveURL(/\/game\/\?id=\d+$/);
  await expect(stones(page)).toHaveCount(4);
  return new URL(page.url()).searchParams.get("id")!;
}

export async function clickSquare(page: Page, x: number, y: number) {
  await squares(page).nth(y * 8 + x).click();
}

/** Each square's stone class ("stone dark", "stone light", or "") in board order. */
export async function boardSignature(page: Page): Promise<string[]> {
  return squares(page).evaluateAll((elements) =>
    elements.map((element) => element.querySelector(".stone")?.className ?? ""),
  );
}
```

- [ ] **Step 4: Write the specs**

`test/e2e/localPlay.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { boardSignature, clickSquare, stones } from "./support";

// Legal in sequence from the opening: black, white, black, white.
const MOVES: [number, number][] = [
  [4, 2],
  [3, 2],
  [2, 2],
  [5, 4],
];

test("a local game resumes at the same position after a reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Start a Match" }).click();
  await expect(page).toHaveURL(/\/game\/\?id=\d+$/);
  await expect(stones(page)).toHaveCount(4);

  for (const [index, [x, y]] of MOVES.entries()) {
    await clickSquare(page, x, y);
    await expect(stones(page)).toHaveCount(5 + index);
  }
  await expect(page.locator("#next-disc-message")).toHaveText("Next: Black turn");
  const url = page.url();
  const before = await boardSignature(page);

  await page.reload();

  await expect(stones(page)).toHaveCount(8);
  expect(page.url()).toBe(url);
  expect(await boardSignature(page)).toEqual(before);
  await expect(page.locator("#next-disc-message")).toHaveText("Next: Black turn");
});
```

`test/e2e/guestIsolation.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { POST_HEADERS, squares, startGame, stones } from "./support";

test("another guest gets the not-found page and cannot move", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  try {
    const pageA = await contextA.newPage();
    const gameId = await startGame(pageA);

    const pageB = await contextB.newPage();
    await startGame(pageB); // B is a guest with its own cookie
    await pageB.goto(`/game/?id=${gameId}`);

    await expect(pageB.locator("#next-disc-message")).toHaveText("Game not found");
    await expect(squares(pageB)).toHaveCount(0);

    const status = await pageB.evaluate(
      async ({ id, headers }) => {
        const response = await fetch(`/api/games/${id}/turns`, {
          method: "POST",
          headers,
          body: JSON.stringify({ turnCount: 1, move: { x: 4, y: 2 } }),
        });
        return response.status;
      },
      { id: gameId, headers: POST_HEADERS },
    );
    expect(status).toBe(404);

    await pageA.reload();
    await expect(stones(pageA)).toHaveCount(4);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
```

`test/e2e/csrf.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { startGame, stones } from "./support";

test("a move request without the CSRF header is rejected", async ({ page }) => {
  const gameId = await startGame(page);

  const result = await page.evaluate(async (id) => {
    const response = await fetch(`/api/games/${id}/turns`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ turnCount: 1, move: { x: 4, y: 2 } }),
    });
    return { status: response.status, body: await response.json() };
  }, gameId);

  expect(result.status).toBe(403);
  expect(result.body.type).toBe("CsrfRejected");
  await page.reload();
  await expect(stones(page)).toHaveCount(4);
});
```

`test/e2e/staleTab.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { boardSignature, clickSquare, startGame, stones } from "./support";

test("a stale second tab re-renders the latest board instead of failing", async ({ context }) => {
  const first = await context.newPage();
  const gameId = await startGame(first);
  const second = await context.newPage();
  await second.goto(`/game/?id=${gameId}`);
  await expect(stones(second)).toHaveCount(4);

  await clickSquare(first, 4, 2);
  await expect(stones(first)).toHaveCount(5);

  // The second tab still shows the opening and tries the same move: 409, then refresh.
  await clickSquare(second, 4, 2);

  await expect(stones(second)).toHaveCount(5);
  await expect(second.locator("#next-disc-message")).toHaveText("Next: White turn");
  expect(await boardSignature(second)).toEqual(await boardSignature(first));
});
```

- [ ] **Step 5: Run the e2e suite**

Make sure nothing listens on port 3000 (`lsof -iTCP:3000 -sTCP:LISTEN` prints nothing).

Run: `npm run test:e2e`
Expected: 4 passed.

Then confirm the app used `reversi_test` (and never `reversi`):

```bash
docker-compose exec -T mysql mysql -uroot -prootpassword -N -e "select count(*) from reversi_test.game_players; select count(*) from information_schema.tables where table_schema = 'reversi' and table_name = 'game_players';"
```

Expected: a positive count for `reversi_test.game_players`; `0` for the table in `reversi` (it was never migrated).

- [ ] **Step 6: Commit**

```bash
git add playwright.config.ts test/e2e package.json package-lock.json tsconfig.json .gitignore
git commit -m "Add browser end-to-end tests with Playwright (npm run test:e2e)

The suite starts the app itself against reversi_test and never reuses
a server already on port 3000. It covers resuming a local game after a
reload, two guests being isolated, CSRF rejection from a real page, and
a stale second tab recovering."
```

- [ ] **Step 7: Manual browser checks with the Playwright MCP server**

Only against the local app on `reversi_test`; never open preview or production URLs.

```bash
npm run test:integration   # rebuilds reversi_test
DB_NAME=reversi_test npm start
```

With the Playwright MCP tools, at `http://localhost:3000`:

1. Home page loads; "Start a Match" opens `/game/?id=N` with the initial board.
2. Play a complete game to the end (click legal squares until the board fills or neither side can move); check the winner or draw message, that a skip message appears if a pass occurs, and that squares are no longer clickable.
3. Reload mid-game in a new game: the position is unchanged.
4. Click an occupied or illegal square: "You can't place a stone there".
5. Open `/game/?id=2147483647`: "Game not found".
6. Back on the home page, the history table lists the games just played.
7. Check the browser console has no errors (`browser_console_messages`).

Stop the server afterwards. Record which checks passed for the report.

- [ ] **Step 8: Final verification**

```bash
npx tsc --noEmit
npm test
npm run test:integration
npm run test:e2e
git status --short                      # empty
git diff main --stat
git diff main --name-status -- src/domain   # only "A" lines, under src/domain/model/gamePlayer/
git grep -nE "password|secret" -- src api     # review each hit by eye
```

Expected: all suites pass; the domain diff lists only added files under `src/domain/model/gamePlayer/`; every `password`/`secret` hit is a variable name or env lookup, never a value.

- [ ] **Step 9: End-of-phase report (to the user, not committed)**

Include: what was built; test counts per suite; which checks were done manually in the browser (Step 7) versus covered by committed e2e specs (Step 4); deviations from the plan; the deploy order for the owner (migrate `reversi_preview`, set Preview-scoped `IP_HASH_SECRET`, deploy the preview; then production); and pre-existing issues (spec §18, plus: `GameRepository.findLatest` / `GameGateway.findLatest` are now unused; README's "Configuration" section still lists the old hard-coded settings).
