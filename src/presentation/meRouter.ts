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
