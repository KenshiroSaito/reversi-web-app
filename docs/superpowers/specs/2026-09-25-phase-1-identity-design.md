# Phase 1 — Identity Foundation

- **Status:** Draft for review
- **Branch:** `feat/phase-1-identity` (from `main` at `1d28189`)
- **Date:** 2026-09-25

## 1. Goal

Know who each player is, address games by ID instead of "the latest game",
and only let a player move in their own games on their own turn. Local play
(one person playing both colours) is rebuilt on top of this.

Done means:

1. A visitor who starts a game becomes a guest player, identified by an
   httpOnly cookie, without signing up.
2. Every game API call names a game by ID, and the server allows it only
   for that game's participants. The "latest game" endpoints are gone.
3. A move is accepted only from the player seated on the colour to move,
   is saved atomically, and duplicates or stale moves are rejected.
4. Abuse is bounded: a firewall rate limit per IP, a cap on new guests per
   IP, and a cap on new games per player.
5. The schema evolves through versioned migrations, and a deployment whose
   database is behind the code fails with a clear error.
6. Server errors are logged with their real cause; an unreachable database
   returns 503.
7. Local play works in the browser on the new API, and reloading the page
   resumes the game.

## 2. Non-goals

| Excluded | Phase | Reason |
| --- | --- | --- |
| `users` table, `players.user_id`, OAuth | 5 | Nothing needs them before sign-in; a later migration adds them |
| `last_seen_at`, clocks, polling/304, resign, abort, cron | 2 | Game-ending rules |
| `games.mode` (local / bot / online) | 3–4 | Only one mode exists; seats already describe a local game |
| Spectating others' games | later | Participants only; non-participants get 404 |
| Editable display names | 5–6 | Profiles |
| The DATETIME time-zone fix | start of 2 | As agreed. New Phase 1 columns use the database clock (`CURRENT_TIMESTAMP(3)`) so they are unaffected |
| Changing how boards are stored | see §16 | Existing storage design; flagged for decision |
| Editing existing files in `src/domain/` | — | Only new files under `src/domain/model/gamePlayer/` (approved) |

## 3. Findings that shape this design

1. **Storage cost per turn, measured.** In `reversi_test`, 1,000 turns with
   their squares and moves measured ~98 bytes per `squares` row, ~130 per
   `turns` row, and ~98 per `moves` row. One turn stores 64 squares, so:
   - a new game (turn 0) ≈ **6.5 KB**;
   - a finished game (~60 moves, ~61 turns) ≈ **400 KB**.
2. **Aiven free tier:** one MySQL service, 76 `max_connections`, 1 GB
   storage, and the service powers off when idle. `reversi` (production) and
   `reversi_preview` share that service.
3. **Vercel client IP.** Vercel overwrites `X-Forwarded-For` to prevent
   spoofing, and `x-real-ip` is identical to it. Outside Vercel, forwarding
   headers are untrusted and the socket address is used.
4. **Vercel Firewall on Hobby:** one rate-limit rule per project, fixed
   window of 10 s–10 min, keyed by IP; counters are per region; blocked
   requests never reach the function.
5. **Tests that depend on what Phase 1 removes.**
   `test/integration/connection.test.ts` calls the three "latest" use cases
   directly, and `test/integration/vercelEntry.test.ts` posts without CSRF
   headers and expects a non-empty history without a cookie. Both are
   ported; every assertion is kept (§14.3).
6. **The move flow does not need a `Game` object.** Seats prove the game
   exists; the latest `Turn` is loaded by `(gameId, turnCount)` and the
   existing `Turn.placeNext(disc, point)` does the rest. So `GameRepository`
   (domain) needs no new method.
7. **`ApplicationError` loses its only type.** `"LatestGameNotFound"` is
   used only by the use cases being deleted, so its union is replaced rather
   than a second error class added beside it.

## 4. Architecture

```
Browser ── /api/* ──► Express (one Vercel Function)
                        │
                        ├─ cookieParser
                        ├─ csrfProtection        (POST etc. under /api)
                        ├─ attachPlayer          (cookie → player, if any)
                        ├─ gameRouter / turnRouter / meRouter
                        │     └─ use cases ──► repositories / query services
                        │                         └─ connectMySQL()
                        │                              ├─ shared pool (Phase 0)
                        │                              └─ schema check on first use
                        └─ errorHandler          (maps errors, logs causes, 503)
```

Layering follows the existing code: presentation (routers, middleware,
HTTP concerns) → application (use cases, ports) → domain (rules) ←
infrastructure (MySQL gateways and repositories).

## 5. Schema and migrations

### 5.1 Migration `001_create_players_and_game_players`

