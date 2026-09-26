import { createHash, randomBytes } from "node:crypto";

const TOKEN_BYTES = 32;
const PLAYER_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** The secret a guest's browser holds in its cookie. */
export function generatePlayerToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/** Only this hash is stored, so a database leak cannot be used to impersonate players. */
export function hashPlayerToken(token: string): Buffer {
  return createHash("sha256").update(token).digest();
}

export function isWellFormedPlayerToken(value: unknown): value is string {
  return typeof value === "string" && PLAYER_TOKEN_PATTERN.test(value);
}
