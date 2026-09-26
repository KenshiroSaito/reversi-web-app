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