```sql
create table if not exists players (
  id              int primary key auto_increment,
  token_hash      binary(32) not null,
  display_name    varchar(32) not null,
  created_ip_hash binary(32) null,
  created_at      datetime(3) not null default current_timestamp(3),
  unique key uq_players_token_hash (token_hash),
  key ix_players_ip_created (created_ip_hash, created_at)
);

create table if not exists game_players (
  game_id    int not null,
  disc       tinyint not null,
  player_id  int not null,
  created_at datetime(3) not null default current_timestamp(3),
  primary key (game_id, disc),
  key ix_game_players_player_created (player_id, created_at),
  constraint fk_game_players_game foreign key (game_id) references games (id),
  constraint fk_game_players_player foreign key (player_id) references players (id),
  constraint ck_game_players_disc check (disc in (1, 2))
);
```

- `token_hash` is SHA-256 of the cookie token; the token itself is never
  stored.
- `created_ip_hash` is HMAC-SHA-256 of the client IP with `IP_HASH_SECRET`.
- `disc` 1 = black (`Disc.Dark`), 2 = white (`Disc.Light`).
- `ix_game_players_player_created` serves both the per-player game cap and
  the player's history (InnoDB secondary indexes include the primary key,
  so `game_id` is covered).
- Existing tables are unchanged. The migration only adds tables, so it can
  be applied before the new code is deployed while the old code keeps
  running. `if not exists` makes a re-run after a partial failure safe
  (MySQL DDL is not transactional).

### 5.2 Migration runner

- `src/infrastructure/migration/migrations.ts` exports an ordered
  `MIGRATIONS: Migration[]` (`{ version, statements }`). Migrations are
  TypeScript modules rather than `.sql` files so they are always bundled
  into the Vercel Function, where the schema check needs the list.
- `applyPendingMigrations(conn, migrations)`:
  1. `create table if not exists schema_migrations (version varchar(64)
     primary key, applied_at datetime(3) not null default current_timestamp(3))`;
  2. takes `GET_LOCK('reversi_schema_migrations', 10)` so two runners cannot
     interleave, releasing it in `finally`;
  3. runs each pending migration's statements in order, then inserts its
     version; stops at the first error;
  4. returns the versions it applied.
- `mysql/init.sql` stays unchanged as the baseline schema.

### 5.3 `npm run migrate` (run by hand before deploying)

`npm run migrate -- --env-file <path> --database <name>`

- Loads the env file if given (`process.loadEnvFile`), then builds the
  connection with the existing `loadDbConfig`.
- Refuses to run unless `--database` equals the resolved `DB_NAME`, so a
  wrong env file cannot migrate the wrong database.
- Refuses a non-local host (`DB_HOST` other than `localhost` / `127.0.0.1`)
  without `DB_CA_CERT`, so remote migrations always use verified TLS.
- Prints the target host and database, then each applied version, or
  "Already up to date".

### 5.4 Schema check on first database use

`connectMySQL()` verifies the schema once per pool, using the connection it
is about to hand out:

- reads `schema_migrations` (a missing table means nothing is applied);
- if any version in `MIGRATIONS` is missing, it releases the connection and
  throws `SchemaOutOfDateError` whose message lists the missing versions and
  says to run `npm run migrate` against this database;
- versions present in the database but unknown to the code (a newer branch
  migrated this database) produce one `console.warn` and do not fail;
- success is remembered for the pool's lifetime; failure is not, so the
  next request re-checks and the instance recovers as soon as migrations
  are applied.

`errorHandler` logs the error (so the missing versions appear in the logs)
and returns 503 (§11).

## 6. Identity

### 6.1 Guest token and cookie

- Token: 32 random bytes, base64url (43 characters). Cookie values that do
  not match `^[A-Za-z0-9_-]{43}$` are ignored without a database query.
- Stored as `sha256(token)`; lookups are by `token_hash`.
- Cookie: name `__Host-rv_player` on Vercel, `rv_player` locally (the
  `__Host-` prefix requires `Secure`, which plain-http localhost cannot
  use reliably). Attributes: `HttpOnly`, `SameSite=Lax`, `Path=/`,
  `Secure` on Vercel, `Max-Age` 400 days (the browser maximum), set once at
  creation and not refreshed.
- A valid-format token with no matching player (for example after a
  database reset) is treated as no cookie; the next game creation issues a
  new guest and overwrites the cookie.

### 6.2 When guests are created

Only `POST /api/games` creates a guest, and only when the request has no
valid player. Page views and GET requests never create players, so crawlers
and repeat visits do not grow the `players` table.

### 6.3 Display names

`Guest NNNN` with `NNNN` a uniform random integer 1000–9999
(`crypto.randomInt`). Not unique, not editable in Phase 1.

### 6.4 Client IP hashing

- IP source: `x-real-ip` on Vercel (`VERCEL` is set), otherwise the socket's
  remote address. Forwarding headers are never trusted outside Vercel.
