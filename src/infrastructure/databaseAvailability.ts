// Error codes meaning the database could not be reached at all (as opposed
// to a query failing). A powered-off Aiven service shows up as one of these.
const UNAVAILABLE_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "PROTOCOL_CONNECTION_LOST",
  "ER_CON_COUNT_ERROR",
]);

const MAX_DEPTH = 3;

export function isDatabaseUnavailable(err: unknown, depth = 0): boolean {
  if (typeof err !== "object" || err === null || depth > MAX_DEPTH) {
    return false;
  }
  const e = err as { code?: unknown; cause?: unknown; errors?: unknown };
  if (typeof e.code === "string" && UNAVAILABLE_CODES.has(e.code)) {
    return true;
  }
  if (isDatabaseUnavailable(e.cause, depth + 1)) {
    return true;
  }
  return Array.isArray(e.errors) && e.errors.some((entry) => isDatabaseUnavailable(entry, depth + 1));
}
