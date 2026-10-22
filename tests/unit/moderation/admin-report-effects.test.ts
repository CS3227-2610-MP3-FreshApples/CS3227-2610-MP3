import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createAdminReportService } from "../../../src/server/services/moderation/admin-reports";
import type { AdminReportDecisionInput } from "../../../src/server/services/moderation/admin-report-decision-input";
import type { Principal } from "../../../src/server/services/identity";
import type { AccountId, MovieId, ReportId, RequestId, ReviewId, RowVersion, SessionId, Tx } from "../../../src/server/shared";

const admin: Principal = { accountId: "00000000-0000-4000-8000-000000000001" as AccountId, sessionId: "session" as SessionId, role: "ADMIN" };
const reportId = "00000000-0000-4000-8000-000000000002" as ReportId;
const targetId = "00000000-0000-4000-8000-000000000003" as AccountId;
const movieId = "00000000-0000-4000-8000-000000000004" as MovieId;
const reviewId = "00000000-0000-4000-8000-000000000005" as ReviewId;
const input: AdminReportDecisionInput = { disposition: "accepted", actions: ["hide_review"], reason: "A valid acceptance reason." };

describe("A-05 atomic report acceptance effects", () => {
  it("locks Account → Movie → Review → Report, adds one strike, hides through K8, suspends at threshold, and audits atomically", async () => {
    const order: string[] = [];
    const tx = {} as Tx;
    const account = { accountId: targetId, status: "active", version: 1 as RowVersion, strikeCycle: 0 } as never;
    const movie = { movieId, archived: false, reviewsRevision: 1 } as never;
    const review = { reviewId, movie, version: 4 as RowVersion, contentRevision: 1, moderationState: "cleared", hidden: false, deleted: false } as never;
    const deps = {
      database: { withTransaction: async (work: (tx: Tx) => Promise<unknown>) => work(tx), withTransactionResult: async (work: (tx: Tx) => Promise<unknown>) => work(tx) },
      mutations: {
        findDecisionTarget: vi.fn(async () => { order.push("target"); return { reportId, targetUserId: targetId, reviewId, movieId, version: 1 as RowVersion }; }),
        lockDecision: vi.fn(async () => { order.push("report"); return { reportId, targetUserId: targetId, reviewId, movieId, version: 1 as RowVersion, status: "open" }; }),
        countCurrentCycleStrikes: vi.fn(async () => 2),
        insertDecision: vi.fn(async () => "00000000-0000-4000-8000-000000000006"),
        insertStrike: vi.fn(async () => true),
        close: vi.fn(async () => 2 as RowVersion),
      },
      reports: {
        get: vi.fn(async () => ({ id: reportId, status: "accepted" } as never)),
      },
      accounts: { lockUserAccount: vi.fn(async () => { order.push("account"); return { ok: true, value: account }; }) },
      movieLocks: { lockMovieForUpdate: vi.fn(async () => { order.push("movie"); return { ok: true, value: movie }; }) },
      reviewLocks: { lockReviewForTransition: vi.fn(async () => { order.push("review"); return { ok: true, value: review }; }) },
      transitions: { hideReviewForAcceptedReport: vi.fn(async () => ({ reviewId, version: 5 as RowVersion, moderationState: "cleared", hidden: true, deleted: false, eligibilityChanged: true })) },
      work: { cancelOutstanding: vi.fn(async () => undefined) },
      accountStatus: { lockUserAccount: vi.fn(async () => { order.push("account"); return { ok: true, value: account }; }), suspend: vi.fn(async () => ({ accountId: targetId, before: "active", after: "suspended", version: 2 as RowVersion, strikeCycle: 0, changed: true })) },
      auditLog: { record: vi.fn(async () => undefined) },
      strikeThreshold: 3,
    };
    const service = createAdminReportService(deps as never);

    const result = await service.decide(admin, reportId, 1 as RowVersion, input, "00000000-0000-4000-8000-000000000007" as RequestId);

    expect(result).toEqual({ ok: true, value: expect.objectContaining({ strikeAdded: true, accountStatus: "suspended", version: 2 }) });
    expect(order).toEqual(["target", "account", "movie", "review", "report"]);
    expect(deps.mutations.insertStrike).toHaveBeenCalledWith(tx, expect.objectContaining({ targetUserId: targetId, reviewId, strikeCycle: 0 }));
    expect(deps.transitions.hideReviewForAcceptedReport).toHaveBeenCalledWith(tx, review);
    expect(deps.work.cancelOutstanding).toHaveBeenCalledWith(tx, reviewId);
    expect(deps.accountStatus.suspend).toHaveBeenCalledWith(tx, account);
    expect(deps.auditLog.record).toHaveBeenCalledWith(tx, expect.objectContaining({ action: "report.accept", targetId: reportId }));
  });

  it("dismisses with only the Report lock and does not acquire effect locks", async () => {
    const order: string[] = [];
    const tx = {} as Tx;
    const dismissal: AdminReportDecisionInput = { disposition: "dismissed", actions: [], reason: "A valid dismissal reason." };
    const deps = {
      database: { withTransaction: async (work: (tx: Tx) => Promise<unknown>) => work(tx), withTransactionResult: async (work: (tx: Tx) => Promise<unknown>) => work(tx) },
      mutations: {
        findDecisionTarget: vi.fn(async () => { order.push("target"); return { reportId, targetUserId: targetId, reviewId, movieId, version: 1 as RowVersion }; }),
        lockDecision: vi.fn(async () => { order.push("report"); return { reportId, targetUserId: targetId, reviewId, movieId, version: 1 as RowVersion, status: "open", targetStatus: "active" }; }),
        insertDecision: vi.fn(async () => "00000000-0000-4000-8000-000000000008"),
        close: vi.fn(async () => 2 as RowVersion),
      },
      reports: { get: vi.fn(async () => ({ id: reportId, status: "dismissed" } as never)) },
      accountStatus: { lockUserAccount: vi.fn(), suspend: vi.fn() },
      movieLocks: { lockMovieForUpdate: vi.fn() },
      reviewLocks: { lockReviewForTransition: vi.fn() },
      transitions: { hideReviewForAcceptedReport: vi.fn() },
      work: { cancelOutstanding: vi.fn() },
      auditLog: { record: vi.fn(async () => undefined) },
    };
    const service = createAdminReportService(deps as never);

    const result = await service.decide(admin, reportId, 1 as RowVersion, dismissal, "00000000-0000-4000-8000-000000000009" as RequestId);

    expect(result).toEqual({ ok: true, value: expect.objectContaining({ strikeAdded: false, accountStatus: "active", version: 2 }) });
    expect(order).toEqual(["target", "report"]);
    expect(deps.accountStatus.lockUserAccount).not.toHaveBeenCalled();
    expect(deps.movieLocks.lockMovieForUpdate).not.toHaveBeenCalled();
    expect(deps.reviewLocks.lockReviewForTransition).not.toHaveBeenCalled();
  });
});