- `created_ip_hash = HMAC-SHA-256(IP_HASH_SECRET, ip)`; the raw IP is never
  stored.
- `IP_HASH_SECRET` is required; on Vercel it must be at least 32
  characters. Errors name the variable, never its value. It is read on first
  guest creation, so a missing secret fails that request (logged, 500)
  rather than the whole function.

## 7. Game rules

### 7.1 Seats (new domain files, approved)

`src/domain/model/gamePlayer/gameSeats.ts`:

```ts
export class GameSeats {
  constructor(gameId: number, seats: { disc: Disc; playerId: number }[]);
  // Throws Error unless there is exactly one seat for Dark and one for Light.
  static forLocalGame(gameId: number, playerId: number): GameSeats;
  get gameId(): number;
  get seats(): readonly { disc: Disc; playerId: number }[];
  isParticipant(playerId: number): boolean;
  discsOf(playerId: number): Disc[];                        // [1, 2] in a local game
  mayMove(playerId: number, nextDisc: Disc | undefined): boolean; // false when the game has ended
}
```

`src/domain/model/gamePlayer/gameSeatsRepository.ts`:

```ts
export interface GameSeatsRepository {
  findForGameId(conn, gameId: number, options?: { forUpdate: boolean }): Promise<GameSeats | undefined>;
  save(conn, seats: GameSeats): Promise<void>;
}
```

The invariant violation throws a plain `Error` (a corrupted database is a
server fault, 500) rather than a `DomainError`, because adding a type to
`DomainError` would edit an existing domain file.

### 7.2 Create a local game — `CreateLocalGameUseCase.run(playerId): Promise<number>`

In one transaction:

1. `playerRepository.lockForUpdate(conn, playerId)` — serialises game
   creation per player so the cap below is exact.
2. `rateLimitQuery.countGamesCreatedInLastHour(conn, playerId)`; if ≥ 10,
   throw `ApplicationError("GameCreationLimitReached")`.
3. Insert the game (existing `GameRepository.save`), the first turn
   (existing `TurnRepository.save(firstTurn(...))`), and the seats
   (`GameSeats.forLocalGame`).
4. Commit and return the game ID.

### 7.3 Make a move — `RegisterMoveUseCase.run(gameId, playerId, turnCount, point)`

In one transaction:

1. `gameSeatsRepository.findForGameId(conn, gameId, { forUpdate: true })` —
   the first statement, so concurrent moves on the same game queue here and
   each later one reads the committed result of the earlier one.
2. No seats, or `!seats.isParticipant(playerId)` → `GameNotFound` (404).
3. Load the latest turn count and that `Turn`.
4. `turn.gameEnded()` → `GameAlreadyEnded` (409).
5. `turnCount !== latest + 1` → `StaleTurn` (409).
6. `!seats.mayMove(playerId, turn.nextDisc)` → `NotYourTurn` (409). In a
   local game this cannot happen; it is exercised by unit tests with two
   different players, ready for Phase 4.
7. `turn.placeNext(turn.nextDisc, point)` — illegal moves throw the
   existing `DomainError`s (400).
8. Save the turn (a `ER_DUP_ENTRY` from `unique (game_id, turn_count)` maps
   to `StaleTurn`, as a backstop), and the result if the game ended.
9. Commit and return the new state (same shape as §8.3).

The disc is always derived from the seats; the client no longer sends it.

### 7.4 Read a game — `FindGameStateUseCase.run(gameId, playerId)`

Seats (404 unless participant) → latest turn → result if ended → state.

### 7.5 History — `FindLastGameUseCase.run(playerId)`

The existing query gains a filter
`where g.id in (select game_id from game_players where player_id = ?)`; the
response shape is unchanged. Without a player the router returns
`{ "games": [] }` without touching the database.

## 8. API

All error bodies are `{ "type": string, "message": string }`.

### 8.1 Endpoints

| Method and path | Auth | Success | Errors |
| --- | --- | --- | --- |
| `GET /api/me` | cookie | 200 `{ "displayName": "Guest 4821" }` | 404 `PlayerNotFound` |
| `POST /api/games` | cookie or none | 201 `{ "id": 42 }`, `Location: /api/games/42`; sets the cookie if a guest was created | 403 `CsrfRejected`, 429 `GuestCreationLimitReached` / `GameCreationLimitReached` |
| `GET /api/games` | cookie or none | 200 `{ "games": [...] }` (shape unchanged) | — |
| `GET /api/games/:gameId` | cookie | 200 game state | 400 `InvalidRequest`, 404 `GameNotFound` |
| `POST /api/games/:gameId/turns` | cookie | 201 game state | 400 `InvalidRequest` / illegal move, 403, 404, 409 `NotYourTurn` / `StaleTurn` / `GameAlreadyEnded` |

Removed: `GET /api/games/latest/turns/:turnCount`,
`POST /api/games/latest/turns`, and the old body-less `POST /api/games`
that created an unowned game.

