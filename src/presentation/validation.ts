import { Point } from "../domain/model/turn/point";

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

// games.id is a MySQL signed int.
const MAX_GAME_ID = 2147483647;

export function parseGameId(value: unknown): number {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,9}$/.test(value) || Number(value) > MAX_GAME_ID) {
    throw new ValidationError("gameId must be a positive integer");
  }
  return Number(value);
}

export interface MoveRequest {
  turnCount: number;
  point: Point;
}

/** `{ "turnCount": <int >= 1>, "move": { "x": <int 0-7>, "y": <int 0-7> } }`; other fields are ignored. */
export function parseMoveRequest(body: unknown): MoveRequest {
  if (!isPlainObject(body)) {
    throw new ValidationError("Request body must be a JSON object");
  }
  const { turnCount, move } = body;
  if (typeof turnCount !== "number" || !Number.isInteger(turnCount) || turnCount < 1) {
    throw new ValidationError("turnCount must be an integer of at least 1");
  }
  if (!isPlainObject(move)) {
    throw new ValidationError("move must be an object with x and y");
  }
  const { x, y } = move;
  if (!isCoordinate(x) || !isCoordinate(y)) {
    throw new ValidationError("move.x and move.y must be integers from 0 to 7");
  }
  return { turnCount, point: new Point(x, y) };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 7;
}
