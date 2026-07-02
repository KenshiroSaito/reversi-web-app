import { WinnerDisc } from "./winnerDisc";

export class GameResult {
  constructor(
    private _gameid: number,
    private _winnerDisc: WinnerDisc,
    private _endAt: Date,
  ) {}

  get gameId() {
    return this._gameid;
  }

  get winnerDisc() {
    return this._winnerDisc;
  }

  get endAt() {
    return this._endAt;
  }
}
