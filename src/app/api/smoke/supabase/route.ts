// TEMPORARY deployment smoke test (spec/tech-stack.md, OQ-02, AT-18/AT-19): checks that
// Vercel reaches Supabase through the transaction pooler over verified TLS as the
// least-privilege runtime role. Not part of the /api/v1 contract. Remove once recorded.
import { timingSafeEqual } from "node:crypto";
import { Client } from "pg";

function isAuthorised(request: Request): boolean {
  const expected = process.env.SMOKE_TEST_TOKEN;
  const header = request.headers.get("authorization") ?? "";
  if (!expected || !header.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice("Bearer ".length));
  const wanted = Buffer.from(expected);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

// Report only the SQLSTATE / error class, never messages (they may contain hostnames).
function errorCode(error: unknown): string {
  const code = (error as { code?: unknown })?.code;
  return typeof code === "string" ? code : error instanceof Error ? error.name : "UnknownError";
}

async function expectDenied(client: Client, sql: string): Promise<boolean> {
  try {
    await client.query(sql);
    return false;
  } catch (error) {
    return errorCode(error) === "42501"; // insufficient_privilege
  }
}

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorised(request)) {
    return Response.json({ error: "unauthorised" }, { status: 401 });
  }

  const connectionString = process.env.DATABASE_URL;
  const ca = process.env.DATABASE_CA_CERT;
  if (!connectionString || !ca) {
    return Response.json({ error: "DATABASE_URL / DATABASE_CA_CERT not set" }, { status: 500 });
  }

  const client = new Client({
    connectionString,
    ssl: { ca, rejectUnauthorized: true },
    connectionTimeoutMillis: 10_000,
    statement_timeout: 5_000,
  });

  const started = Date.now();
  const result: Record<string, unknown> = { region: process.env.VERCEL_REGION ?? "local" };
  try {
    await client.connect();
    result.connectMs = Date.now() - started;

    const info = await client.query(
      "select current_user as role, current_setting('server_version') as version, " +
        "(select ssl from pg_stat_ssl where pid = pg_backend_pid()) as ssl",
    );
    result.session = info.rows[0];

    // Marker row proves which project this environment reaches (dev vs prod isolation).
    const env = await client.query<{ name: string }>("select name from app.smoke_env");
    result.database = env.rows.map((row) => row.name);

    const transactionStarted = Date.now();
    await client.query("begin");
    const inserted = await client.query<{ id: string }>(
      "insert into app.smoke_check default values returning id",
    );
    const id = inserted.rows[0].id;
    const read = await client.query<{ n: number }>(
      "select count(*)::int as n from app.smoke_check where id = $1",
      [id],
    );
    await client.query("delete from app.smoke_check where id = $1", [id]);
    await client.query("commit");
    result.transaction = { ok: read.rows[0].n === 1, ms: Date.now() - transactionStarted };

    result.leastPrivilege = {
      ddlDenied: await expectDenied(client, "create table app.smoke_denied (id int)"),
      authSchemaDenied: await expectDenied(client, "select 1 from auth.users limit 1"),
    };
  } catch (error) {
    result.error = errorCode(error);
  } finally {
    await client.end().catch(() => undefined);
  }
  result.totalMs = Date.now() - started;

  return Response.json(result, { headers: { "Cache-Control": "no-store" } });
}
