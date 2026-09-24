import mysql from "mysql2/promise";

// Idle pooled connections are closed after this long, so a function instance
// that goes quiet stops holding connections against the database's limit.
export const IDLE_TIMEOUT_MS = 5000;

const DEFAULT_PORT = 3306;
const DEFAULT_POOL_MAX = 3;

/**
 * Builds mysql2 pool options from environment variables.
 * There are deliberately no fallback credentials: a missing setting is an error.
 */
export function loadDbConfig(env: NodeJS.ProcessEnv): mysql.PoolOptions {
  const host = requireVar(env, "DB_HOST");
  const user = requireVar(env, "DB_USER");
  const password = requireVar(env, "DB_PASSWORD");
  const database = requireVar(env, "DB_NAME");
  const port = positiveInt(env, "DB_PORT", DEFAULT_PORT);
  const poolMax = positiveInt(env, "DB_POOL_MAX", DEFAULT_POOL_MAX);

  const caCert = env.DB_CA_CERT || undefined;
  if (env.VERCEL && !caCert) {
    throw new Error(
      "DB_CA_CERT is required when running on Vercel: the database connection must use verified TLS",
    );
  }

  return {
    host,
    port,
    user,
    password,
    database,
    ssl: caCert ? { ca: caCert, rejectUnauthorized: true } : undefined,
    connectionLimit: poolMax,
    maxIdle: poolMax,
    idleTimeout: IDLE_TIMEOUT_MS,
    waitForConnections: true,
    queueLimit: 0,
  };
}

function requireVar(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (!raw) {
    return fallback;
  }
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw new Error(`${name} must be a positive integer`);
  }
  return Number(raw);
}
