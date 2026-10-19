import { expect, test } from "@playwright/test";

// Health/bootstrap smoke spec (D-42, D-51, AT-26): liveness is available before provisioning; the real
// bootstrap endpoint creates the disposable synthetic Admin; readiness then proves the app reaches the
// database as the per-run login role. This is local test evidence, not a live Vercel operator action.

test.describe.serial("anonymous health and local synthetic bootstrap", () => {
  test("GET /api/v1/health/live is available before first-Admin provisioning", async ({ request }) => {
    const response = await request.get("/api/v1/health/live", { maxRedirects: 0 });

    expect(response.status()).toBe(200);
    expect(await response.text()).toBe('{"status":"ok"}');
    expect(response.headers()["cache-control"]).toBe("no-store");
  });

  test("POST /api/v1/internal/bootstrap/admin provisions the disposable Admin", async ({ request }) => {
    const secret = process.env.ADMIN_BOOTSTRAP_SECRET;
    expect(secret).toBeTruthy();
    const response = await request.post("/api/v1/internal/bootstrap/admin", {
      headers: { "x-admin-bootstrap-secret": secret! },
    });

    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual({ status: "created" });
  });

  test("GET /api/v1/health/ready is available after first-Admin provisioning", async ({ request }) => {
    const response = await request.get("/api/v1/health/ready", { maxRedirects: 0 });

    expect(response.status()).toBe(200);
    expect(await response.text()).toBe('{"status":"ready"}');
    expect(response.headers()["cache-control"]).toBe("no-store");
  });
});
