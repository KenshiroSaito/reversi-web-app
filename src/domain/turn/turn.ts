import { Board, initialBoard } from "./board";
import { Disc } from "./disc";
import { Move } from "./move";
import { Point } from "./point";

export class Turn {
  constructor(
    private _gameId: number,
    private _turnCount: number,
    private _nextDisc: Disc,
    private _move: Move | undefined,
    private _board: Board,
    private _endAt: Date,
  ) {}

  placeNext(disc: Disc, point: Point): Turn {
    // Can't place a stone when a stone is not what it suppose to be (follow the order)
    if (disc !== this._nextDisc) {
      throw new Error("Invalid disc");
    }

    const move = new Move(disc, point);

    const nextBoard = this._board.place(move);

    // TODO: Skip if you can't place a stone
    const nextDisc = disc === Disc.Dark ? Disc.Light : Disc.Dark;

    return new Turn(
      this._gameId,
      this._turnCount + 1,
      nextDisc,
      move,
      nextBoard,
      new Date(),
    );
  }
  get gameId() {
    return this._gameId;
  }

  get turnCount() {
    return this._turnCount;
  }

  get nextDisc() {
    return this._nextDisc;
  }

  get endAt() {
    return this._endAt;
  }

  get board() {
    return this._board;
  }

  get move() {
    return this._move;
  }
}

export function firstTurn(gameId: number, endAt: Date) {
  return new Turn(gameId, 0, Disc.Dark, undefined, initialBoard, endAt);
}
