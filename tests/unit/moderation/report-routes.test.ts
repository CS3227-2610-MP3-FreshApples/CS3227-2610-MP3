import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../../src/server/composition", () => ({
  authGuards: {
    requireActiveUser: vi.fn(),
    requireActiveUserMutation: vi.fn(),
  },
  reportService: { submit: vi.fn() },
  reportReadService: { list: vi.fn(), get: vi.fn() },
}));

import { POST as submitReport } from "../../../src/app/api/v1/reports/route";
import { GET as listReports } from "../../../src/app/api/v1/me/reports/route";
import { GET as getReport } from "../../../src/app/api/v1/me/reports/[id]/route";
import { authGuards, reportReadService, reportService } from "../../../src/server/composition";
import type { Principal } from "../../../src/server/services/identity";
import type { AccountId, SessionId } from "../../../src/server/shared";

const testAuthGuards = authGuards!;
const testReportService = reportService!;
const testReportReadService = reportReadService!;

const USER_ID = "00000000-0000-4000-8000-000000000001" as AccountId;
const REPORT_ID = "00000000-0000-4000-8000-000000000002";
const REVIEW_ID = "00000000-0000-4000-8000-000000000003";
const principal: Principal = { accountId: USER_ID, sessionId: "session" as SessionId, role: "USER" };

function request(path: string, init?: RequestInit): Request {
  return new Request(`http://localhost:3000${path}`, init);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(testAuthGuards.requireActiveUserMutation).mockResolvedValue({ ok: true, value: principal });
  vi.mocked(testAuthGuards.requireActiveUser).mockResolvedValue({ ok: true, value: principal });
});

describe("U-03 report API routes", () => {
  it("creates a report from a review ID and returns only the reporter receipt", async () => {
    vi.mocked(testReportService.submit).mockResolvedValue({
      ok: true,
      value: { id: REPORT_ID as never, reviewId: REVIEW_ID as never, category: "spam", status: "open", createdAt: new Date("2026-10-21T00:00:00.000Z") },
    });
    const response = await submitReport(request("/api/v1/reports", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000", "x-csrf-token": "token" },
      body: JSON.stringify({ reviewId: REVIEW_ID, category: "spam", explanation: "A valid report explanation." }),
    }));

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual(expect.objectContaining({ id: REPORT_ID, reviewId: REVIEW_ID, status: "open" }));
    expect(body).not.toHaveProperty("evidenceSnapshot");
    expect(testReportService.submit).toHaveBeenCalledWith(principal.accountId, REVIEW_ID, { category: "spam", explanation: "A valid report explanation." });
  });

  it("lists only the authenticated reporter's receipt projection", async () => {
    vi.mocked(testReportReadService.list).mockResolvedValue({ items: [], page: 2, pageSize: 10, total: 0 });
    const response = await listReports(request("/api/v1/me/reports?page=2&pageSize=10"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ items: [], page: 2, pageSize: 10, total: 0 });
    expect(testReportReadService.list).toHaveBeenCalledWith(principal.accountId, 2, 10);
  });

  it("returns an ownership-protected report detail through the reporter service", async () => {
    vi.mocked(testReportReadService.get).mockResolvedValue({
      id: REPORT_ID as never, reviewId: REVIEW_ID as never, category: "spam", status: "dismissed", disposition: "dismissed", createdAt: new Date("2026-10-21T00:00:00.000Z"),
    });
    const response = await getReport(request(`/api/v1/me/reports/${REPORT_ID}`), { params: Promise.resolve({ id: REPORT_ID }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({ id: REPORT_ID, disposition: "dismissed" }));
    expect(testReportReadService.get).toHaveBeenCalledWith(principal.accountId, REPORT_ID);
  });

  it("rejects an invalid submission before calling the service", async () => {
    const response = await submitReport(request("/api/v1/reports", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000", "x-csrf-token": "token" },
      body: JSON.stringify({ reviewId: REVIEW_ID, category: "not-a-category", explanation: "short" }),
    }));

    expect(response.status).toBe(422);
    expect(testReportService.submit).not.toHaveBeenCalled();
  });

  it("returns not found when the detail service cannot find an owned report", async () => {
    vi.mocked(testReportReadService.get).mockResolvedValue(null);
    const response = await getReport(request(`/api/v1/me/reports/${REPORT_ID}`), { params: Promise.resolve({ id: REPORT_ID }) });

    expect(response.status).toBe(404);
    expect(testReportReadService.get).toHaveBeenCalledWith(principal.accountId, REPORT_ID);
  });

  it("rejects invalid pagination before calling the list service", async () => {
    const response = await listReports(request("/api/v1/me/reports?page=0&pageSize=101"));

    expect(response.status).toBe(422);
    expect(testReportReadService.list).not.toHaveBeenCalled();
  });
});