### 8.2 Move request

```json
{ "turnCount": 1, "move": { "x": 4, "y": 2 } }
```

- `:gameId`: `^[1-9][0-9]{0,9}$` and ≤ 2,147,483,647 (MySQL `int`).
- `turnCount`: a JSON integer ≥ 1 (`Number.isInteger`, so `1.5`, `"1"`, and
  `null` are rejected).
- `move.x`, `move.y`: JSON integers 0–7.
- Malformed JSON → 400 `InvalidRequest` (body-parser's `entity.parse.failed`).

### 8.3 Game state

```json
{
  "id": 42,
  "turnCount": 1,
  "board": [[0, 0, 0, 0, 0, 0, 0, 0], "... 8 rows ..."],
  "nextDisc": 2,
  "winnerDisc": null,
  "yourDiscs": [1, 2]
}
```

`nextDisc` is `null` once the game has ended; `winnerDisc` is `null` until
then (0 draw, 1 black, 2 white).

## 9. Security

### 9.1 CSRF

For every non-GET/HEAD/OPTIONS request under `/api`:

1. `SameSite=Lax` on the cookie (§6.1);
2. the request must carry `X-Requested-With: reversi` — a custom header
   forces a CORS preflight for cross-origin scripts, which this API never
   approves, and HTML forms cannot set it;
3. the `Origin` header must be present and equal
   `<x-forwarded-proto or req.protocol>://<host>`.

Failure → 403 `CsrfRejected`.

### 9.2 Other

- All SQL uses placeholders (existing rule).
- Turn ownership is checked on the server for every move (§7.3).
- No secrets, tokens, cookies, or request bodies are logged (§11).

## 10. Rate limiting and storage

### 10.1 Limits

| Layer | Limit | Where |
| --- | --- | --- |
| Vercel Firewall | 300 requests / 60 s per IP on `/api/*`, action 429 | Dashboard (owner), documented in `docs/deployment.md` |
| New guests | 20 per IP hash per rolling hour | `RegisterGuestUseCase` |
| New games | **10 per player per rolling hour** | `CreateLocalGameUseCase` |

Windows are computed with the database clock
(`created_at > current_timestamp(3) - interval 1 hour`) on both sides of
the comparison, so they are correct regardless of the app's time zone.

The guest cap is not locked: concurrent requests from one IP can overshoot
by at most the number of in-flight requests. The game cap is exact (player
row lock, §7.2).

### 10.2 Why 10 games per player per hour

A local game takes minutes, and reloading no longer creates a game, so 10
per hour does not constrain real play. Worst cases against 1 GB, using the
measured 6.5 KB per new game:

| Scenario | Growth | Time to 1 GB |
| --- | --- | --- |
| No per-player cap: one cookie at the firewall limit (300 games/min) | ≈ 117 MB/h | ≈ 9 h |
| With both caps: one IP, 20 guests × 10 games per hour, games left empty | ≈ 1.3 MB/h | ≈ 32 days |

Moves are not limited by these caps; see §16.1.

## 11. Error handling and logging

`errorHandler` moves from `src/main.ts` to `src/presentation/errorHandler.ts`
(it gains logging, 503 detection, and a status table; `main.ts` stays the
composition root).

| Error | Status | Body |
| --- | --- | --- |
| `DomainError` | 400 | `{ type, message }` (unchanged) |
| `ValidationError`, malformed JSON | 400 | `InvalidRequest` |
| `CsrfRejectedError` | 403 | `CsrfRejected` |
| `ApplicationError` | per type: 404 `GameNotFound` / `PlayerNotFound`; 409 `NotYourTurn` / `StaleTurn` / `GameAlreadyEnded`; 429 `GuestCreationLimitReached` / `GameCreationLimitReached` | `{ type, message }` |
| `SchemaOutOfDateError`, database unreachable | 503 | `{ "type": "ServiceUnavailable", "message": "Service temporarily unavailable" }` |
| anything else | 500 | `{ "message": "Unexpected Error occured" }` (unchanged) |

**Logging.** For 503 and 500, the handler logs one line with the method,
path, and `describeError(err)`: `name`, `message`, `code`, `errno`,
`sqlState`, `stack`, and the same fields of `err.cause` and of each entry
in `err.errors` (Node reports refused dual-stack connections as an
`AggregateError`). It never includes mysql2's `sql` field (which can
contain inlined values), headers, cookies, or bodies.

**Database unreachable** means an error (or a nested `cause`/`errors`
entry) with code `ECONNREFUSED`, `ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`,
`EAI_AGAIN`, `EHOSTUNREACH`, `ENETUNREACH`, `PROTOCOL_CONNECTION_LOST`, or
`ER_CON_COUNT_ERROR`. A powered-off Aiven service therefore shows up as a
503 whose log names the code.

