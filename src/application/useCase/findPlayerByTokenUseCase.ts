import { connectMySQL } from "../../infrastructure/connection";
import { Player } from "../identity/player";
import { PlayerRepository } from "../identity/playerRepository";
import { hashPlayerToken, isWellFormedPlayerToken } from "../identity/playerToken";

export class FindPlayerByTokenUseCase {
  constructor(private _playerRepository: PlayerRepository) {}

  async run(token: string): Promise<Player | undefined> {
    // Malformed cookie values never reach the database.
    if (!isWellFormedPlayerToken(token)) {
      return undefined;
    }

    const conn = await connectMySQL();
    try {
      return await this._playerRepository.findByTokenHash(conn, hashPlayerToken(token));
    } finally {
      await conn.end();
    }
  }
}
