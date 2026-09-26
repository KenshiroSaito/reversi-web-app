import { describe, expect, it } from "vitest";
import { GameSeats } from "../../src/domain/model/gamePlayer/gameSeats";
import { Disc } from "../../src/domain/model/turn/disc";

describe("GameSeats", () => {
  describe("local game", () => {
    const seats = GameSeats.forLocalGame(7, 1);

    it("seats one player on both colours", () => {
      expect(seats.gameId).toBe(7);
      expect(seats.isParticipant(1)).toBe(true);
      expect(seats.discsOf(1)).toEqual([Disc.Dark, Disc.Light]);
    });

    it("lets that player move either colour", () => {
      expect(seats.mayMove(1, Disc.Dark)).toBe(true);
      expect(seats.mayMove(1, Disc.Light)).toBe(true);
    });

    it("gives nobody else a seat", () => {
      expect(seats.isParticipant(2)).toBe(false);
      expect(seats.discsOf(2)).toEqual([]);
      expect(seats.mayMove(2, Disc.Dark)).toBe(false);
    });

    it("lets nobody move once the game has ended", () => {
      expect(seats.mayMove(1, undefined)).toBe(false);
    });
  });

  describe("two players", () => {
    const seats = new GameSeats(8, [
      { disc: Disc.Light, playerId: 20 },
      { disc: Disc.Dark, playerId: 10 },
    ]);

    it("lets each player move only their own colour", () => {
      expect(seats.mayMove(10, Disc.Dark)).toBe(true);
      expect(seats.mayMove(10, Disc.Light)).toBe(false);
      expect(seats.mayMove(20, Disc.Light)).toBe(true);
      expect(seats.mayMove(20, Disc.Dark)).toBe(false);
      expect(seats.discsOf(20)).toEqual([Disc.Light]);
    });
  });

  describe("invariant", () => {
    it.each([
      ["no seats", []],
      ["one seat", [{ disc: Disc.Dark, playerId: 1 }]],
      ["two dark seats", [{ disc: Disc.Dark, playerId: 1 }, { disc: Disc.Dark, playerId: 2 }]],
      ["a non-playing disc", [{ disc: Disc.Dark, playerId: 1 }, { disc: Disc.Emoty, playerId: 2 }]],
    ])("rejects %s", (_label, seats) => {
      expect(() => new GameSeats(1, seats)).toThrow("exactly one seat for each colour");
    });
  });
});
