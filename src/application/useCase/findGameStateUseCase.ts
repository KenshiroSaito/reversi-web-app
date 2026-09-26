import { connectMySQL } from "../../infrastructure/connection";
import { Disc } from "../../domain/model/turn/disc";
import { Turn } from "../../domain/model/turn/turn";
import { TurnRepository } from "../../domain/model/turn/turnRepository";
import { WinnerDisc } from "../../domain/model/gameResult/winnerDisc";
import { GameResultRepository } from "../../domain/model/gameResult/gameResultRepository";
import { GameSeats } from "../../domain/model/gamePlayer/gameSeats";
import { GameSeatsRepository } from "../../domain/model/gamePlayer/gameSeatsRepository";
import { ApplicationError } from "../error/applicationError";
import { LatestTurnQueryService } from "../query/latestTurnQueryService";

export interface GameStateOutput {
  gameId: number;
  turnCount: number;
  board: Disc[][];
  /** Undefined once the game has ended. */
  nextDisc: Disc | undefined;
  /** Undefined until the game has ended. */
  winnerDisc: WinnerDisc | undefined;
  yourDiscs: Disc[];
}

export function toGameState(
  turn: Turn,
  seats: GameSeats,
  playerId: number,
  winnerDisc: WinnerDisc | undefined,
): GameStateOutput {
  return {
    gameId: turn.gameId,
    turnCount: turn.turnCount,
    board: turn.board.discs,
    nextDisc: turn.nextDisc,
    winnerDisc,
    yourDiscs: seats.discsOf(playerId),
  };
}

export function gameNotFound(): ApplicationError {
  return new ApplicationError("GameNotFound", "Game not found");
}

export class FindGameStateUseCase {
  constructor(
    private _turnRepository: TurnRepository,
    private _gameResultRepository: GameResultRepository,
    private _gameSeatsRepository: GameSeatsRepository,
    private _latestTurnQuery: LatestTurnQueryService,
  ) {}

  async run(gameId: number, playerId: number): Promise<GameStateOutput> {
    const conn = await connectMySQL();
    try {
      const seats = await this._gameSeatsRepository.findForGameId(conn, gameId);
      if (!seats || !seats.isParticipant(playerId)) {
        throw gameNotFound();
      }

      const latest = await this._latestTurnQuery.findLatestTurnCount(conn, gameId);
      if (latest === undefined) {
        throw new Error(`Game ${gameId} has seats but no turns`);
      }
      const turn = await this._turnRepository.findForGmaeIdAndTurnCOunt(conn, gameId, latest);

      const result = turn.gameEnded()
        ? await this._gameResultRepository.findForGameId(conn, gameId)
        : undefined;

      return toGameState(turn, seats, playerId, result?.winnerDisc);
    } finally {
      await conn.end();
    }
  }
}
