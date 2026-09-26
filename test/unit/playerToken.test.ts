import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  generatePlayerToken,
  hashPlayerToken,
  isWellFormedPlayerToken,
} from "../../src/application/identity/playerToken";

describe("player tokens", () => {
  it("are 43-character base64url strings and unique", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generatePlayerToken()));

    expect(tokens.size).toBe(100);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(isWellFormedPlayerToken(token)).toBe(true);
    }
  });

  it("hash to SHA-256", () => {
    const token = generatePlayerToken();
    expect(hashPlayerToken(token).equals(createHash("sha256").update(token).digest())).toBe(true);
  });

  it.each(["", "short", "a".repeat(44), "a".repeat(42) + "!", undefined, 42])(
    "reject malformed value %s",
    (value) => {
      expect(isWellFormedPlayerToken(value)).toBe(false);
    },
  );
});
