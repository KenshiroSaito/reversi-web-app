export interface ErrorDescription {
  name?: string;
  message?: string;
  code?: string;
  errno?: number;
  sqlState?: string;
  stack?: string;
  cause?: ErrorDescription;
  errors?: ErrorDescription[];
}

const MAX_DEPTH = 3;

/**
 * Picks the fields needed to diagnose a failure. The error object itself is
 * never logged: mysql2 errors carry the SQL text (with inlined values for
 * `query`), and nothing logged here may contain secrets or request data.
 */
export function describeError(err: unknown, depth = 0): ErrorDescription {
  if (typeof err !== "object" || err === null) {
    return { message: String(err) };
  }

  const e = err as Record<string, unknown>;
  const description: ErrorDescription = {};
  if (typeof e.name === "string") description.name = e.name;
  if (typeof e.message === "string") description.message = e.message;
  if (typeof e.code === "string") description.code = e.code;
  if (typeof e.errno === "number") description.errno = e.errno;
  if (typeof e.sqlState === "string") description.sqlState = e.sqlState;
  if (typeof e.stack === "string") description.stack = e.stack;

  if (depth < MAX_DEPTH) {
    if (e.cause !== undefined) {
      description.cause = describeError(e.cause, depth + 1);
    }
    // Node reports a refused dual-stack connection as an AggregateError whose
    // own message is empty; the useful detail is in its entries.
    if (Array.isArray(e.errors)) {
      description.errors = e.errors.map((entry) => describeError(entry, depth + 1));
    }
  }
  return description;
}
