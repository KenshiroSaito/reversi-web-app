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
| `DB_POOL_MAX` | Optional, default `3` (see section 7) |

The app refuses to connect on Vercel without `DB_CA_CERT`, and verifies the
server certificate against it. A missing variable is reported by name in the
function logs; values are never logged.

## 6. Preview deployments

Every push to a non-production branch (for example a `feat/phase-N-*` branch)
creates a Preview deployment. Feature branches can change the schema, so a
preview must never point at the production database.

In Vercel, each environment variable is assigned to one or more environments
(Production, Preview, Development). Add every `DB_*` variable **twice**:

- once scoped to **Production**, with the production database's values;
- once scoped to **Preview**, with a separate preview database's values.

Never tick Preview on a production value. If a `DB_*` variable is missing from
the Preview scope, preview deployments fail with `Missing required environment
variable` rather than silently falling back to production.

For the preview database, use a second Aiven service if your plan allows it
(it can then keep the database name `reversi`). Otherwise create a second
database on the same service and load the schema into it under its own name:

```bash
sed -e 's/ reversi;/ reversi_preview;/' mysql/init.sql | \
  mysql --host=<host> --port=<port> --user=avnadmin --password \
    --ssl-mode=VERIFY_CA --ssl-ca=ca.pem
```

and set the Preview-scoped `DB_NAME` to `reversi_preview`. Two databases on
one service share its `max_connections`, so size `DB_POOL_MAX` for both
(section 7).

## 7. Sizing the connection pool

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

## 8. Verify the deployment

1. Open the site; the home page and `/game/` load (served by the CDN).
2. Start a match and place a few stones.
3. Return home; the game appears in the history table.
4. In the function logs, check there are no `Missing required environment
   variable` or TLS errors.

## Local development

Local settings live in `.env` (copy `.env.example`); `npm start` loads it.
Integration tests (`npm run test:integration`) use a separate `reversi_test`
database on the Docker MySQL and rebuild it on every run.
