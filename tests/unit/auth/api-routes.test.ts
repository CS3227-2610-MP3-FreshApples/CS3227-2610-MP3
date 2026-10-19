import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../../src/server/composition", () => ({
  authService: { register: vi.fn(), login: vi.fn(), resolveSession: vi.fn(), logout: vi.fn() },
  clientIpResolver: vi.fn(() => "unknown"),
  identityService: { register: vi.fn() },
  csrfService: { verifyPreSession: vi.fn(), verifyOrigin: vi.fn(), verifyToken: vi.fn(), clearPreSessionCookie: vi.fn(), clearSessionCookie: vi.fn(), serializeSessionCookie: vi.fn(), serializePreSessionCookie: vi.fn(), issueToken: vi.fn(), issuePreSession: vi.fn() },
  securityLog: { record: vi.fn() },
  config: { core: { valid: true, value: { appEnv: "test", publicAppUrl: "http://localhost:3000" } } },
}));

import { authService, clientIpResolver, config, csrfService, securityLog } from "../../../src/server/composition";
import { ServiceUnavailableError, TransactionConflict } from "../../../src/server/shared";
import type { AccountId, RowVersion, SessionId } from "../../../src/server/shared";
import { POST as login } from "../../../src/app/api/v1/auth/login/route";
import { POST as logout } from "../../../src/app/api/v1/auth/logout/route";
import { GET as me } from "../../../src/app/api/v1/auth/me/route";
import { GET as csrf } from "../../../src/app/api/v1/auth/csrf/route";
import { cookie } from "../../../src/app/api/v1/auth/http";

const auth = vi.mocked(authService as NonNullable<typeof authService>);
const resolveClientIp = vi.mocked(clientIpResolver);
const csrfMock = vi.mocked(csrfService as NonNullable<typeof csrfService>);
const securityLogMock = vi.mocked(securityLog);
const mockCoreConfig = config.core as { valid: true; value: { appEnv: string; publicAppUrl: string } };
const account = { id: "00000000-0000-4000-8000-000000000001" as AccountId, displayName: "Person", role: "USER" as const, status: "active" as const, version: 1 as RowVersion };

function request(path: string, init?: RequestInit): Request {
  return new Request(`http://localhost:3000${path}`, init);
}

beforeEach(() => {
  vi.resetAllMocks();
  resolveClientIp.mockReturnValue("unknown");
  mockCoreConfig.value.appEnv = "test";
  mockCoreConfig.value.publicAppUrl = "http://localhost:3000";
  csrfMock.verifyPreSession.mockReturnValue(true);
  csrfMock.verifyOrigin.mockReturnValue(true);
  csrfMock.verifyToken.mockReturnValue(true);
  csrfMock.serializeSessionCookie.mockReturnValue("fa_session=session; HttpOnly; SameSite=Lax; Path=/");
  csrfMock.serializePreSessionCookie.mockReturnValue("fa_presession=pre_v1.binding; HttpOnly; SameSite=Lax; Path=/; Max-Age=1800");
  csrfMock.clearPreSessionCookie.mockReturnValue("fa_presession=; Max-Age=0");
  csrfMock.clearSessionCookie.mockReturnValue("fa_session=; Max-Age=0");
  csrfMock.issueToken.mockReturnValue("csrf_v1.token");
  csrfMock.issuePreSession.mockReturnValue({ value: "pre_v1.binding", expiresAt: new Date() });
});

