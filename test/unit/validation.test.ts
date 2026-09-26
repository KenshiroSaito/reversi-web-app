import { describe, expect, it } from "vitest";
import { parseGameId, parseMoveRequest, ValidationError } from "../../src/presentation/validation";

describe("parseGameId", () => {
  it.each([["1", 1], ["42", 42], ["2147483647", 2147483647]])("accepts %s", (value, expected) => {
    expect(parseGameId(value)).toBe(expected);
  });

  it.each(["0", "01", "-1", "1e3", "1.0", " 1", "abc", "", "2147483648", "99999999999", undefined])(
    "rejects %s",
    (value) => {
      expect(() => parseGameId(value)).toThrow(ValidationError);
    },
  );
});

describe("parseMoveRequest", () => {
  it("parses a valid request and ignores a legacy disc field", () => {
    const parsed = parseMoveRequest({ turnCount: 3, move: { x: 0, y: 7, disc: 1 } });

    expect(parsed.turnCount).toBe(3);
    expect(parsed.point.x).toBe(0);
    expect(parsed.point.y).toBe(7);
  });

  it.each([
    ["an array body", []],
    ["a null body", null],
    ["a string body", "move"],
    ["a missing turnCount", { move: { x: 1, y: 1 } }],
    ["turnCount 0", { turnCount: 0, move: { x: 1, y: 1 } }],
    ["turnCount 1.5", { turnCount: 1.5, move: { x: 1, y: 1 } }],
    ["turnCount as a string", { turnCount: "1", move: { x: 1, y: 1 } }],
    ["a missing move", { turnCount: 1 }],
    ["move as an array", { turnCount: 1, move: [1, 1] }],
    ["x as a string", { turnCount: 1, move: { x: "3", y: 1 } }],
    ["x of 1.5", { turnCount: 1, move: { x: 1.5, y: 1 } }],
    ["x of 8", { turnCount: 1, move: { x: 8, y: 1 } }],
    ["y of -1", { turnCount: 1, move: { x: 1, y: -1 } }],
    ["a missing y", { turnCount: 1, move: { x: 1 } }],
  ])("rejects %s", (_label, body) => {
    expect(() => parseMoveRequest(body)).toThrow(ValidationError);
  });
});
