import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../../src/server/composition", () => ({
  authGuards: { requireActiveAdmin: vi.fn() },
  adminReportService: { list: vi.fn(), get: vi.fn() },
}));

import { GET as listReports } from "../../../src/app/api/v1/admin/reports/route";
import { GET as getReport } from "../../../src/app/api/v1/admin/reports/[id]/route";
import { adminReportService, authGuards } from "../../../src/server/composition";
import type { Principal } from "../../../src/server/services/identity";
import type { AccountId, ReportId, SessionId } from "../../../src/server/shared";

const ADMIN_ID = "00000000-0000-4000-8000-000000000001" as AccountId;
const REPORT_ID = "00000000-0000-4000-8000-000000000002" as ReportId;
const principal: Principal = { accountId: ADMIN_ID, sessionId: "session" as SessionId, role: "ADMIN" };

function request(path: string): Request {
  return new Request(`http://localhost:3000${path}`);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(authGuards!.requireActiveAdmin).mockResolvedValue({ ok: true, value: principal });
});

describe("A-05 Admin Report read routes", () => {
  it("defaults to open reports and forwards status/category filters", async () => {
    vi.mocked(adminReportService!.list).mockResolvedValue({ ok: true, value: { items: [], total: 0 } });
    const response = await listReports(request("/api/v1/admin/reports?status=all&category=harassment&page=2&pageSize=10"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ items: [], page: 2, pageSize: 10, total: 0 });
    expect(adminReportService!.list).toHaveBeenCalledWith(principal, { status: "all", category: "harassment" }, 2, 10);
  });

  it("returns the Admin detail projection with a quoted version ETag", async () => {
    vi.mocked(adminReportService!.get).mockResolvedValue({ ok: true, value: {
      id: REPORT_ID,
      status: "open",
      category: "spam",
      createdAt: "2026-10-22T00:00:00.000Z",
      version: 1 as never,
      reporter: { id: ADMIN_ID, displayName: "Reporter" },
      target: { id: ADMIN_ID, displayName: "Target", status: "active", strikeCount: 0, strikeThreshold: 3 },
      review: { id: REPORT_ID as never, movieId: REPORT_ID as never, movieTitle: "Movie", state: "cleared" },
      explanation: "A sufficiently detailed report explanation.",
      evidence: { reviewId: REPORT_ID as never, reviewVersion: 1 as never, authorId: ADMIN_ID, movieId: REPORT_ID as never, movieTitle: "Movie", body: "A review body of sufficient length.", rating: 8 },
      liveReview: { version: 1 as never, moderationState: "cleared", hidden: false, deleted: false, movieArchived: false },
      projectedEffect: { strikeAdded: true, strikeCountAfter: 1, wouldSuspend: false, accountStatusAfter: "active" },
      decision: null,
    }});

    const response = await getReport(request(`/api/v1/admin/reports/${REPORT_ID}`), { params: Promise.resolve({ id: REPORT_ID }) });

    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('"1"');
    expect(await response.json()).toEqual(expect.objectContaining({ id: REPORT_ID, projectedEffect: expect.objectContaining({ strikeAdded: true }) }));
    expect(adminReportService!.get).toHaveBeenCalledWith(principal, REPORT_ID);
  });
});
