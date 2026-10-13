const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The disposable PostgreSQL for integration tests (D-10). Refuses anything but a loopback host,
 * so a test run can never reach the shared Supabase projects.
 */
export function testDatabaseUrl(): string {
  const raw = process.env.TEST_DATABASE_URL;
  if (raw === undefined || raw === "") {
    throw new Error("TEST_DATABASE_URL must be set to a disposable local PostgreSQL (D-10)");
  }
  let host: string;
  try {
    host = new URL(raw).hostname;
  } catch {
    throw new Error("TEST_DATABASE_URL is not a valid URL");
  }
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error("TEST_DATABASE_URL must use a loopback host");
  }
  return raw;
}
