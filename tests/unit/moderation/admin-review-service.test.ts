import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { createAdminReviewService, type AdminReviewDependencies } from "../../../src/server/services/moderation/admin-reviews";
import type { Principal } from "../../../src/server/services/identity";
import type { RequestId, ReviewId, RowVersion } from "../../../src/server/shared";

describe("A-04 service authorization", () => {
  it("rejects USER directly, before any repository or transaction access", async () => {
    const denied = vi.fn(() => { throw new Error("dependency must not be called"); });
    const deps = {
      database: { withTransaction: denied, withTransactionResult: denied, probe: denied },
      queries: { list: denied, count: denied, get: denied },
      reviewLocks: { lockReviewForTransition: denied },
      transitions: { approveHeldReview: denied, hideReview: denied, restoreHiddenReview: denied },
      work: { supersedeOutstanding: denied, cancelOutstanding: denied, reactivate: denied },
      auditLog: { record: denied },
    } satisfies AdminReviewDependencies;
    const service = createAdminReviewService(deps);
    const user = { role: "USER", accountId: "synthetic", sessionId: "synthetic" } as Principal;
    const id = "10000000-0000-4000-8000-000000000001" as ReviewId;
    expect(await service.list(user, { movieId: null, assessment: "all" }, 1, 20)).toEqual({ ok: false, error: { kind: "forbidden" } });
    expect(await service.get(user, id)).toEqual({ ok: false, error: { kind: "forbidden" } });
    for (const operation of [service.approve, service.hide, service.restore]) {
      expect(await operation(user, id, 1 as RowVersion, { reason: "Human review reason." }, id as unknown as RequestId)).toEqual({ ok: false, error: { kind: "forbidden" } });
    }
    expect(denied).not.toHaveBeenCalled();
  });
});