## 12. Frontend (`static/game/main.js`)

- `/game/` without `?id=` → `POST /api/games` → `history.replaceState` to
  `/game/?id=<id>` → render. With `?id=` → `GET /api/games/:id` → render.
  Reloading resumes the game.
- Clicking a square → `POST /api/games/:id/turns` with `turnCount + 1`;
  the response is the new state and is rendered directly (no extra GET).
- Every POST sends `X-Requested-With: reversi` and
  `Content-Type: application/json`.
- 400 → "You can't place a stone there"; 404 → "Game not found" with the
  existing link home; 409 → re-fetch and re-render; 429 → "Too many new
  games — try again later"; 503 → "The server is temporarily unavailable".
- The existing rendering and skip/winner messages are kept; `static/main.js`
  and the HTML files are unchanged.

## 13. Documentation

- `docs/deployment.md`:
  - §6 rewritten: Aiven's free tier allows one MySQL service, so
    `reversi_preview` on the same service **is** the intended preview
    setup; both databases share its 76 connections (so prod + preview
    instances × `DB_POOL_MAX` must stay under ~70).
  - New: running `npm run migrate` against preview and production before
    each deploy, and what the `SchemaOutOfDateError` log looks like.
  - New: the firewall rule (values in §10.1).
  - New: `IP_HASH_SECRET` in the env var table
    (`openssl rand -base64 48`), scoped per environment like `DB_*`.
  - New: troubleshooting a 503 (Aiven powered off → power it on in the
    Aiven console; the log shows the error code).
- `README.md`: API table, the migrate step in local setup.
- `docs/openapi.yaml`: rewritten for the new API.

## 14. Testing

### 14.1 Unit (`npm test`)

| File | Covers |
| --- | --- |
| `gameSeats.test.ts` | local game: both discs, may move either colour; two players: each only their own colour; non-participant; ended game; invariant errors |
| `validation.test.ts` | game ID, `turnCount`, x/y: integers, ranges, types, missing fields |
| `playerToken.test.ts` | token length/alphabet, uniqueness, hash is SHA-256 of the token |
| `guestName.test.ts` | format and range (injected random source) |
| `clientIp.test.ts` | `x-real-ip` on Vercel only; HMAC depends on secret |
| `identityConfig.test.ts` | required secret, minimum length on Vercel, error text never contains the value |
| `csrfProtection.test.ts` | safe methods pass; missing header / missing or foreign `Origin` → 403 |
| `errorHandler.test.ts` | status table; `describeError` omits `sql`, includes `cause` and `errors`; unreachable-database codes → 503 |
| `migrations.test.ts` | versions unique and ordered |

### 14.2 Integration (`npm run test:integration`, `reversi_test` only)

- **Safeguard (new `setupFiles` entry):** before any test file runs, throw
  unless `loadDbConfig(process.env).database === "reversi_test"`. Every file
  then fails before touching a database.
- **`globalSetup`:** after loading `init.sql`, apply `MIGRATIONS` to
  `reversi_test`.
- **Migrations / schema check:** all versions recorded; re-running applies
  nothing; deleting a version row makes `connectMySQL()` reject with
  `SchemaOutOfDateError` naming it, without leaking the connection (pool of
  1); restoring the row makes the next call succeed.
- **API** (HTTP server on port 0, cookies handled by the test client;
  per-IP guest history is cleared before each test so files do not share
  the cap):
  - first `POST /api/games` sets the cookie with the §6.1 attributes;
    `GET /api/me` returns `Guest NNNN`;
  - CSRF: missing header or foreign `Origin` → 403; GET without them → 200;
  - another guest's cookie, or none, on someone's game → 404;
  - legal move → 201 with the new state; illegal → 400; `x` of 1.5, 8,
    `"3"` → 400; stale `turnCount` → 409; move on an ended game → 409;
  - two identical moves sent concurrently (pool of 2 in that file) → one
    201, one 409, and exactly one new turn row;
  - history lists only the caller's games;
  - 21st guest from one IP within the hour → 429; 11th game for one player
    within the hour → 429.
- **Database unreachable:** with `DB_PORT` stubbed to a closed port,
  `POST /api/games` → 503 `ServiceUnavailable`, and the logged line
  contains `ECONNREFUSED`.
- **Manual:** play a full local game in the browser against
  `reversi_test` (`DB_NAME=reversi_test npm start`), reload mid-game, open
  the game URL in a private window (404 page).

### 14.3 Ported tests — every assertion kept

`test/integration/connection.test.ts` keeps all 10 `expect` calls; the
assertion lines are identical except the calls they wrap
(`findTurn.run(n)` → `findGameState.run(gameId, playerId)`,
`findLastGames.run()` → `findLastGames.run(playerId)`). The rollback case
still throws after `beginTransaction()` and the game insert, and still
checks the open transaction, the reused connection ID, no open transaction
afterwards, and no `games` row. The dead-connection case is unchanged.

