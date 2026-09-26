import { GameStateOutput } from "../application/useCase/findGameStateUseCase";

export interface GameStateResponseBody {
  id: number;
  turnCount: number;
  board: number[][];
  nextDisc: number | null;
  winnerDisc: number | null;
  yourDiscs: number[];
}

export function toGameStateResponse(state: GameStateOutput): GameStateResponseBody {
  return {
    id: state.gameId,
    turnCount: state.turnCount,
    board: state.board,
    nextDisc: state.nextDisc ?? null,
    winnerDisc: state.winnerDisc ?? null,
    yourDiscs: state.yourDiscs,
  };
}
