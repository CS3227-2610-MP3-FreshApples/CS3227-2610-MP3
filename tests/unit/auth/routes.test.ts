import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../../src/server/composition", () => ({
  authService: { login: vi.fn(), resolveSession: vi.fn(), logout: vi.fn() },
  identityService: { register: vi.fn() },
  csrfService: { verifyPreSession: vi.fn(), verifyOrigin: vi.fn(), verifyToken: vi.fn(), clearPreSessionCookie: vi.fn(), clearSessionCookie: vi.fn(), serializeSessionCookie: vi.fn(), serializePreSessionCookie: vi.fn(), issueToken: vi.fn(), issuePreSession: vi.fn() },
  securityLog: { record: vi.fn() },
  config: { core: { valid: true, value: { appEnv: "test", publicAppUrl: "http://localhost:3000" } } },
}));

import { POST } from "../../../src/app/api/v1/auth/register/route";
import { csrfService, identityService } from "../../../src/server/composition";

const csrfServiceMock = vi.mocked(csrfService as NonNullable<typeof csrfService>);
const identity = vi.mocked(identityService as NonNullable<typeof identityService>);

beforeEach(() => {
  vi.clearAllMocks();
  csrfServiceMock.verifyPreSession.mockReturnValue(true);
  csrfServiceMock.verifyOrigin.mockReturnValue(false);
  csrfServiceMock.verifyToken.mockReturnValue(false);
  identity.register.mockReset();
});

describe("POST /api/v1/auth/register", () => {
  it("rejects privileged fields without creating an account", async () => {
    identity.register.mockResolvedValue({ ok: false, error: { kind: "invalid_fields", fieldErrors: { role: ["unrecognized key"] } } });
    const response = await POST(
      new Request("http://localhost:3000/api/v1/auth/register", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          "x-csrf-token": "invalid",
          cookie: "fa_presession=invalid",
        },
        body: JSON.stringify({
          email: "person@example.com",
          password: "correct horse battery staple1!",
          displayName: "Person",
          role: "ADMIN",
        }),
      }),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: "validation_failed", fieldErrors: { role: ["unrecognized key"] } } });
  });

  it("checks Origin and CSRF before invoking account creation", async () => {
    identity.register.mockResolvedValue({ ok: true, value: { id: "00000000-0000-4000-8000-000000000001" as never, displayName: "Person", role: "USER", status: "active", version: 1 as never } });

    const response = await POST(new Request("http://localhost:3000/api/v1/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example", cookie: "fa_presession=valid" },
      body: JSON.stringify({ email: "person@example.com", password: "correct horse battery staple1!", displayName: "Person" }),
    }));

    expect(response.status).toBe(403);
    expect(identity.register).not.toHaveBeenCalled();
  });
});
