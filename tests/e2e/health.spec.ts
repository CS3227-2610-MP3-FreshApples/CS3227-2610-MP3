import { expect, test } from "@playwright/test";

// Health smoke spec (D-42, AT-26): both endpoints answer an anonymous request directly, with their exact
// bodies and no caching. The ready check also proves the app reaches the database as the per-run login role.

const ENDPOINTS = [
  { path: "/api/v1/health/live", body: '{"status":"ok"}' },
  { path: "/api/v1/health/ready", body: '{"status":"ready"}' },
] as const;

for (const { path, body } of ENDPOINTS) {
  test(`anonymous GET ${path} returns its exact body without redirect or caching`, async ({ request }) => {
    const response = await request.get(path, { maxRedirects: 0 });

    expect(response.status()).toBe(200);
    expect(await response.text()).toBe(body);
    expect(response.headers()["cache-control"]).toBe("no-store");
  });
}
