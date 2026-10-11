# CS3227-2610-MP3

## SoCLaaS reachability smoke test (temporary)

1. Copy `.env.example` to `.env.local` (locally) or add the same variables to Vercel (**Project → Settings → Environment Variables**): `SOCLAAS_BASE_URL`, `SOCLAAS_API_KEY`, `SOCLAAS_MODEL` (an `id` from `/models`) and `SMOKE_TEST_TOKEN` (a long random string).
2. From outside the university network/VPN, open `https://<deployment-url>` in a browser signed in to Vercel, open the DevTools console (F12) on that tab and run:

   ```js
   const res = await fetch("/api/smoke/soclaas", {
     headers: { Authorization: "Bearer <SMOKE_TEST_TOKEN>" },
     cache: "no-store",
   });
   console.log(res.status, await res.json());
   ```

   `curl` returns "Redirecting..." because Vercel Deployment Protection sends unauthenticated requests to the Vercel login page; the browser tab already carries your Vercel login. If the console blocks pasting, type `allow pasting` first. Do not share screenshots that show the token.

3. `models.ok: true` and `chat.replied: true` mean SoCLaaS is reachable. `status: null` with a `TimeoutError`/`TypeError` usually means a network or IP restriction.

Record the result in `logs/`, then remove `src/app/api/smoke/soclaas/`.

## Supabase reachability smoke test (temporary)

`GET /api/smoke/supabase` connects through the Supabase transaction pooler as the least-privilege `app_runtime` role over CA-verified TLS. It runs one insert/read/delete transaction on synthetic data and checks that DDL and `auth.users` access are denied. It returns only the role, server version, TLS flag, environment marker, latencies and SQLSTATE codes, never hostnames or credentials.

1. Set the variables, keeping production credentials out of `.env.local` and Preview:
   - `DATABASE_URL`: the transaction pooler URI (port 6543) with user `app_runtime.<project-ref>` and no `?sslmode=`.
   - `DATABASE_CA_CERT`: the project's CA certificate PEM (**Database → Settings → SSL Configuration**), in double quotes in `.env.local`.
   - `SMOKE_TEST_TOKEN`: as above.

   | Where | Project |
   | --- | --- |
   | `.env.local`, Vercel Preview | dev |
   | Vercel Production | prod |

2. Open `http://localhost:3000` (local) or `https://<deployment-url>` (Preview or Production, signed in to Vercel) in a browser, open the DevTools console on that tab and run:

   ```js
   const res = await fetch("/api/smoke/supabase", {
     headers: { Authorization: "Bearer <SMOKE_TEST_TOKEN>" },
     cache: "no-store",
   });
   console.log(res.status, await res.json());
   ```

3. A pass is `session.role: "app_runtime"`, `session.ssl: true`, `transaction.ok: true`, `leastPrivilege.ddlDenied` and `authSchemaDenied` both `true`, no `error`, and `database` of `["dev"]` locally and on Preview or `["prod"]` on Production. Common errors: `28P01` wrong password or user, `42P01` missing table, `ENOTFOUND`/`ETIMEDOUT` wrong host or port, `SELF_SIGNED_CERT_IN_CHAIN` wrong or truncated CA certificate.
