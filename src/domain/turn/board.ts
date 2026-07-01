import { Disc } from "./disc";
import { Move } from "./move";

export class Board {
  constructor(private _discs: Disc[][]) {}

  place(move: Move): Board {
    // TODO: Check if you can place a stone on a board

    // Place a stone
    const newDiscs = this._discs.map((line) => {
      return line.map((disc) => {
        return disc;
      });
    });
    // Reverse
    newDiscs[move.point.y][move.point.x] = move.disc;

    return new Board(newDiscs);
  }

  get discs() {
    return this._discs;
  }
}

const E = Disc.Emoty;
const D = Disc.Dark;
const L = Disc.Light;

const INITIAL_DISCS = [
  [E, E, E, E, E, E, E, E],
  [E, E, E, E, E, E, E, E],
  [E, E, E, E, E, E, E, E],
  [E, E, E, D, L, E, E, E],
  [E, E, E, L, D, E, E, E],
  [E, E, E, E, E, E, E, E],
  [E, E, E, E, E, E, E, E],
  [E, E, E, E, E, E, E, E],
];

export const initialBoard = new Board(INITIAL_DISCS);
