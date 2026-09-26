import { connectMySQL } from "../../infrastructure/connection";
import { Game } from "../../domain/model/game/game";
import { GameRepository } from "../../domain/model/game/gameRepository";
import { firstTurn } from "../../domain/model/turn/turn";
import { TurnRepository } from "../../domain/model/turn/turnRepository";
import { GameSeats } from "../../domain/model/gamePlayer/gameSeats";
import { GameSeatsRepository } from "../../domain/model/gamePlayer/gameSeatsRepository";
import { ApplicationError } from "../error/applicationError";
import { PlayerRepository } from "../identity/playerRepository";
import { RateLimitQueryService } from "../query/rateLimitQueryService";

export const GAMES_PER_PLAYER_PER_HOUR = 10;

export class CreateLocalGameUseCase {
  constructor(
    private _gameRepository: GameRepository,
    private _turnRepository: TurnRepository,
    private _gameSeatsRepository: GameSeatsRepository,
    private _playerRepository: PlayerRepository,
    private _rateLimitQuery: RateLimitQueryService,
  ) {}

  /** Creates a game with the player on both colours and returns its ID. */
  async run(playerId: number): Promise<number> {
    const now = new Date();

    const conn = await connectMySQL();
    try {
      await conn.beginTransaction();

      // Serialises game creation per player, so the cap below is exact.
      await this._playerRepository.lockForUpdate(conn, playerId);
      const recent = await this._rateLimitQuery.countGamesCreatedInLastHour(conn, playerId);
      if (recent >= GAMES_PER_PLAYER_PER_HOUR) {
        throw new ApplicationError(
          "GameCreationLimitReached",
          "Too many new games. Try again later.",
        );
      }

      const game = await this._gameRepository.save(conn, new Game(undefined, now));
      if (!game.id) {
        throw new Error("game.id does not exist");
      }
      await this._turnRepository.save(conn, firstTurn(game.id, now));
      await this._gameSeatsRepository.save(conn, GameSeats.forLocalGame(game.id, playerId));

      await conn.commit();
      return game.id;
    } finally {
      await conn.end();
    }
  }
}
