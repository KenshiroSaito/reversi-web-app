export class GameSeatRecord {
  constructor(
    private _gameId: number,
    private _disc: number,
    private _playerId: number,
  ) {}

  get gameId() {
    return this._gameId;
  }

  get disc() {
    return this._disc;
  }

  get playerId() {
    return this._playerId;
  }
}
