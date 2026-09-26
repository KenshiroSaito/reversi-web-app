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
