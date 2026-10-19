import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../../src/server/composition", () => ({
  config: {
    bootstrap: {
      enabled: true,
      secret: "synthetic-bootstrap-secret",
      email: "admin@example.test",
      password: "Synthetic-admin-password1!",
    },
  },
  firstAdminBootstrapService: { bootstrap: vi.fn() },
  securityLog: { record: vi.fn() },
}));

import { config, firstAdminBootstrapService, securityLog } from "../../../src/server/composition";
import { POST } from "../../../src/app/api/v1/internal/bootstrap/admin/route";
import { ServiceUnavailableError } from "../../../src/server/shared";

const bootstrapMock = vi.mocked(firstAdminBootstrapService!.bootstrap);
const securityLogMock = vi.mocked(securityLog.record);

beforeEach(() => {
  bootstrapMock.mockReset();
  securityLogMock.mockReset();
});

describe("POST internal first-Admin bootstrap", () => {
  it("rejects a missing deployment secret without invoking Identity", async () => {
    const response = await POST(new Request("http://localhost/api/v1/internal/bootstrap/admin"));

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("forbidden");
    expect(bootstrapMock).not.toHaveBeenCalled();
  });

  it("makes a wrong secret indistinguishable and never records it", async () => {
    const suppliedSecret = "wrong-synthetic-secret";
    const response = await POST(new Request("http://localhost/api/v1/internal/bootstrap/admin", {
      method: "POST",
      headers: { "x-admin-bootstrap-secret": suppliedSecret },
    }));

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("forbidden");
    expect(bootstrapMock).not.toHaveBeenCalled();
    expect(JSON.stringify(securityLogMock.mock.calls)).not.toContain(suppliedSecret);
  });

  it("returns only the provisioning status and never credentials", async () => {
    bootstrapMock.mockResolvedValue({ ok: true, status: "created" });
    const response = await POST(
      new Request("http://localhost/api/v1/internal/bootstrap/admin", {
        method: "POST",
        headers: { "x-admin-bootstrap-secret": "synthetic-bootstrap-secret" },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toBe('{"status":"created"}');
    expect(body).not.toContain("admin@example.test");
    expect(body).not.toContain("Synthetic-admin-password1!");
    expect(bootstrapMock).toHaveBeenCalledTimes(1);
  });

  it("returns the distinct idempotent success status", async () => {
    bootstrapMock.mockResolvedValue({ ok: true, status: "already_provisioned" });
    const response = await POST(new Request("http://localhost/api/v1/internal/bootstrap/admin", {
      method: "POST",
      headers: { "x-admin-bootstrap-secret": "synthetic-bootstrap-secret" },
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "already_provisioned" });
  });

  it("maps a normalized-email conflict to the safe 409 envelope", async () => {
    bootstrapMock.mockResolvedValue({ ok: false, error: "conflict" });
    const response = await POST(new Request("http://localhost/api/v1/internal/bootstrap/admin", {
      method: "POST",
      headers: { "x-admin-bootstrap-secret": "synthetic-bootstrap-secret" },
    }));

    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("conflict");
  });

  it("maps dependency failure to 503 without exposing its error", async () => {
    bootstrapMock.mockRejectedValue(new ServiceUnavailableError());
    const response = await POST(new Request("http://localhost/api/v1/internal/bootstrap/admin", {
      method: "POST",
      headers: { "x-admin-bootstrap-secret": "synthetic-bootstrap-secret" },
    }));

    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("database");
  });

  it("ignores browser identity, cookies, CSRF, Origin, and inbound request IDs", async () => {
    bootstrapMock.mockResolvedValue({ ok: true, status: "created" });
    const inboundId = "00000000-0000-4000-8000-000000000099";
    const response = await POST(new Request("http://localhost/api/v1/internal/bootstrap/admin", {
      method: "POST",
      headers: {
        "x-admin-bootstrap-secret": "synthetic-bootstrap-secret",
        cookie: "fa_session=browser-session; fa_presession=browser-presession",
        origin: "https://untrusted.example",
        "x-csrf-token": "invalid-browser-token",
        "x-request-id": inboundId,
      },
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).not.toBe(inboundId);
    expect(bootstrapMock).toHaveBeenCalledTimes(1);
  });

  it("rejects the operation when bootstrap configuration is invalid", async () => {
    const original = config.bootstrap;
    (config as { bootstrap: typeof original }).bootstrap = { enabled: false, issues: [{ variable: "ADMIN_BOOTSTRAP_SECRET", message: "invalid" }] };

    const response = await POST(new Request("http://localhost/api/v1/internal/bootstrap/admin", {
      method: "POST",
      headers: { "x-admin-bootstrap-secret": "wrong-secret-must-not-change-precedence" },
    }));

    expect(response.status).toBe(503);
    expect(bootstrapMock).not.toHaveBeenCalled();
    (config as { bootstrap: typeof original }).bootstrap = original;
  });

  it("does not invoke bootstrap during route module initialization", async () => {
    vi.resetModules();
    const freshComposition = await import("../../../src/server/composition");
    await import("../../../src/app/api/v1/internal/bootstrap/admin/route");
    expect(freshComposition.firstAdminBootstrapService?.bootstrap).not.toHaveBeenCalled();
  });
});
