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
