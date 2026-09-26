export class PlayerRecord {
  constructor(
    private _id: number,
    private _displayName: string,
  ) {}

  get id() {
    return this._id;
  }

  get displayName() {
    return this._displayName;
  }
}