```diff
@@ -1,14 +1,20 @@
+import { createHash } from "node:crypto";
 import mysql from "mysql2/promise";
 import { afterAll, beforeAll, describe, expect, it } from "vitest";
 import { closePool, connectMySQL } from "../../src/infrastructure/connection";
-import { StartNewGameUseCase } from "../../src/application/useCase/startNewGameUseCase";
+import { RegisterGuestUseCase } from "../../src/application/useCase/registerGuestUseCase";
+import { CreateLocalGameUseCase } from "../../src/application/useCase/createLocalGameUseCase";
 import { FindLastGameUseCase } from "../../src/application/useCase/findLastGamesUseCase";
-import { FindLatestGameTurnByTurnCountUseCase } from "../../src/application/useCase/findLatestGameTurnByTurnCountUseCase";
-import { RegisterTurnUseCase } from "../../src/application/useCase/registerTurnUseCase";
+import { FindGameStateUseCase } from "../../src/application/useCase/findGameStateUseCase";
+import { RegisterMoveUseCase } from "../../src/application/useCase/registerMoveUseCase";
 import { GameMYSQLRepository } from "../../src/infrastructure/repository/game/gameMYSQLRepository";
 import { TurnMYSQLRepository } from "../../src/infrastructure/repository/turn/turnMYSQLRepository";
 import { GameResultMYSQLRepository } from "../../src/infrastructure/repository/gameResult/gameResultMYSQLRepository";
+import { GameSeatsMYSQLRepository } from "../../src/infrastructure/repository/gamePlayer/gameSeatsMYSQLRepository";
+import { PlayerMYSQLRepository } from "../../src/infrastructure/repository/player/playerMYSQLRepository";
 import { FindLastGameMySQLQueryService } from "../../src/infrastructure/query/findLastGamesMYSQLQueryService";
+import { LatestTurnMySQLQueryService } from "../../src/infrastructure/query/latestTurnMYSQLQueryService";
+import { RateLimitMySQLQueryService } from "../../src/infrastructure/query/rateLimitMYSQLQueryService";
 import { TurnRepository } from "../../src/domain/model/turn/turnRepository";
 import { Turn } from "../../src/domain/model/turn/turn";
 import { Disc } from "../../src/domain/model/turn/disc";
@@ -24,10 +30,20 @@ import {
 // fails to return its connection, the next acquire waits forever and the
 // test times out.
 
+// A fixed client-IP hash, distinct from the one HTTP tests produce, so the
+// per-IP guest cap is never shared with other test files.
+const TEST_IP_HASH = createHash("sha256").update("connection.test").digest();
+
 let admin: mysql.Connection;
+let playerId: number;
 
 beforeAll(async () => {
   admin = await adminConnection();
+  const registerGuest = new RegisterGuestUseCase(
+    new PlayerMYSQLRepository(),
+    new RateLimitMySQLQueryService(),
+  );
+  playerId = (await registerGuest.run(TEST_IP_HASH)).player.id;
 });
 
 afterAll(async () => {
@@ -37,32 +53,37 @@ afterAll(async () => {
 
 describe("connectMySQL", () => {
   it("returns every connection to the pool across a sequence of use cases", async () => {
-    const startNewGame = new StartNewGameUseCase(
+    const createLocalGame = new CreateLocalGameUseCase(
       new GameMYSQLRepository(),
       new TurnMYSQLRepository(),
+      new GameSeatsMYSQLRepository(),
+      new PlayerMYSQLRepository(),
+      new RateLimitMySQLQueryService(),
     );
     const findLastGames = new FindLastGameUseCase(new FindLastGameMySQLQueryService());
-    const findTurn = new FindLatestGameTurnByTurnCountUseCase(
+    const findGameState = new FindGameStateUseCase(
       new TurnMYSQLRepository(),
-      new GameMYSQLRepository(),
       new GameResultMYSQLRepository(),
+      new GameSeatsMYSQLRepository(),
+      new LatestTurnMySQLQueryService(),
     );
-    const registerTurn = new RegisterTurnUseCase(
+    const registerMove = new RegisterMoveUseCase(
       new TurnMYSQLRepository(),
-      new GameMYSQLRepository(),
       new GameResultMYSQLRepository(),
+      new GameSeatsMYSQLRepository(),
+      new LatestTurnMySQLQueryService(),
     );
 
-    await startNewGame.run();
-    await startNewGame.run();
-    await startNewGame.run();
-    expect((await findLastGames.run()).length).toBeGreaterThanOrEqual(3);
-    expect((await findTurn.run(0)).nextDisc).toBe(Disc.Dark);
+    await createLocalGame.run(playerId);
+    await createLocalGame.run(playerId);
+    const gameId = await createLocalGame.run(playerId);
+    expect((await findLastGames.run(playerId)).length).toBeGreaterThanOrEqual(3);
+    expect((await findGameState.run(gameId, playerId)).nextDisc).toBe(Disc.Dark);
 
     // A legal opening move for black: flips the white disc at (4, 3).
-    await registerTurn.run(1, Disc.Dark, new Point(4, 2));
+    await registerMove.run(gameId, playerId, 1, new Point(4, 2));
 
-    const afterMove = await findTurn.run(1);
+    const afterMove = await findGameState.run(gameId, playerId);
     expect(afterMove.board[2][4]).toBe(Disc.Dark);
     expect(afterMove.nextDisc).toBe(Disc.Light);
   });
@@ -70,7 +91,7 @@ describe("connectMySQL", () => {
   it("rolls back a transaction left open by an error before reusing the connection", async () => {
     const observed: { connectionId?: number; gameId?: number; activeInside?: number } = {};
 
-    // Fails after StartNewGameUseCase has begun its transaction and inserted
+    // Fails after CreateLocalGameUseCase has begun its transaction and inserted
     // the game row, recording what it saw on the way.
     const failingTurnRepository: TurnRepository = {
       async findForGmaeIdAndTurnCOunt(): Promise<Turn> {
@@ -85,7 +106,13 @@ describe("connectMySQL", () => {
     };
 
     await expect(
-      new StartNewGameUseCase(new GameMYSQLRepository(), failingTurnRepository).run(),
+      new CreateLocalGameUseCase(
+        new GameMYSQLRepository(),
+        failingTurnRepository,
+        new GameSeatsMYSQLRepository(),
+        new PlayerMYSQLRepository(),
+        new RateLimitMySQLQueryService(),
+      ).run(playerId),
     ).rejects.toThrow("simulated failure after beginTransaction");
 
     // The probe must see the open transaction, or the checks below prove nothing.
```

