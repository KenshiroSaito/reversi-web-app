# Deploying to Vercel and Aiven

The app runs as one Vercel Function (`api/index.ts`) for `/api/*`, with the
pages in `static/` served by Vercel's CDN. The database is MySQL on Aiven.

## 1. Choose the region first

Vercel Functions run in `iad1` (Washington, D.C., USA) by default. Create the
Aiven service in the same area — for example AWS `us-east-1` — or change the
function region to match the database instead (Vercel project **Settings →
Functions → Function Region**, or `"regions": ["<id>"]` in `vercel.json`).

This matters because every query pays the function-to-database round trip,
including the `ROLLBACK` that runs whenever a request returns its connection
to the pool. Later phases poll the server every second during a game, so a
database on another continent would make every request noticeably slow.

## 2. Create the Aiven MySQL service

1. Create a MySQL service in the region chosen above.
2. From the service overview, note the host, port, user (`avnadmin`), and
   password, and download the CA certificate (`ca.pem`).
3. Check the connection limit:

   ```sql
   SHOW VARIABLES LIKE 'max_connections';
   ```

## 3. Load the schema (once)

`mysql/init.sql` creates the `reversi` database and its tables. It starts by
dropping that database, so run it **only against a new, empty service** —
never against a database that holds real data.

```bash
mysql --host=<host> --port=<port> --user=avnadmin --password \
  --ssl-mode=VERIFY_CA --ssl-ca=ca.pem < mysql/init.sql
```

Then apply the migrations (section 7).

## 4. Create the Vercel project

1. Import the Git repository in Vercel.
2. Leave the framework preset, build command, and output directory at their
   defaults: `vercel.json` sets the project to "Other", serves `static/` from
   the CDN, and routes `/api/*` to the function.
3. The Node.js version comes from `engines.node` in `package.json` (`24.x`).

## 5. Environment variables

Set these in **Settings → Environment Variables**, scoped to **Production
only**. Preview deployments get their own values; see section 6.

| Variable | Value |
| --- | --- |
| `DB_HOST` | Aiven host |
| `DB_PORT` | Aiven port |
| `DB_USER` | `avnadmin` (or a dedicated user) |
| `DB_PASSWORD` | Its password |
| `DB_NAME` | `reversi` |
| `DB_CA_CERT` | Full contents of `ca.pem`, including the `BEGIN`/`END` lines |
| `DB_POOL_MAX` | Optional, default `3` (see section 9) |
| `IP_HASH_SECRET` | At least 32 random characters (`openssl rand -base64 48`); used to hash client IPs for the new-guest cap. Use a different value per environment |

The app refuses to connect on Vercel without `DB_CA_CERT`, and verifies the
server certificate against it. A missing variable is reported by name in the
function logs; values are never logged.

## 6. Preview deployments

Every push to a non-production branch (for example a `feat/phase-N-*` branch)
creates a Preview deployment. Feature branches can change the schema, so a
preview must never point at the production database.

Aiven's free tier allows **one** MySQL service, so previews use a second
database, `reversi_preview`, on the same service. This is the intended setup,
not a fallback. Load the schema into it under its own name:

```bash
sed -e 's/ reversi;/ reversi_preview;/' mysql/init.sql | \
  mysql --host=<host> --port=<port> --user=avnadmin --password \
    --ssl-mode=VERIFY_CA --ssl-ca=ca.pem
```

In Vercel, each environment variable is assigned to one or more environments
(Production, Preview, Development). Add every `DB_*` variable and
`IP_HASH_SECRET` **twice**:

- once scoped to **Production**, with `DB_NAME=reversi`;
- once scoped to **Preview**, with `DB_NAME=reversi_preview`.

Never tick Preview on a production value. If a variable is missing from the
Preview scope, preview deployments fail with `Missing required environment
variable` rather than silently falling back to production.

Both databases share the service's 76 connections, so the pool budget in
section 9 covers production and preview instances together.

## 7. Migrations (before every deploy)

Schema changes are versioned in `src/infrastructure/migration/migrations.ts`
and recorded in each database's `schema_migrations` table. Apply them by hand
**before** the code that needs them is deployed. Merging into `main` deploys
production, so production is migrated **before the merge**, not after:

1. Migrate `reversi_preview` and set any new Preview-scoped variables.
2. Push the branch and check the preview deployment.
3. Migrate `reversi` and set any new Production-scoped variables (for
   Phase 1: `IP_HASH_SECRET`).
4. Merge into `main`.

Step 3 is safe while the old code is still live, because migrations only add
to the schema. Merging first would make production return 503 until the
migration runs.

```bash
npm run migrate -- --env-file .env.preview --database reversi_preview
npm run migrate -- --env-file .env.production --database reversi
```

The env file holds that environment's `DB_*` values, including `DB_CA_CERT`
(`.env.*` files are gitignored). Without `--env-file`, the command reads the
local `.env`. Variables already set in your shell take precedence over the
file, so make sure no `DB_*` variables are exported when you run it. The
command prints the target host and database first, and refuses to run if
`--database` does not match `DB_NAME`, or if a remote host is used without
`DB_CA_CERT`. Migrations only add to the schema, so the currently deployed
code keeps working while they are applied.

If code is deployed before its migrations, API requests return 503 and the
function logs contain a line like:

```
Request failed: {"method":"POST","path":"/api/games","error":{"name":"SchemaOutOfDateError","message":"Database schema is missing migrations: 001_create_players_and_game_players. Run `npm run migrate` against this database."}}
```

## 8. Firewall rate limit

Add one rate-limit rule in **Firewall → Configure → New Rule** (Hobby allows
one): if the request path starts with `/api/`, rate limit with a fixed window
of **60 s** and **300 requests** per **IP**, action **Default (429)**.
Blocked requests never reach the function, so they do not count towards the
monthly invocation limit. The app additionally caps new guests at 20 per IP
(per /64 for IPv6) per hour and new games at 10 per player per hour.

## 9. Sizing the connection pool

Each function instance keeps at most `DB_POOL_MAX` connections and closes them
after about 5 seconds without use, before the instance is suspended. The
worst case is therefore:

```
concurrent instances × DB_POOL_MAX  <  max_connections − headroom for admin sessions
```

Start with the default of 3. If the logs show requests waiting on the pool,
raise it; if Aiven reports too many connections, lower it. Avoid 1 in
production: it serialises concurrent requests on an instance without reducing
the total number of connections.

On the free tier, `max_connections` is 76 and is shared by `reversi` and
`reversi_preview`; with `DB_POOL_MAX=3`, keep the total number of concurrent
instances across both environments under about 23.

## 10. Verify the deployment

1. Open the site; the home page and `/game/` load (served by the CDN).
2. Start a match and place a few stones.
3. Return home; the game appears in the history table.
4. In the function logs, check there are no `Missing required environment
   variable` or TLS errors.
5. If the API returns 503, open the function logs: `ECONNREFUSED`,
   `ETIMEDOUT`, or `ENOTFOUND` means the database is unreachable (an idle
   Aiven free-tier service powers off; power it on in the Aiven console);
   `SchemaOutOfDateError` means migrations are missing (section 7).

## Local development

Local settings live in `.env` (copy `.env.example`); `npm start` loads it.
Integration tests (`npm run test:integration`) use a separate `reversi_test`
database on the Docker MySQL and rebuild it on every run.
