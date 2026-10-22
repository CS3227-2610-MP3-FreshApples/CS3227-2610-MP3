import { describe, expect, it } from "vitest";
import { decideReport, getReport, isAdminReport, listReports } from "../../../src/app/admin/_lib/report-client";

const report = { id: "report-1", status: "open", category: "harassment", createdAt: "2026-10-22T00:00:00.000Z", version: 1, reporter: { id: "user-1", displayName: "Reporter" }, target: { id: "user-2", displayName: "Target", status: "active" }, review: { id: "review-1", movieId: "movie-1", movieTitle: "Movie", state: "cleared" } };
const detail = { ...report, explanation: "A sufficiently detailed report explanation.", evidence: { reviewId: "review-1", reviewVersion: 1, authorId: "user-2", movieId: "movie-1", movieTitle: "Movie", body: "Review body", rating: 8 }, liveReview: { version: 1, moderationState: "cleared", hidden: false, deleted: false, movieArchived: false }, target: { ...report.target, strikeCount: 2, strikeThreshold: 3 }, projectedEffect: { strikeAdded: true, strikeCountAfter: 3, wouldSuspend: true, accountStatusAfter: "suspended" }, decision: null };

function response(body: unknown, status = 200, headers: Record<string, string> = {}): Response { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } }); }

describe("A-05 Admin report client", () => {
  it("validates list/detail projections and uses the approved filters", async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => { calls.push([input, init]); return response({ items: [report], page: 2, pageSize: 20, total: 1 }); };
    await expect(listReports(2, { status: "all", category: "harassment" }, fetcher)).resolves.toMatchObject({ ok: true });
    expect(String(calls[0]?.[0])).toContain("status=all");
    expect(isAdminReport(detail)).toBe(true);
    await expect(getReport("report-1", async () => response(detail, 200, { etag: '"1"' }))).resolves.toMatchObject({ ok: true, value: detail });
  });

  it("sends CSRF, If-Match, and the accepted decision body", async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => { calls.push([input, init]); return String(input).endsWith("/csrf") ? response({ csrfToken: "csrf.synthetic" }) : response({ report: { ...detail, status: "accepted", version: 2 }, decision: { id: "decision-1", disposition: "accepted", actions: [], reason: "A valid reason." }, strikeAdded: false, accountStatus: "active", version: 2 }, 200, { etag: '"2"' }); };
    await expect(decideReport("report-1", 1, { disposition: "accepted", actions: [], reason: "A valid reason." }, fetcher)).resolves.toMatchObject({ ok: true });
    expect(calls[1]?.[1]).toMatchObject({ method: "POST", headers: { "X-CSRF-Token": "csrf.synthetic", "If-Match": '"1"', "Content-Type": "application/json" } });
  });

  it("rejects malformed detail projections instead of treating them as trusted data", () => {
    expect(isAdminReport({ ...detail, target: { ...detail.target, strikeCount: -1 } })).toBe(false);
    expect(isAdminReport({ ...detail, decision: { id: "decision-1", disposition: "open", actions: [], reason: "bad", createdAt: detail.createdAt } })).toBe(false);
    expect(isAdminReport({ ...detail, evidence: { ...detail.evidence, reviewId: "other-review" } })).toBe(false);
  });
});