`test/integration/vercelEntry.test.ts` keeps its three assertions
(201, 200, non-empty history); its `POST` now sends the CSRF headers, and
its `GET` sends the cookie the `POST` returned.

## 15. Changes to existing code

### 15.1 Modified

| File | Change | Why it cannot be avoided |
| --- | --- | --- |
| `src/main.ts` | Add `cookieParser()`, `csrfProtection` and `attachPlayer` on `/api`, `meRouter`; import `errorHandler` from its new module and delete the local function and its two error-class imports | Wiring for identity/CSRF; error handling grows (§11) |
| `src/presentation/gameRouter.ts` | `POST /api/games` creates a guest if needed and a local game, returns `{ id }`; `GET /api/games` scoped to the player; add `GET /api/games/:gameId` | Game-ID API replaces the unowned-game flow |
| `src/presentation/turnRouter.ts` | Remove both `latest` routes; add `POST /api/games/:gameId/turns` | Turn ownership; latest routes are deleted (answer 1a) |
| `src/application/error/applicationError.ts` | Replace `"LatestGameNotFound"` (its only users are deleted) with the §11 types | New error cases |
| `src/application/query/findLastGamesQueryService.ts` | `query(conn, playerId, limit)` | History per player (answer 6) |
| `src/application/useCase/findLastGamesUseCase.ts` | `run(playerId)` | Same |
| `src/infrastructure/query/findLastGamesMYSQLQueryService.ts` | Add the player filter (§7.5) | Same |
| `src/infrastructure/connection.ts` | Schema check on first use (§5.4); `closePool()` also resets it | Migration check requirement |
| `test/integration/connection.test.ts` | Port to the new use cases (§14.3) | Its use cases are deleted |
| `test/integration/vercelEntry.test.ts` | CSRF headers and cookie (§14.3) | CSRF and per-player history |
| `test/integration/globalSetup.ts` | Apply `MIGRATIONS` after `init.sql` | `reversi_test` needs the new tables |
| `vitest.config.ts` | Add the safeguard `setupFiles` to the integration project | Test safeguard requirement |
| `static/game/main.js` | New endpoints, `?id=`, CSRF header, no `disc` in requests, error messages (§12) | Local play on the new API |
| `package.json` / `package-lock.json` | Add `cookie-parser`, `@types/cookie-parser`; `migrate` script | Cookie parsing; migrations |
| `.env.example` | Add `IP_HASH_SECRET=local-development-only` | Guest cap |
| `.gitignore` | Add `.env.*` and `!.env.example` | `npm run migrate --env-file .env.preview` files hold secrets |
| `docs/deployment.md`, `README.md`, `docs/openapi.yaml` | §13 | Docs match the code |

### 15.2 Deleted

- `src/application/useCase/startNewGameUseCase.ts`
- `src/application/useCase/findLatestGameTurnByTurnCountUseCase.ts`
- `src/application/useCase/registerTurnUseCase.ts`

