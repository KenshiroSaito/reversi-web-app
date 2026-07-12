import express from "express";
import { StartNewGameUseCase } from "../application/useCase/startNewGameUseCase";
import { GameMYSQLRepository } from "../infrastructure/repository/game/gameMYSQLRepository";
import { TurnMYSQLRepository } from "../infrastructure/repository/turn/turnMYSQLRepository";

export const gameRouter = express.Router();

const startNewGameUseCase = new StartNewGameUseCase(
  new GameMYSQLRepository(),
  new TurnMYSQLRepository(),
);

gameRouter.post("/api/games", async (req, res) => {
  await startNewGameUseCase.run();

  res.status(201).end();
});
