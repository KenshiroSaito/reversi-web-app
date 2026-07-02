import { MoveGateway } from "../../../infrastructure/moveGateway";
import { SquareGateway } from "../../../infrastructure/squareGateway";
import { TurnGateway } from "../../../infrastructure/turnGateway";
import { DomainError } from "../../error/domainError";
import { Board } from "./board";
import { toDisc } from "./disc";
import { Move } from "./move";
import { Point } from "./point";
import { Turn } from "./turn";
import mysql from "mysql2/promise";

const turnGateway = new TurnGateway();
const squareGateway = new SquareGateway();
const moveGateway = new MoveGateway();

export class TurnRepository {
  async findForGmaeIdAndTurnCOunt(
    conn: mysql.Connection,
    gameId: number,
    turnCount: number,
  ): Promise<Turn> {
    const turnRecord = await turnGateway.findForGameIdAndTurnCount(
      conn,
      gameId,
      turnCount,
    );

    if (!turnRecord) {
      throw new DomainError(
        "SpecifiedTurnNotFound",
        "Specified turn not found",
      );
    }

    const squareRecords = await squareGateway.findForTurnId(
      conn,
      turnRecord.id,
    );
    const board = Array.from(Array(8)).map(() => Array.from(Array(8)));
    squareRecords.forEach((s) => {
      board[s.y][s.x] = s.disc;
    });

    const moveRecord = await moveGateway.findForTurnId(conn, turnRecord.id);
    let move: Move | undefined;
    if (moveRecord) {
      move = new Move(
        toDisc(moveRecord.disc),
        new Point(moveRecord.x, moveRecord.y),
      );
    }

    const nextDisc =
      turnRecord.nextDisc === null ? undefined : toDisc(turnRecord.nextDisc);

    return new Turn(
      gameId,
      turnCount,
      nextDisc,
      move,
      new Board(board),
      turnRecord.endAt,
    );
  }

  async save(conn: mysql.Connection, turn: Turn) {
    const turnRecord = await turnGateway.insert(
      conn,
      turn.gameId,
      turn.turnCount,
      turn.nextDisc,
      turn.endAt,
    );

    await squareGateway.insertAll(conn, turnRecord.id, turn.board.discs);

    if (turn.move) {
      await moveGateway.insert(
        conn,
        turnRecord.id,
        turn.move.disc,
        turn.move.point.x,
        turn.move.point.y,
      );
    }
  }
}
