import { existsSync } from "node:fs";
import mysql from "mysql2/promise";
import { loadDbConfig } from "../dbConfig";
import { MIGRATIONS } from "./migrations";
import { applyPendingMigrations } from "./migrationRunner";

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1"];

export interface MigrateArgs {
  envFile?: string;
  database?: string;
}

export function parseMigrateArgs(argv: string[]): MigrateArgs {
  const args: MigrateArgs = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag !== "--env-file" && flag !== "--database") {
      throw new Error(`Unknown option ${flag}. Usage: npm run migrate -- [--env-file <path>] --database <name>`);
    }
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${flag} needs a value`);
    }
    if (flag === "--env-file") {
      args.envFile = value;
    } else {
      args.database = value;
    }
  }
  return args;
}

/** Guards against migrating the wrong database, or a remote one without TLS. */
export function assertSafeTarget(args: MigrateArgs, options: mysql.PoolOptions): void {
  if (!args.database) {
    throw new Error("Pass --database <name>; it must match DB_NAME, as a check that this is the intended database");
  }
  if (args.database !== options.database) {
    throw new Error(`--database ${args.database} does not match DB_NAME ${options.database}`);
  }
  if (!LOCAL_HOSTS.includes(options.host ?? "") && !options.ssl) {
    throw new Error("Refusing to migrate a remote database without DB_CA_CERT (verified TLS)");
  }
}

async function main(): Promise<void> {
  const args = parseMigrateArgs(process.argv.slice(2));
  // Either the given file or the local .env, never both, so local settings
  // cannot leak into a migration of another environment. Variables already
  // set in the shell take precedence over the file.
  if (args.envFile) {
    process.loadEnvFile(args.envFile);
  } else if (existsSync(".env")) {
    process.loadEnvFile(".env");
  }
  const options = loadDbConfig(process.env);
  assertSafeTarget(args, options);

  console.log(`Migrating database ${options.database} on ${options.host}:${options.port}`);
  const pool = mysql.createPool(options);
  try {
    const conn = await pool.getConnection();
    try {
      const applied = await applyPendingMigrations(conn, MIGRATIONS);
      console.log(
        applied.length === 0 ? "Already up to date" : applied.map((v) => `Applied ${v}`).join("\n"),
      );
    } finally {
      conn.release();
    }
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