describe("authentication API routes", () => {
  it("returns a generic login failure with a request ID", async () => {
    auth.login.mockResolvedValue({ ok: false, error: { kind: "unauthenticated" } });
    const response = await login(request("/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000", cookie: "fa_presession=pre_v1.binding", "x-csrf-token": "csrf" }, body: JSON.stringify({ email: "unknown@example.com", password: "correct horse battery staple1!" }) }));
    expect(response.status).toBe(401);
    expect((await response.json()).error.message).toBe("Authentication is required.");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("returns 429 and Retry-After for a throttled login", async () => {
    auth.login.mockResolvedValue({ ok: false, error: { kind: "rate_limited", retryAfterSeconds: 321 } });
    const response = await login(request("/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000", cookie: "fa_presession=pre_v1.binding", "x-csrf-token": "csrf" }, body: JSON.stringify({ email: "person@example.com", password: "correct horse battery staple1!" }) }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("321");
  });

  it("passes the composition-resolved client IP to login", async () => {
    resolveClientIp.mockReturnValue("203.0.113.11");
    auth.login.mockResolvedValue({ ok: false, error: { kind: "unauthenticated" } });

    await login(request("/api/v1/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        cookie: "fa_presession=pre_v1.binding",
        "x-csrf-token": "csrf",
        "x-real-ip": "203.0.113.11",
        "x-forwarded-for": "198.51.100.77",
      },
      body: JSON.stringify({ email: "person@example.com", password: "correct horse battery staple1!" }),
    }));

    expect(resolveClientIp).toHaveBeenCalledOnce();
    expect(resolveClientIp.mock.calls[0]?.[0]).toBeInstanceOf(Headers);
    expect(auth.login).toHaveBeenCalledWith(
      expect.any(Object),
      "203.0.113.11",
      expect.any(String),
    );
  });

  it("sets a session cookie and clears the pre-session on successful login", async () => {
    auth.login.mockResolvedValue({ ok: true, value: { ...account, session: { token: "session-token", session: { id: "session-id" as SessionId } as never } } });
    const response = await login(request("/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000", cookie: "fa_presession=pre_v1.binding", "x-csrf-token": "csrf" }, body: JSON.stringify({ email: "person@example.com", password: "correct horse battery staple1!" }) }));
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("fa_session=session");
    expect(response.headers.get("set-cookie")).toContain("fa_presession=");
  });

  it("records the uniform D-47 CSRF denial when the pre-session is missing or invalid", async () => {
    const body = JSON.stringify({ email: "person@example.com", password: "correct horse battery staple1!" });
    const missing = await login(request("/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000", "x-csrf-token": "csrf" },
      body,
    }));

    expect(missing.status).toBe(403);
    expect(securityLogMock.record).toHaveBeenCalledWith(expect.objectContaining({ event: "auth.csrf_failed", code: "csrf_failed" }));

    vi.clearAllMocks();
    csrfMock.verifyPreSession.mockReturnValue(false);
    const invalid = await login(request("/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000", cookie: "fa_presession=invalid", "x-csrf-token": "csrf" },
      body,
    }));

    expect(invalid.status).toBe(403);
    expect(securityLogMock.record).toHaveBeenCalledWith(expect.objectContaining({ event: "auth.csrf_failed", code: "csrf_failed" }));
    expect(auth.login).not.toHaveBeenCalled();
  });

  it("returns the authenticated projection from /auth/me and rejects absent sessions", async () => {
    auth.resolveSession.mockResolvedValueOnce({ account, sessionId: "session-id" as SessionId }).mockResolvedValueOnce(null);
    expect(await (await me(request("/api/v1/auth/me", { headers: { cookie: "fa_session=session" } }))).json()).toEqual(account);
    expect((await me(request("/api/v1/auth/me"))).status).toBe(401);
  });

  it("logs out and clears the session cookie", async () => {
    auth.resolveSession.mockResolvedValue({ account, sessionId: "session-id" as SessionId });
    const logoutRequest = request("/api/v1/auth/logout", { method: "POST", headers: { cookie: "fa_session=session", origin: "http://localhost:3000", "x-csrf-token": "csrf" } });
    expect(cookie(logoutRequest, "fa_session", false)).toBe("session");
    const response = await logout(logoutRequest);
    expect(response.status).toBe(204);
    expect(auth.logout).toHaveBeenCalledWith("session-id");
    expect(response.headers.get("set-cookie")).toContain("fa_session=");
  });

  it("issues an anonymous CSRF token and pre-session cookie", async () => {
    const response = await csrf(request("/api/v1/auth/csrf"));
    expect(response.status).toBe(200);
    expect((await response.json()).csrfToken).toBe("csrf_v1.token");
    expect(csrfMock.serializePreSessionCookie).toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toContain("fa_presession=pre_v1.binding");
  });

  it("rejects malformed JSON and unsupported content types safely", async () => {
    const malformed = await login(request("/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: "{" }));
    const unsupported = await login(request("/api/v1/auth/login", { method: "POST", headers: { "content-type": "text/plain" }, body: "{}" }));
    expect(malformed.status).toBe(400);
    expect(unsupported.status).toBe(415);
    expect((await malformed.json()).error).not.toHaveProperty("stack");
  });

  it("rejects an oversized streamed body before CSRF or the auth service", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`{"email":"person@example.com","password":"${"a".repeat(33_000)}"}`));
        controller.close();
      },
    });
    const oversized = await login(new Request("http://localhost:3000/api/v1/auth/login", {
      method: "POST",
      body,
      duplex: "half",
      headers: { "content-type": "application/json" },
    } as RequestInit & { duplex: "half" }));

    expect(oversized.status).toBe(413);
    expect(auth.login).not.toHaveBeenCalled();
    expect(csrfMock.verifyToken).not.toHaveBeenCalled();
  });

  it("uses hosted cookie names across csrf, login, me, and logout", async () => {
    mockCoreConfig.value.appEnv = "production";
    mockCoreConfig.value.publicAppUrl = "https://app.example.test";
    csrfMock.serializeSessionCookie.mockReturnValue("__Host-fa_session=session; HttpOnly; Secure; SameSite=Lax; Path=/");
    csrfMock.clearPreSessionCookie.mockReturnValue("__Host-fa_presession=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0");
    csrfMock.clearSessionCookie.mockReturnValue("__Host-fa_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0");
    csrfMock.serializePreSessionCookie.mockReturnValue("__Host-fa_presession=pre_v1.binding; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=1800");
    auth.login.mockResolvedValue({ ok: true, value: { ...account, session: { token: "session-token", session: { id: "session-id" as SessionId } as never } } });

    const loginResponse = await login(request("/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: "https://app.example.test", cookie: "__Host-fa_presession=pre_v1.binding", "x-csrf-token": "csrf" }, body: JSON.stringify({ email: "person@example.com", password: "correct horse battery staple1!" }) }));
    expect(loginResponse.status).toBe(200);
    expect(loginResponse.headers.get("set-cookie")).toContain("__Host-fa_session=");
    expect(auth.login).toHaveBeenCalled();

    auth.resolveSession.mockResolvedValue({ account, sessionId: "session-id" as SessionId });
    expect((await me(request("/api/v1/auth/me", { headers: { cookie: "__Host-fa_session=session-token" } }))).status).toBe(200);
    const logoutResponse = await logout(request("/api/v1/auth/logout", { method: "POST", headers: { cookie: "__Host-fa_session=session-token", origin: "https://app.example.test", "x-csrf-token": "csrf" } }));
    expect(logoutResponse.status).toBe(204);
    expect(logoutResponse.headers.get("set-cookie")).toContain("__Host-fa_session=");

    auth.resolveSession.mockResolvedValue(null);
    const csrfResponse = await csrf(request("/api/v1/auth/csrf"));
    expect(csrfResponse.status).toBe(200);
    expect(csrfResponse.headers.get("set-cookie")).toContain("__Host-fa_presession=");
  });

  it("maps route-level dependency and transaction failures with the K2 contract", async () => {
    const valid = { "content-type": "application/json", origin: "http://localhost:3000", cookie: "fa_presession=pre_v1.binding", "x-csrf-token": "csrf" };
    auth.login.mockRejectedValueOnce(new ServiceUnavailableError());
    const unavailable = await login(request("/api/v1/auth/login", { method: "POST", headers: valid, body: JSON.stringify({ email: "person@example.com", password: "correct horse battery staple1!" }) }));
    expect(unavailable.status).toBe(503);
    expect((await unavailable.json()).error.requestId).toBe(unavailable.headers.get("x-request-id"));

    auth.login.mockRejectedValueOnce(new TransactionConflict());
    const conflict = await login(request("/api/v1/auth/login", { method: "POST", headers: valid, body: JSON.stringify({ email: "person@example.com", password: "correct horse battery staple1!" }) }));
    expect(conflict.status).toBe(409);

    auth.login.mockRejectedValueOnce(new Error("secret database detail"));
    const unexpected = await login(request("/api/v1/auth/login", { method: "POST", headers: valid, body: JSON.stringify({ email: "person@example.com", password: "correct horse battery staple1!" }) }));
    expect(unexpected.status).toBe(500);
    expect(await unexpected.text()).not.toContain("secret database detail");
  });
});
