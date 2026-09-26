import { connectMySQL } from "../../infrastructure/connection";
import { ApplicationError } from "../error/applicationError";
import { Player } from "../identity/player";
import { PlayerRepository } from "../identity/playerRepository";
import { generatePlayerToken, hashPlayerToken } from "../identity/playerToken";
import { generateGuestName } from "../identity/guestName";
import { RateLimitQueryService } from "../query/rateLimitQueryService";

export const GUESTS_PER_IP_PER_HOUR = 20;

export interface RegisteredGuest {
  player: Player;
  /** Returned once, for the cookie; only its hash is stored. */
  token: string;
}

export class RegisterGuestUseCase {
  constructor(
    private _playerRepository: PlayerRepository,
    private _rateLimitQuery: RateLimitQueryService,
  ) {}

  async run(clientIpHash: Buffer): Promise<RegisteredGuest> {
    const conn = await connectMySQL();
    try {
      // Not locked: concurrent requests from one IP can overshoot the cap by
      // at most the number in flight, which is acceptable here.
      const recent = await this._rateLimitQuery.countGuestsCreatedInLastHour(conn, clientIpHash);
      if (recent >= GUESTS_PER_IP_PER_HOUR) {
        throw new ApplicationError(
          "GuestCreationLimitReached",
          "Too many new players from this network. Try again later.",
        );
      }

      const token = generatePlayerToken();
      const player = await this._playerRepository.insert(
        conn,
        hashPlayerToken(token),
        generateGuestName(),
        clientIpHash,
      );
      return { player, token };
    } finally {
      await conn.end();
    }
  }
}
