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
