import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../../src/server/composition", () => ({ authGuards: { requireActiveAdminMutation: vi.fn() }, adminReportService: { decide: vi.fn() } }));

import { POST as decideReport } from "../../../src/app/api/v1/admin/reports/[id]/decision/route";
import { adminReportService, authGuards } from "../../../src/server/composition";
import type { Principal } from "../../../src/server/services/identity";
import type { AccountId, ReportId, SessionId } from "../../../src/server/shared";

const ADMIN_ID = "00000000-0000-4000-8000-000000000001" as AccountId;
const REPORT_ID = "00000000-0000-4000-8000-000000000002" as ReportId;
const principal: Principal = { accountId: ADMIN_ID, sessionId: "session" as SessionId, role: "ADMIN" };

function request(body: unknown, headers: Record<string, string> = { origin: "http://localhost:3000", "x-csrf-token": "csrf", "if-match": '"1"' }): Request {
  return new Request(`http://localhost:3000/api/v1/admin/reports/${REPORT_ID}/decision`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}

beforeEach(() => { vi.resetAllMocks(); vi.mocked(authGuards!.requireActiveAdminMutation).mockResolvedValue({ ok: true, value: principal }); });

describe("A-05 Admin report decision route", () => {
  it("requires a quoted If-Match before dispatching a decision", async () => {
    const response = await decideReport(request({ disposition: "accepted", actions: [], reason: "A valid decision reason." }, { origin: "http://localhost:3000", "x-csrf-token": "csrf" }), { params: Promise.resolve({ id: REPORT_ID }) });
    expect(response.status).toBe(428);
    expect(vi.mocked(adminReportService!.decide)).not.toHaveBeenCalled();
  });

  it("passes the validated Admin decision to the service and returns the updated ETag", async () => {
    vi.mocked(adminReportService!.decide).mockResolvedValue({ ok: true, value: { report: { id: REPORT_ID, status: "accepted" } as never, decision: { id: "decision-1", disposition: "accepted", actions: [], reason: "A valid decision reason." }, strikeAdded: false, accountStatus: "active", version: 2 as never } });
    const response = await decideReport(request({ disposition: "accepted", actions: [], reason: "  A valid decision reason.  " }), { params: Promise.resolve({ id: REPORT_ID }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('"2"');
    expect(await response.json()).toEqual(expect.objectContaining({ report: expect.objectContaining({ status: "accepted" }), strikeAdded: false }));
    expect(adminReportService!.decide).toHaveBeenCalledWith(principal, REPORT_ID, 1, { disposition: "accepted", actions: [], reason: "A valid decision reason." }, expect.any(String));
  });

  it("maps stale and repeated decisions to conflict responses", async () => {
    vi.mocked(adminReportService!.decide).mockResolvedValue({ ok: false, error: { kind: "conflict" } });
    const response = await decideReport(request({ disposition: "dismissed", actions: [], reason: "A valid dismissal reason." }), { params: Promise.resolve({ id: REPORT_ID }) });
    expect(response.status).toBe(409);
  });
});
