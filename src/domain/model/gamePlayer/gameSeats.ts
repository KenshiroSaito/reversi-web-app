import { Disc } from "../turn/disc";

export interface Seat {
  disc: Disc;
  playerId: number;
}

const PLAYING_DISCS: Disc[] = [Disc.Dark, Disc.Light];

/**
 * Who sits on which colour in a game, and therefore who may move.
 * A local game seats the same player on both colours.
 */
export class GameSeats {
  private _seats: Seat[];

  constructor(
    private _gameId: number,
    seats: Seat[],
  ) {
    const oneSeatPerColour =
      seats.length === PLAYING_DISCS.length &&
      PLAYING_DISCS.every((disc) => seats.filter((seat) => seat.disc === disc).length === 1);
    // Not a DomainError: seats come from the server itself (a new local game
    // or rows constrained by the schema), so a violation is a server bug.
    if (!oneSeatPerColour) {
      throw new Error(`Game ${_gameId} must have exactly one seat for each colour`);
    }
    this._seats = seats.map((seat) => ({ ...seat }));
  }

  static forLocalGame(gameId: number, playerId: number): GameSeats {
    return new GameSeats(gameId, [
      { disc: Disc.Dark, playerId },
      { disc: Disc.Light, playerId },
    ]);
  }

  get gameId() {
    return this._gameId;
  }

  get seats(): readonly Seat[] {
    return this._seats;
  }

  isParticipant(playerId: number): boolean {
    return this._seats.some((seat) => seat.playerId === playerId);
  }

  discsOf(playerId: number): Disc[] {
    return this._seats
      .filter((seat) => seat.playerId === playerId)
      .map((seat) => seat.disc)
      .sort((a, b) => a - b);
  }

  /** `nextDisc` is undefined once the game has ended, and then nobody may move. */
  mayMove(playerId: number, nextDisc: Disc | undefined): boolean {
    if (nextDisc === undefined) {
      return false;
    }
    return this._seats.some((seat) => seat.disc === nextDisc && seat.playerId === playerId);
  }
}
