import { DomainError } from "../../error/domainError";
import { Disc, isOppositeDisc } from "./disc";
import { Move } from "./move";
import { Point } from "./point";

export class Board {
  private _walledDiscs: Disc[][];
  constructor(private _discs: Disc[][]) {
    this._walledDiscs = this.wallDiscs();
  }

  place(move: Move): Board {
    // You can't place a stone unless its the empty square
    if (this._discs[move.point.y][move.point.x] !== Disc.Emoty) {
      throw new DomainError(
        "SelectedPointIsNotEmpty",
        "Select point is not empty",
      );
    }
    // List the reversible point
    const flipPoints = this.listFlipPoints(move);

    // Can't place a stone if there's no reversible point
    if (flipPoints.length === 0) {
      throw new DomainError("FlipPointsIsEmpty", "Flip points is empty");
    }

    // Copy the board
    const newDiscs = this._discs.map((line) => {
      return line.map((disc) => {
        return disc;
      });
    });

    // Place a stone
    newDiscs[move.point.y][move.point.x] = move.disc;

    // Reverse
    flipPoints.forEach((p) => {
      newDiscs[p.y][p.x] = move.disc;
    });

    return new Board(newDiscs);
  }

  private listFlipPoints(move: Move): Point[] {
    const flipPoints: Point[] = [];

    const walledX = move.point.x + 1;
    const walledY = move.point.y + 1;

    const checkFlipPoints = (xMove: number, yMove: number) => {
      const flipCandidate: Point[] = [];

      // Start at the position where you moved 1 square
      let cursorX = walledX + xMove;
      let cursorY = walledY + yMove;

      // Check each stone while there's opposite color
      while (isOppositeDisc(move.disc, this._walledDiscs[cursorY][cursorX])) {
        // Subtract 1 to account for the sentry
        flipCandidate.push(new Point(cursorX - 1, cursorY - 1));
        cursorX += xMove;
        cursorY += yMove;
        // The stone to be flipped is determined if next color is the same color
        if (move.disc === this._walledDiscs[cursorY][cursorX]) {
          flipPoints.push(...flipCandidate);
          break;
        }
      }
    };

    // Top
    checkFlipPoints(0, -1);
    // Left Top
    checkFlipPoints(-1, -1);
    // Left
    checkFlipPoints(-1, 0);
    // Left Bottom
    checkFlipPoints(-1, 1);
    // Bottom
    checkFlipPoints(0, 1);
    // Right bottom
    checkFlipPoints(1, 1);
    // Right
    checkFlipPoints(1, 0);
    // Right Top
    checkFlipPoints(1, -1);

    return flipPoints;
  }

  private wallDiscs(): Disc[][] {
    const walled: Disc[][] = [];

    const topAndBottomWall = Array(this._discs[0].length + 2).fill(Disc.Wall);

    walled.push(topAndBottomWall);

    this._discs.forEach((line) => {
      const walledLine = [Disc.Wall, ...line, Disc.Wall];
      walled.push(walledLine);
    });

    walled.push(topAndBottomWall);

    return walled;
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
