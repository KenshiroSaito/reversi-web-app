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
