import mysql from "mysql2/promise";

// Both windows are measured with the database clock on both sides of the
// comparison, so they do not depend on the app's time zone.
export interface RateLimitQueryService {
  countGuestsCreatedInLastHour(conn: mysql.Connection, ipHash: Buffer): Promise<number>;
  countGamesCreatedInLastHour(conn: mysql.Connection, playerId: number): Promise<number>;
}