### 15.3 Left unchanged but now unused

`GameRepository.findLatest` (domain interface), its implementation in
`GameMYSQLRepository`, and `GameGateway.findLatest`. Removing them would
edit `src/domain/`; they are reported at the end of the phase instead.

### 15.4 `src/domain/`

No existing file changes. New files only (approved):
`src/domain/model/gamePlayer/gameSeats.ts`,
`src/domain/model/gamePlayer/gameSeatsRepository.ts`.

### 15.5 New files

| Layer | Files |
| --- | --- |
| Domain | `model/gamePlayer/gameSeats.ts`, `model/gamePlayer/gameSeatsRepository.ts` |
| Application | `identity/player.ts` (`{ id, displayName }`), `identity/playerRepository.ts` (port: `findByTokenHash`, `insert`, `lockForUpdate`), `identity/playerToken.ts`, `identity/guestName.ts`; `query/latestTurnQueryService.ts`, `query/rateLimitQueryService.ts` (`countGuestsCreatedInLastHour(ipHash)`, `countGamesCreatedInLastHour(playerId)`); `useCase/registerGuestUseCase.ts`, `useCase/findPlayerByTokenUseCase.ts`, `useCase/createLocalGameUseCase.ts`, `useCase/findGameStateUseCase.ts`, `useCase/registerMoveUseCase.ts` |
| Infrastructure | `repository/player/{playerGateway,playerRecord,playerMYSQLRepository}.ts`, `repository/gamePlayer/{gameSeatGateway,gameSeatRecord,gameSeatsMYSQLRepository}.ts`, `query/latestTurnMYSQLQueryService.ts`, `query/rateLimitMYSQLQueryService.ts`, `migration/{migrations,migrationRunner,schemaCheck,migrateCli}.ts`, `databaseAvailability.ts` |
| Presentation | `errorHandler.ts`, `errorLogging.ts` (`describeError`), `validation.ts` (`ValidationError`, parsers), `gameStateResponse.ts`, `meRouter.ts`, `middleware/csrfProtection.ts` (`CsrfRejectedError`), `middleware/identity.ts` (`attachPlayer`, `ensurePlayer`), `identity/identityConfig.ts`, `identity/playerCookie.ts`, `identity/clientIp.ts` |
| Tests | `test/unit/*.test.ts` (§14.1), `test/integration/{setup,apiClient}.ts`, `test/integration/{migrations,api,databaseUnavailable}.test.ts` |

All paths under `src/` except the test row. Gateways, records, and MySQL
repositories follow the existing `*Gateway` / `*Record` / `*MYSQLRepository`
pattern.

## 16. Risks and known limits

1. **Board storage limits the whole free tier (needs a decision).** Every
   turn stores 64 square rows (≈ 6.5 KB), so:
   - **legitimate use:** 1 GB holds about **2,500 finished games** in
     total;
   - **abuse through moves:** the caps in §10 bound game *creation*, but a
     client can play its allowed games through; one IP at 200 games/h × 60
     moves ≈ 78 MB/h fills 1 GB in about 13 hours, bounded otherwise only
     by the firewall.

   Phase 1 does not change board storage (it is existing infrastructure).
   See the open question below.
2. **Migration order.** Migrate `reversi_preview` before a preview deploy
   and `reversi` before the production deploy. A missed migration now
   fails with a clear 503 and log line instead of 500s.
3. **Shared IPs** (schools, carriers) share the firewall limit and the
   guest cap; limits are generous, and counters are per region.
4. **Guest cap overshoot** under concurrency (§10.1); bounded and accepted.
5. **A cleared cookie loses the guest's games** until Phase 5 lets guests
   register.
6. **Aiven powering off** still takes the site down; Phase 1 makes it
   visible (503 + logged code), not prevented.
7. **One extra query per API request** for identity, so the function and
   database regions must match (already documented).

## 17. Open question for review

**Board storage.** Should compacting how turns store the board (for
example one `binary(16)` or `char(64)` column per turn instead of 64
`squares` rows, about 40× smaller) be added to Phase 1, scheduled as its
own phase before Phase 4 opens the site to strangers, or deferred? It would
change existing infrastructure files (`turnMYSQLRepository.ts`,
`squareGateway.ts`, a data migration), not the domain.

## 18. Pre-existing issues (reported, not fixed)

- Stored `DATETIME` values depend on the process time zone (fix at the
  start of Phase 2).
- `GET /api/games` returns `darkMoveCount` / `lightMoveCount` as strings
  (MySQL `SUM()` is `DECIMAL`); the frontend does not use them.
- `hello.ts` at the repository root appears unused.
- `docs/webapi-design-memo.md` and `docs/features.md` describe the
  pre-Phase-1 API and "no player registration"; left as historical notes.
