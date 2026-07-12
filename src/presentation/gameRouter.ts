import express, { response } from "express";
import { StartNewGameUseCase } from "../application/useCase/startNewGameUseCase";
import { GameMYSQLRepository } from "../infrastructure/repository/game/gameMYSQLRepository";
import { TurnMYSQLRepository } from "../infrastructure/repository/turn/turnMYSQLRepository";
import { FindLastGameUseCase } from "../application/useCase/findLastGamesUseCase";
import { FindLastGameMySQLQueryService } from "../infrastructure/query/findLastGamesMYSQLQueryService";

export const gameRouter = express.Router();

const startNewGameUseCase = new StartNewGameUseCase(
  new GameMYSQLRepository(),
  new TurnMYSQLRepository(),
);

const findLastGamesUseCase = new FindLastGameUseCase(
  new FindLastGameMySQLQueryService(),
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
    const output = await findLastGamesUseCase.run();

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
  await startNewGameUseCase.run();

  res.status(201).end();
});
