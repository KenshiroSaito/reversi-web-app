import { connectMySQL } from "../infrastructure/connection";
import { firstTurn } from "../domain/model/turn/turn";
import { GameRepository } from "../domain/model/game/gameRepository";
import { Game } from "../domain/model/game/game";
import { TurnRepository } from "../domain/model/turn/turnRepository";

const gameRepository = new GameRepository();
const turnRepository = new TurnRepository();

export class GameService {
  async startNewGame() {
    const now = new Date();

    const conn = await connectMySQL();
    try {
      await conn.beginTransaction();

      const game = await gameRepository.save(conn, new Game(undefined, now));
      if (!game.id) {
        throw new Error("game.id does not exist");
      }

      const turn = firstTurn(game.id, now);

      await turnRepository.save(conn, turn);

      await conn.commit();
    } finally {
      await conn.end();
    }
  }
}
