# Cross-boundary contracts K1–K12

Status: **approved by both developers on 12 October 2026 (S-00).** Drafted by the architect agent; OPEN and Proposed items resolved in §16 (D-24). The K10 budget amendment (D-25, microdollars) was approved by both developers on 12 October 2026. Changes now require a contract PR approved by both developers ([COMMIT-PLAN.md §2](COMMIT-PLAN.md)).

Source revision: `9f77b53` (`master`, PR #5), which includes S-00 and S-01. The S-01 amendments in §17 (D-36) were written against `682c010`, and the S-03 amendment in §18 (D-38) against `9f77b53`. **They are approved by Developer B and still need approval from Developer A.**

- `spec/` is authoritative. If this file and `spec/` disagree, `spec/` wins and the conflict goes to a human (`AGENTS.md`).
- Owners and purposes come from [PLAN.md §5](PLAN.md). This file adds signatures, outcomes, locks, transaction rules and fakes.
- Signatures are TypeScript interface sketches for server-only modules under `src/server` (K12 lives under `src/components`). They are not implementation. Identifiers may be renamed in review. Semantics change only through a contract PR approved by both developers ([COMMIT-PLAN.md §2](COMMIT-PLAN.md)).
- **Resolved (O-xx):** marks a former open question; its outcome is in §16 and, where it changes behaviour, in `spec/`. **Approved (P-xx):** marks an adopted architect proposal. The surrounding text describes the original question; §16 is authoritative.

---

## 1. Conventions for every contract

1. **Pass ids, not records.** Lock handles (§2.3) are the only exception. A handle proves that a lock is held and carries only the fields the next step needs.
2. **No control flags.** No boolean or mode argument selects a branch in the callee. Each branch is its own named function.
3. **Results for expected outcomes.** Domain outcomes return `Result`. Only infrastructure faults (database unreachable, programming error) throw, and K2 `runRoute` turns a throw into a safe generic error. The one typed throw is K1's `TransactionConflict` (§2.4, D-36), which `runRoute` maps to 409 `conflict`.
4. **Ready-to-use constructors.** Use `createX(deps)` with dependencies injected as the narrow interfaces below. There is no `init()`/`start()`. Vendor types (`pg`, provider responses) never cross a contract.
5. **No module-level mutable state.** See O-03 for the composition root.
6. **Fakes fail closed.** A fake never authorizes, clears a Review, admits a rate-limited request or changes an account unless a test scripts it to. Fakes live in `tests/support/fakes/`. The one exception is the K10 deterministic provider fake, which local, dev and E2E runs need (D-16). It lives in `src/server/adapters/soc-llm/`, and production must not be able to select it (O-28).
7. **Contract tests.** The provider merges the interface, the fake and a contract test suite first (COMMIT-PLAN §2 rule 1). The same suite runs against the fake and the real implementation.
8. **Never open a transaction while holding one.** The pool has one connection per instance (tech-stack "Database driver"). Any function documented as **own Tx** must be called with no transaction open in the same request, or the request deadlocks on its own connection.

---

## 2. Shared types

Defined once in `src/server/shared/` (**Resolved (see §16):** exact path, O-34) and imported by all contracts. They contain no credentials or ORM-private fields (architecture 6.6).

### 2.1 Identifiers, versions, results

```ts
declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

// Opaque UUIDs (data-model §7). Parse untrusted input only through K2.
export type AccountId = Brand<string, "AccountId">;
export type SessionId = Brand<string, "SessionId">;
export type MovieId   = Brand<string, "MovieId">;
export type ReviewId  = Brand<string, "ReviewId">;
export type ReportId  = Brand<string, "ReportId">;
export type AiJobId   = Brand<string, "AiJobId">;
export type RequestId = Brand<string, "RequestId">;

export type RowVersion      = Brand<number, "RowVersion">;      // integer `version`
export type ContentRevision = Brand<number, "ContentRevision">; // Review.content_revision
export type ReviewsRevision = Brand<number, "ReviewsRevision">; // Movie.reviews_revision

export type Result<T, E> =
  | { readonly ok: true;  readonly value: T }
  | { readonly ok: false; readonly error: E };

export type AccountRole     = "USER" | "ADMIN";
export type AccountStatus   = "active" | "suspended";
export type ModerationState = "pending" | "flagged" | "cleared";
export type ReportCategory  = "profanity" | "harassment" | "hate" | "spam" | "other";
export type ReportStatus    = "open" | "dismissed" | "accepted";
```

Timestamps are `Date` values in UTC inside the server. K2 serializes them as ISO 8601 UTC strings.

### 2.2 Domain errors and the api.md §8.1 mapping

```ts
export type FieldErrors = Readonly<Record<string, readonly string[]>>;

export type DomainError =
  | { readonly kind: "malformed" }                                   // 400
  | { readonly kind: "payload_too_large" }                           // 413
  | { readonly kind: "unsupported_media_type" }                      // 415
  | { readonly kind: "unauthenticated" }                             // 401
  | { readonly kind: "forbidden" }                                   // 403
  | { readonly kind: "csrf_failed" }                                 // 403
  | { readonly kind: "not_found" }                                   // 404 (missing or ownership-protected)
  | { readonly kind: "conflict" }                                    // 409
  | { readonly kind: "stale_version" }                               // 409
  | { readonly kind: "invalid_fields"; readonly fieldErrors: FieldErrors } // 422
  | { readonly kind: "precondition_required" }                       // 428 (If-Match absent)
  | { readonly kind: "rate_limited"; readonly retryAfterSeconds: number }  // 429 + Retry-After
  | { readonly kind: "unavailable" };                                // 503
```

- **Resolved (O-05):** the wire `error.code` strings. api.md defines the envelope but not the code values.
- **Resolved (O-12):** api.md §8.1 lists 422 for "insufficient reviews", but `GET /movies/:id/summary` returns 200 with `status: insufficient_reviews`. No `DomainError` kind is defined for it until a human resolves this.

### 2.3 Transaction and lock handles

```ts
export type Tx = { readonly [brand]: "Tx" }; // opaque; produced only by K1

declare const held: unique symbol;
export interface AccountShareLock  { readonly accountId: AccountId; readonly [held]: "AccountShare" }
export interface AccountUpdateLock {
  readonly accountId: AccountId; readonly status: AccountStatus;
  readonly version: RowVersion;  readonly strikeCycle: number; readonly [held]: "AccountUpdate";
}
export interface MovieShareLock  { readonly movieId: MovieId; readonly [held]: "MovieShare" }
export interface MovieUpdateLock {
  readonly movieId: MovieId; readonly archived: boolean;
  readonly reviewsRevision: ReviewsRevision; readonly [held]: "MovieUpdate";
}
export interface ReviewUpdateLock {
  readonly reviewId: ReviewId; readonly movie: MovieUpdateLock;
  readonly version: RowVersion; readonly contentRevision: ContentRevision;
  readonly moderationState: ModerationState; readonly hidden: boolean; readonly deleted: boolean;
  readonly [held]: "ReviewUpdate";
}
```

Only the owning module constructs a handle. A handle is valid only inside the `Tx` that produced it. It is never stored, returned from a transaction, or passed to another transaction. Its field values are the state at lock time, so after a transition, use the values that transition returns.

**Approved (P-09):** functions that require a held lock take the handle instead of a raw id. A `ReviewUpdateLock` can only be obtained with a `MovieUpdateLock` inside it, so the type system enforces Movie before Review.

### 2.4 Transaction conflict (D-36, amendment §17)

```ts
/** Thrown by K1 when PostgreSQL reports a deadlock (40P01) or serialization failure (40001).
 *  Carries no driver types or messages. Never retried automatically. */
export class TransactionConflict extends Error { readonly kind = "transaction_conflict" as const }
```

---

## 3. Global lock order (D-20)

### 3.1 Rules (verbatim intent of data-model.md "Lock order (D-20)")

1. A transaction that locks more than one of these rows locks them in the order **Account → Movie → Review → Report**. Rows of any other table are locked **after** these.
2. When a transaction must read a row to learn which rows to lock, it **reads that row without a lock first**, then locks in order and **re-verifies versions** (and the relationships it read) before writing.
3. **RateLimitWindow** and **AI-budget rows** (AIBudgetDay, AIBudgetReservation) are updated in **their own short transactions** (data-model.md wording; P-04).
4. **No transaction is open during an LLM network call** (architecture 6.5, AI-03).
5. **Resolved (O-04):** order when one transaction locks several rows of the same table (Movie archive locks many Reviews). **Approved:** ascending `id`.

### 3.2 Positions and the only contracts that acquire them

| Pos | Row | Mode | Acquired only through | Owner |
| --- | --- | --- | --- | --- |
| 1 | Account (acting User) | `FOR SHARE` | K3 `lockActiveUserShared` | A (Identity) |
| 1 | Account (status target) | `FOR UPDATE` | K4 `lockUserAccount`, `lockUserAccountAtVersion` | A (Identity) |
| 2 | Movie | `FOR SHARE` | K7 `lockActiveMovieShared` | B (Catalogue) |
| 2 | Movie | `FOR UPDATE` | K7 `lockActiveMovieForUpdate`, `lockMovieForUpdate`; Catalogue-internal archive/restore | B (Catalogue) |
| 3 | Review | `FOR UPDATE` / `FOR SHARE` | K8 `lockReviewForTransition`, `lockReviewsOfMovie`; Reviews-internal write and report-submission paths | A (Reviews) |
| 4 | Report | `FOR UPDATE` | Moderation-internal decision path | B (Moderation) |
| 5 | Other tables (Session, ModerationDecision, ModerationStrike, ModerationWork, ReviewModeration, ReviewSummary, AuditEntry, AIJob) | as needed | K4 (Session), K5, K9, K10, module internals | various |
| own Tx | RateLimitWindow | upsert | K6 | B |
| own Tx | SchedulerLease, AIBudgetDay, AIBudgetReservation, AIJob creation/reconciliation | as needed | K10 | B |

- **Approved (P-08):** in a K10 publish transaction, verifying the AIJob lease is always the **last** lock.
- **Approved (P-13):** K10's own short transactions lock SchedulerLease(`ai_execution`) → AIBudgetDay → AIBudgetReservation → AIJob.
- **Approved (P-03):** the acting Admin's Account is **not** locked. The K3 guard rechecks it at request start, and no API changes ADMIN status (FR-06).

### 3.3 Per-operation lock sequences

Each step names the contract that performs it. "Unlocked read" is rule 2.

**Review write (create, resubmit, body or rating edit, delete), U-02, A**

1. K3 `requireActiveUserMutation` (reads only, no Tx).
2. K6 `consume` on the review-mutation limit (**own Tx**).
3. Tx begins. For PATCH or DELETE, an unlocked read of Review gives `movie_id`.
4. K3 `lockActiveUserShared(author)` (Account, `FOR SHARE`).
5. K7 `lockActiveMovieForUpdate` (Movie, `FOR UPDATE`). **Approved (P-02):** always `FOR UPDATE`, so the lock never upgrades from share to update when `markReviewsChanged` is needed.
6. Review `FOR UPDATE`, or insert under the unique `(movie_id, author_id)`. Re-verify ownership and If-Match.
7. Write the Review.
8. K9 `enqueue` on create, resubmit or body edit, or K9 `cancelForDeletedReview` on delete (ModerationWork).
9. K7 `markReviewsChanged`, only if public eligibility changed.
10. Commit.
11. After commit, K9 `attemptAfterCommit` (no Tx held; K10 uses its own short transactions).
12. Unlocked read of the Review for the response.

**Report submission, U-03, A**

1. K6 `consume` on the report limit (**own Tx**).
2. Unlocked read of Review gives `movie_id` and `author_id`.
3. Tx: K3 `lockActiveUserShared(reporter)` → K7 `lockActiveMovieShared` → Review `FOR SHARE`.
4. Re-verify: not deleted, visible, author ≠ reporter.
5. Insert the Report with its K11 snapshot. The partial unique index covers open reports.
6. Commit.

**Report acceptance, A-05, B**

1. Unlocked read of Report gives `target_user_id` and `review_id`. Unlocked read of Review gives `movie_id`.
2. Tx: K4 `lockUserAccount(target)` (Account, `FOR UPDATE`).
3. K8 `lockReviewForTransition` (Movie `FOR UPDATE`, then Review `FOR UPDATE`).
4. Report `FOR UPDATE`. Re-verify If-Match, `status = open` and the review/target ids.
5. Insert ModerationDecision.
6. Insert ModerationStrike with `strike_cycle = lock.strikeCycle`, using the unique `(target, review)` conflict as no-op.
7. Optional: K8 `hideReviewForAcceptedReport`, then cancel ModerationWork (B-internal).
8. Count strikes in the current cycle. At or above `REPORT_SUSPENSION_THRESHOLD`, call K4 `suspend` (Account write plus Session deletes).
9. K5 `record`.
10. Commit.

**Approved (P-07):** report dismissal locks only the Report.

**Manual suspend or reinstate, A-06, B**

1. Tx: K4 `lockUserAccountAtVersion(target, ifMatch)` (Account, `FOR UPDATE`).
2. K4 `suspend` or `reinstate` (Account write; Session deletes on suspend).
3. K5 `record`.
4. Commit.

This serializes with report acceptance on the Account lock (AT-25).

**Movie archive or restore, A-01, B**

1. Tx: Movie `FOR UPDATE` (Catalogue-internal, If-Match).
2. K8 `lockReviewsOfMovie` (Reviews `FOR UPDATE`, O-04 order).
3. Set or clear `archived_at`.
4. `markReviewsChanged` (Catalogue-internal).
5. K5 `record`.
6. Commit.

**Review approve, hide or restore, A-04, B**

1. Tx: K8 `lockReviewForTransition` (Movie `FOR UPDATE`, then Review `FOR UPDATE`).
2. K8 `approveHeldReview`, `hideReview` or `restoreHiddenReview` with If-Match. This calls `markReviewsChanged` internally when eligibility changes.
3. ModerationWork: supersede on approve, cancel on hide, reactivate on restore when still pending (B-internal).
4. K5 `record`.
5. Commit.

**Automatic clearance or flag, A-03, B, via K10**

1. Before dispatch, K10 runs **own short Tx** steps (lease, budget, AIJob). The provider call runs with **no Tx**.
2. Publish Tx (K10 `publish` callback): K8 `lockReviewForTransition` → K8 `applyAutomaticClearance` or `applyAutomaticFlag` (guarded by captured revision and version) → insert ReviewModeration, update ModerationWork → K5 `record` with a null actor.
3. The controller then locks the AIJob and verifies the lease. If the lease is lost, the transaction rolls back.
4. Afterwards, K10 runs an **own short Tx** to reconcile the budget and release `ai_execution`.

**Summary publication, U-04, A, via K10**

1. Publish Tx: K7 `lockActiveMovieForUpdate` → compare the captured `reviews_revision` → insert ReviewSummary → K7 `recordSummaryPublished`.
2. The controller then locks the AIJob and verifies the lease, last.

---

## 4. K1 — Transaction helper and `Tx`

**Provider → consumer:** B → A. **Spec basis:** architecture 6.4, 6.5; tech-stack "Database driver"; D-07, D-10, D-20.

```ts
// src/server/db/
export interface Database {
  /** Commits if `work` resolves; rolls back and rethrows if it throws. */
  withTransaction<T>(work: (tx: Tx) => Promise<T>): Promise<T>;
  /** Commits if `work` returns ok; rolls back if it returns an error Result or throws. */
  withTransactionResult<T, E>(work: (tx: Tx) => Promise<Result<T, E>>): Promise<Result<T, E>>;
  /** Readiness only (D-36): read-only query; resolves within 2 s including connection acquisition, else throws. */
  probe(): Promise<void>;
}
export type SqlParam = string | number | boolean | null | Date | readonly string[] | readonly number[];
export interface Sql {
  /** Unnamed parameterized query ($1, $2, …). Never sets a query `name`. Repositories only. */
  query<Row>(tx: Tx, text: string, params: readonly SqlParam[]): Promise<readonly Row[]>;
}
export function createDatabase(config: DatabaseConfig): Database & Sql; // ready to use
```

- **Outcomes:**
  - Infrastructure failures throw, and K2 maps them to a safe error.
  - A `Tx` used after commit or rollback throws.
  - Deadlock (40P01) and serialization (40001) failures roll back and throw `TransactionConflict` (§2.4), which K2 maps to 409 `conflict` (D-36).
  - `bigint` columns are returned as numbers; a value above `Number.MAX_SAFE_INTEGER` throws (tech-stack "Database driver").
- **Locks:** none of its own.
- **Transaction rule:**
  - Services receive `Database`. Repositories receive `Sql` and accept a `Tx` on every call.
  - Session state is limited to `SET LOCAL`.
  - **Approved (P-05):** calling `withTransaction` inside an active transaction throws immediately. With a one-connection pool, nesting would otherwise deadlock.
  - **Resolved (O-01):** isolation level, and whether deadlock or serialization failures are retried or mapped to `conflict`. **Approved:** PostgreSQL's default READ COMMITTED plus the explicit row locks in §3.
  - **Resolved (O-02):** `statement_timeout` and the pool connection-acquire timeout values.
- **Fake:** none. Anything that takes a `Tx` is integration-tested against disposable PostgreSQL (D-10). Consumers unit-test logic with fakes of their own repositories.

## 5. K2 — API kernel

**Provider → consumer:** A → B. **Spec basis:** api.md §8.1; SEC-05; security.md (32 KiB body limit, content types).

```ts
// src/server/http/
export type Validator<T> = (input: unknown) => Result<T, FieldErrors>; // strict: unknown fields are errors
export interface PageRequest { readonly page: number; readonly pageSize: number } // default 20, cap 100

export function runRoute(
  handler: (request: Request, requestId: RequestId) => Promise<Response>,
): (request: Request) => Promise<Response>; // catches throws → safe envelope; no stack traces; TransactionConflict → 409 conflict (D-36)
export function readJsonBody<T>(request: Request, validate: Validator<T>): Promise<Result<T, DomainError>>;
export function readPageRequest(url: URL): Result<PageRequest, DomainError>;
export function readIfMatch(request: Request): Result<RowVersion, DomainError>; // absent → precondition_required
export function parseId<B extends string>(raw: string): Result<Brand<string, B>, DomainError>;
export function trimmedCodePointLength(text: string): number;

export function errorResponse(error: DomainError, requestId: RequestId): Response;
export function jsonResponse(status: 200 | 201 | 202, body: unknown): Response;
export function versionedJsonResponse(status: 200 | 201, body: unknown, version: RowVersion): Response; // sets ETag
export function listResponse<T>(page: PageRequest, items: readonly T[], total: number): Response;
export function noContentResponse(): Response; // 204
```

- **Outcomes:** the §2.2 mapping. Every response carries `Cache-Control: no-store` (**Approved, P-06**, until caching has invalidation tests). Error bodies are `{ error: { code, message, fieldErrors?, requestId } }`.
- **Request identity:** `runRoute` generates one server-side `RequestId`, passes it to the handler, and decorates the returned response with `X-Request-Id` before returning it. `errorResponse` uses the same ID in both the response header and `error.requestId`. Response helpers do not accept a request-ID parameter, so successful responses cannot omit the header when returned through `runRoute`.
- **Resolved (see §16):**
  - O-06: status for unknown mutation fields (400 or 422), oversize bodies (413 is not in api.md), unsupported content types (415 is not in api.md), and unexpected faults (500 is not in api.md).
  - O-07: If-Match and ETag value format.
  - O-08: out-of-range `page`/`pageSize`, clamp or reject.
  - O-09: malformed path UUID, 400 or 404.
  - O-10: request-ID response header name, and whether inbound IDs are accepted. **Approved:** always generate server-side.
  - O-11: no validation library is recorded, so `Validator` is in-repo.
  - Confirm the Route Handler signature against `node_modules/next/dist/docs/` before implementation.
- **Locks / Tx:** none. `src/server/http/` imports no repository or adapter.
- **Fake:** none. The functions are pure and unit-tested.

## 6. K3 — Auth guards and in-transaction status recheck

**Provider → consumer:** A → B. **Spec basis:** FR-01, INV-01, SEC-01, SEC-03, SEC-04, D-11, D-14; AT-01.

```ts
// src/server/services/identity/
export interface Principal { readonly accountId: AccountId; readonly sessionId: SessionId; readonly role: AccountRole }
export type AuthFailure =
  | { readonly kind: "unauthenticated" } | { readonly kind: "forbidden" } | { readonly kind: "csrf_failed" };

export interface AuthGuards {
  // Safe methods: valid unexpired session, account active, role matches.
  requireActiveUser(request: Request): Promise<Result<Principal, AuthFailure>>;
  requireActiveAdmin(request: Request): Promise<Result<Principal, AuthFailure>>;
  // Unsafe methods: the above plus Origin === PUBLIC_APP_URL and a session-bound CSRF token (D-14).
  requireActiveUserMutation(request: Request): Promise<Result<Principal, AuthFailure>>;
  requireActiveAdminMutation(request: Request): Promise<Result<Principal, AuthFailure>>;
  // Cron routes: Authorization: Bearer <CRON_SECRET>, constant-time compare; 401 otherwise, even with an Admin session (O-14).
  requireCronCaller(request: Request): Result<void, { readonly kind: "unauthenticated" }>;
}
export interface ActingAccountLocks {
  /** Account FOR SHARE (pos 1); fails if not an active USER. Used by review writes and report submission. */
  lockActiveUserShared(tx: Tx, accountId: AccountId): Promise<Result<AccountShareLock, { readonly kind: "forbidden" }>>;
}
```

- **Outcomes:**
  - No session, or an expired or revoked one → `unauthenticated` (401).
  - Wrong role, or a suspended account → `forbidden` (403).
  - Guards run on every request and re-read account status, with no caching (security.md).
- **Resolved (see §16):**
  - O-13: CSRF header and cookie names, how the client obtains the token (api.md lists no endpoint), and the status for a CSRF or Origin failure.
  - O-14: the `Authorization: Bearer <CRON_SECRET>` check is needed by both U-04 (A) and A-03 (B), but no contract owns it.
  - O-15: the client-IP source header on Vercel (verify before release, per security.md).
- **Locks / Tx:** guards run outside any Tx and take no locks. `lockActiveUserShared` runs inside the caller's Tx at position 1. **Approved (P-11):** cross-boundary session revocation is exposed only through K4 `suspend`, so B never revokes sessions directly.
- **Fake:** returns `unauthenticated` unless a test supplies a principal. It is never importable from `src/`.

## 7. K4 — Account-status transition (Identity-owned, D-20)

**Provider → consumer:** A → B. **Spec basis:** FR-06, D-20, security.md "User management and health access", api.md §8.4 (manual status changes); AT-05, AT-16, AT-22, AT-25.

```ts
// src/server/services/identity/account-status/
export type AccountLockFailure = { readonly kind: "not_found" } | { readonly kind: "not_user_target" };
export interface AccountStatusChange {
  readonly accountId: AccountId; readonly before: AccountStatus; readonly after: AccountStatus;
  readonly version: RowVersion; readonly strikeCycle: number; readonly changed: boolean;
}
export interface AccountStatusService {
  /** Account FOR UPDATE (pos 1). Report-triggered path; no client version. */
  lockUserAccount(tx: Tx, accountId: AccountId): Promise<Result<AccountUpdateLock, AccountLockFailure>>;
  /** Account FOR UPDATE (pos 1) plus an optimistic check against If-Match. Manual path. */
  lockUserAccountAtVersion(tx: Tx, accountId: AccountId, expected: RowVersion):
    Promise<Result<AccountUpdateLock, AccountLockFailure | { readonly kind: "stale_version" }>>;
  /** active → suspended: version+1, delete all Sessions. Already suspended → changed=false. */
  suspend(tx: Tx, account: AccountUpdateLock): Promise<AccountStatusChange>;
  /** suspended → active: version+1, strike_cycle+1, no sessions restored. Already active → changed=false. */
  reinstate(tx: Tx, account: AccountUpdateLock): Promise<AccountStatusChange>;
}
```

- **Outcomes:**
  - A same-status request is a no-op and never advances `strike_cycle`.
  - `stale_version` maps to 409.
  - ADMIN targets give `not_user_target`. **Resolved (O-16):** its HTTP status; api.md says only "rejected".
- **Locks / Tx:**
  - Runs inside the caller's Tx and acquires Account first (pos 1). The caller must hold no Movie, Review or Report lock yet.
  - Session deletes are later-table writes.
  - **Approved (P-01):** K4 does not audit. The caller records one K5 entry in the same Tx, with the reason and the before/after.
- **Fake (B's stub before A lands):** both lock functions return `not_found`, so the caller rolls back and no status ever changes.

## 8. K5 — Audit

**Provider → consumer:** B → A. **Spec basis:** security.md audit paragraph; SEC-10; FR-05 (actor and time).

```ts
// src/server/services/audit/
export interface AuditEntryInput {
  readonly actorId: AccountId | null;   // null = system (automatic clearance, scheduler)
  readonly action: AuditAction;
  readonly targetType: AuditTargetType;
  readonly targetId: string;            // UUID of the target
  readonly result: AuditResult;
  readonly metadata: Readonly<Record<string, string | number | boolean | null>>; // minimal before/after, admin reason
  readonly requestId: RequestId;
}
export type AuditResult = "applied" | "no_op";
export type AuditTargetType = "account" | "movie" | "review" | "report" | "announcement";
export type AuditAction =
  | "account.suspend" | "account.reinstate" | "account.admin_provisioned"
  | "movie.create" | "movie.update" | "movie.archive" | "movie.restore"
  | "review.approve" | "review.hide" | "review.restore" | "review.auto_clear" | "review.auto_flag"
  | "report.accept" | "report.dismiss"
  | "announcement.create" | "announcement.update" | "announcement.publish" | "announcement.unpublish" | "announcement.delete";
// Adding a value is a contract PR (COMMIT-PLAN §2).
export interface AuditLog { record(tx: Tx, entry: AuditEntryInput): Promise<void> } // insert-only; no update/delete API
```

- **Outcomes:** a failed insert throws, so the whole mutation rolls back. Metadata must never contain passwords, session tokens, report explanations or snapshots, review bodies, or provider prompts or responses.
- **Resolved (O-17):** the action, target-type and result vocabularies, and whether denied or failed attempts are audited. Auditing them would need an own-Tx variant, because the caller's Tx rolls back.
- **Locks / Tx:** inside the caller's Tx, as a later-table insert.
- **Fake:** an in-memory recorder that tests assert against. It never silently drops entries.

## 9. K6 — Shared rate limiter

**Provider → consumer:** B → A. **Spec basis:** SEC-06, SEC-11, D-12, D-13; security.md (10 review mutations per minute, 5 reports per hour, 5 login failures per 15 minutes).

```ts
// src/server/services/rate-limit/
export type RateLimitKey = Brand<string, "RateLimitKey">;
export type RateLimitName =
  | "login_failure_email" | "login_failure_ip" | "review_mutation" | "report_create" | "soc_requests" | "soc_tokens";
export interface RateLimitPolicy { readonly limit: number; readonly windowSeconds: number }
export type RateLimitOutcome =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly retryAfterSeconds: number }; // computed from window end

export interface RateLimiter {
  /** Atomic upsert-increment of RateLimitWindow by `units` (tokens for SoC TPM, otherwise 1). */
  consume(key: RateLimitKey, policy: RateLimitPolicy, units: number): Promise<RateLimitOutcome>;
  /** Read-only check (e.g. login before verifying a password). */
  check(key: RateLimitKey, policy: RateLimitPolicy): Promise<RateLimitOutcome>;
}
export interface RateLimitKeys {
  forAccount(limit: RateLimitName, accountId: AccountId): RateLimitKey;
  forEmail(limit: RateLimitName, normalizedEmail: string): RateLimitKey; // HMAC(RATE_LIMIT_KEY_SECRET)
  forClientIp(limit: RateLimitName, ip: string): RateLimitKey;           // HMAC(RATE_LIMIT_KEY_SECRET)
  forEnvironment(limit: RateLimitName): RateLimitKey;                    // SoC per-minute quotas
}
```

- **Outcomes:** `allowed: false` maps to `rate_limited` (429 with Retry-After). **Approved (P-10):** a database failure throws and maps to 503, so the limiter fails closed. Windows are computed from the database clock.
- **Resolved (O-18):**
  - Whether a rejected `consume` still increments.
  - Whether a successful login clears failure counts.
  - The `RateLimitName` values. **Approved:** `login_failure_email`, `login_failure_ip`, `review_mutation`, `report_create`, `soc_requests`, `soc_tokens`.
- **Locks / Tx:** **own short Tx**. It must be called with no Tx open (§1 rule 8).
- **Fake:** an unscripted key returns `{ allowed: false, retryAfterSeconds: 60 }`.

## 10. K7 — Catalogue: Movie locks and review-change marker

**Provider → consumer:** B → A. **Spec basis:** INV-05, INV-09, FR-05; data-model revision paragraph; AI-01 (scheduling state).

```ts
// src/server/services/catalogue/ (core; see P-12)
export type MovieUnavailable = { readonly kind: "not_found" } | { readonly kind: "archived" };
export interface MovieLocks {
  lockActiveMovieForUpdate(tx: Tx, movieId: MovieId): Promise<Result<MovieUpdateLock, MovieUnavailable>>; // review writes, summary publish
  lockActiveMovieShared(tx: Tx, movieId: MovieId): Promise<Result<MovieShareLock, MovieUnavailable>>;     // report submission
  lockMovieForUpdate(tx: Tx, movieId: MovieId): Promise<Result<MovieUpdateLock, { readonly kind: "not_found" }>>; // any archive state; used by K8
}
export interface ReviewsChangedMarker {
  /** reviews_revision+1; summary_pending_since = coalesce(existing, now()). Returns the new revision. */
  markReviewsChanged(tx: Tx, movie: MovieUpdateLock): Promise<ReviewsRevision>;
}
// Summary-schedule additions (O-20, approved): U-04 needs writes to Movie summary_* columns.
export interface SummarySchedule {
  recordSummaryAttempt(tx: Tx, movie: MovieUpdateLock, nextAttemptAt: Date): Promise<void>;
  /** Clears pending and sets summary_last_success_at only if reviews_revision === published. */
  recordSummaryPublished(tx: Tx, movie: MovieUpdateLock, published: ReviewsRevision):
    Promise<Result<void, { readonly kind: "stale" }>>;
}
```

- **Outcomes:** **Resolved (O-19):** the HTTP status for a User mutation on an archived Movie (404 like public reads, or 409).
- **Rules:**
  - Call `markReviewsChanged` only when public eligibility actually changed. No-op mutations must not advance the revision (data-model).
  - Eligibility requires an active Movie, so outside Catalogue's own archive/restore it is never called for an archived Movie.
- **Locks / Tx:** inside the caller's Tx, Movie at position 2. The caller may already hold only Account locks.
- **Fake:** lock functions return `not_found` unless a test seeds the Movie. The marker records calls.

## 11. K8 — Review transitions and moderation reads

**Provider → consumer:** A → B. **Spec basis:** FR-03, FR-09, INV-09, AI-02, api.md §8.4 (review approval paragraph), architecture 6.4; AT-21, AT-23.

```ts
// src/server/services/reviews/
export interface ReviewLocks {
  /** Unlocked read of movie_id → K7 lockMovieForUpdate → Review FOR UPDATE → re-verify. */
  lockReviewForTransition(tx: Tx, reviewId: ReviewId): Promise<Result<ReviewUpdateLock, { readonly kind: "not_found" }>>;
  /** All Reviews of the Movie FOR UPDATE, O-04 order. For Movie archive/restore. */
  lockReviewsOfMovie(tx: Tx, movie: MovieUpdateLock): Promise<void>;
}
export interface CapturedReviewVersion { readonly contentRevision: ContentRevision; readonly version: RowVersion }
export interface ReviewTransitionResult {
  readonly reviewId: ReviewId; readonly version: RowVersion; readonly moderationState: ModerationState;
  readonly hidden: boolean; readonly deleted: boolean; readonly eligibilityChanged: boolean;
}
export type AutomaticRejection = { readonly kind: "stale" } | { readonly kind: "movie_archived" };
export type AdminRejection = { readonly kind: "stale_version" } | { readonly kind: "conflict" };

export interface ReviewTransitions {
  // Fixed clearance rule (AI-02): clean → cleared; suspected or uncertain → flagged. No actor.
  applyAutomaticClearance(tx: Tx, review: ReviewUpdateLock, captured: CapturedReviewVersion):
    Promise<Result<ReviewTransitionResult, AutomaticRejection>>;
  applyAutomaticFlag(tx: Tx, review: ReviewUpdateLock, captured: CapturedReviewVersion):
    Promise<Result<ReviewTransitionResult, AutomaticRejection>>;
  // Human Admin actions, If-Match on the Review.
  approveHeldReview(tx: Tx, review: ReviewUpdateLock, expected: RowVersion): Promise<Result<ReviewTransitionResult, AdminRejection>>;
  hideReview(tx: Tx, review: ReviewUpdateLock, expected: RowVersion): Promise<Result<ReviewTransitionResult, AdminRejection>>;
  restoreHiddenReview(tx: Tx, review: ReviewUpdateLock, expected: RowVersion): Promise<Result<ReviewTransitionResult, AdminRejection>>;
  // Report acceptance with hide_review: If-Match is on the Report, not the Review.
  hideReviewForAcceptedReport(tx: Tx, review: ReviewUpdateLock): Promise<ReviewTransitionResult>;
}
export interface ScreeningSource {
  readonly reviewId: ReviewId; readonly contentRevision: ContentRevision; readonly version: RowVersion;
  readonly body: string; // untrusted text
  readonly moderationState: ModerationState; readonly hidden: boolean; readonly deleted: boolean; readonly movieArchived: boolean;
}
export interface ReviewModerationReads {
  /** No lock; snapshot for AI-02 input and the dispatch-time captured version. */
  readReviewForScreening(tx: Tx, reviewId: ReviewId): Promise<Result<ScreeningSource, { readonly kind: "not_found" }>>;
}
```

**Automatic transitions** apply only when all of these hold:
- `moderation_state = pending`.
- `content_revision` and `version` equal the captured values.
- The Review is neither hidden nor deleted.

Otherwise they return `stale`, and on an archived Movie they return `movie_archived` (AI-02: defer until restored). They set `clearance_source = ai`, never touch `hidden_at` or `deleted_at`, and never override a human decision.

**Admin transitions:**
- Approve takes `pending` or `flagged` to `cleared` with `clearance_source = admin` and does not undo deletion.
- Hide sets `hidden_at`.
- Restore clears `hidden_at` only and never changes `moderation_state`.

**All transitions:**
- Increment `version`.
- Call K7 `markReviewsChanged` internally when eligibility changes.
- Do not touch ModerationWork. Superseding, cancelling and reactivating work is B's job (K9-internal).
- Do not audit. The caller does (P-01).

**Resolved (see §16):**
- O-21: whether Admin approve, hide and restore are allowed on Reviews of archived Movies.
- O-22: hide when already hidden, restore when not hidden, and approve when already cleared. Each could be a no-op or a 409 `conflict`.
- O-23: the read model for `GET /admin/reviews`. Its filters join Reviews (A) with ReviewModeration and ModerationWork (B). The same question applies to cross-module reads in general (`/admin/users` reading Account, U-01 reading Movie).

**Locks / Tx:** inside the caller's Tx. `lockReviewForTransition` acquires positions 2 then 3. The caller may hold an Account lock already, but no Report or later-table lock.

**Fake:** automatic transitions return `stale` and admin transitions return `stale_version` unless scripted. The fake never clears.

## 12. K9 — Moderation work dispatch

**Provider → consumer:** B → A. **Spec basis:** AI-02 "Automatic dispatch and recovery", FR-09, DEP-10; AT-21, AT-24.

```ts
// src/server/services/ai/moderation/
export interface ModerationWorkQueue {
  /** In the review-write Tx after the Review lock. Creates pending work for
   *  (review, revision, model, prompt, policy); supersedes older revisions; idempotent on the unique key. */
  enqueue(tx: Tx, reviewId: ReviewId, contentRevision: ContentRevision): Promise<void>;
  /** In the author-deletion Tx after the Review lock. Cancels outstanding work. */
  cancelForDeletedReview(tx: Tx, reviewId: ReviewId): Promise<void>;
}
export type ScreeningAttempt = "cleared" | "flagged" | "deferred" | "manual_review" | "not_current";
export interface ModerationDispatcher {
  /** After commit, no Tx open. Bounded by AI_EXECUTION_DEADLINE_MS. Never throws; any fault → "deferred". */
  attemptAfterCommit(reviewId: ReviewId, contentRevision: ContentRevision): Promise<ScreeningAttempt>;
}
```

- **Outcomes:**
  - The attempt result is informational. The review route re-reads its own Review row for `moderationState`.
  - The submission returns 201 or 200 whatever the result (api.md §8.1). Capacity deferral does not consume an execution.
- **Resolved (see §16):**
  - O-24: ModerationWork has no status for cancelling work of deleted or hidden Reviews. Its statuses are only pending, running, completed, needs_manual_review and superseded.
  - O-25: the ModerationWork unique key includes `model_id`, but `SOC_LLM_MODEL` may be absent while AI is disabled, and `enqueue` must still persist durable work.
  - O-31: the exact policy file path (D-17) and the policy text (OQ-04).
- **Locks / Tx:** `enqueue` and `cancelForDeletedReview` run inside the caller's Tx as later-table writes (ModerationWork). `attemptAfterCommit` uses K10's own short transactions.
- **Fake:** `enqueue` and `cancelForDeletedReview` record calls. `attemptAfterCommit` returns `"deferred"`, so the Review stays pending.

## 13. K10 — AI runtime: provider and execution controller

**Provider → consumer:** B → A. **Spec basis:** AI-03, AI-04, SEC-08, SEC-11, CON-02, api.md §8.2 and §8.4, D-13, D-15, D-16; AT-10.

```ts
// src/server/adapters/soc-llm/ — imported only by src/server/services/ai/runtime/
export interface LlmMessage { readonly role: "system" | "user"; readonly content: string }
export interface TokenUsage { readonly inputTokens: number; readonly outputTokens: number }
export type LlmFailure =
  | { readonly kind: "rate_limited"; readonly retryAfterSeconds: number | null }
  | { readonly kind: "timeout" } | { readonly kind: "unavailable" }
  | { readonly kind: "rejected" } | { readonly kind: "malformed_response" };
export interface LlmProvider {
  readonly modelId: string; // from SOC_LLM_MODEL
  complete(request: {
    readonly messages: readonly LlmMessage[]; readonly maxOutputTokens: number; readonly signal: AbortSignal;
  }): Promise<Result<{ readonly content: string; readonly usage: TokenUsage | null }, LlmFailure>>; // null usage = unknown
}

// src/server/services/ai/runtime/
export type AiJobDescriptor =
  | { readonly type: "summary"; readonly movieId: MovieId; readonly reviewsRevision: ReviewsRevision; readonly promptVersion: string }
  | { readonly type: "review_moderation"; readonly reviewId: ReviewId; readonly captured: CapturedReviewVersion;
      readonly requesterId: AccountId | null; // author for review_write; null for the recovery sweep
      readonly promptVersion: string; readonly policyVersion: string };
export interface BoundedInput {
  readonly messages: readonly LlmMessage[]; readonly estimatedInputTokens: number;
  readonly snapshot: Readonly<Record<string, unknown>>; // persisted bounded_input_snapshot
}
export interface AiJobRef { readonly jobId: AiJobId }
export interface AiExecutionRequest<T> {
  readonly job: AiJobDescriptor; readonly input: BoundedInput; readonly maxOutputTokens: number; // 1,200 / 1,000
  readonly validate: (content: string) => Result<T, { readonly kind: "invalid_output" }>;
  readonly publish: (tx: Tx, output: T, job: AiJobRef) => Promise<Result<void, { readonly kind: "stale" }>>;
}
export type AiExecutionOutcome =
  | { readonly kind: "published"; readonly jobId: AiJobId }
  | { readonly kind: "disabled" }                                     // AI_ENABLED=false or config missing; no job row
  | { readonly kind: "deferred"; readonly retryAfterSeconds: number | null } // slot, budget or quota; no attempt consumed
  | { readonly kind: "duplicate"; readonly jobId: AiJobId }           // active job holds the dedup key
  | { readonly kind: "input_too_large" }                              // > AI_INPUT_TOKEN_LIMIT; no provider call
  | { readonly kind: "failed"; readonly jobId: AiJobId; readonly cause: "transient" | "invalid_output" | "provider_rejected" }
  | { readonly kind: "stale"; readonly jobId: AiJobId };              // publish rejected or lease lost
export interface AiExecutionController {
  /** No Tx open on entry. Single call, so no temporal coupling (AGENTS.md). */
  run<T>(request: AiExecutionRequest<T>): Promise<AiExecutionOutcome>;
}
export type SweepLeaseName = "summary_sweep" | "review_moderation_sweep"; // O-30; `ai_execution` is K10-internal
export interface SchedulerLeases {
  /** Own Tx to acquire; `work` runs with no Tx held; own Tx to release by lease_token. */
  withSweepLease<T>(name: SweepLeaseName, work: () => Promise<T>):
    Promise<{ readonly acquired: false } | { readonly acquired: true; readonly value: T }>;
}
```

**How `run` executes:**
1. Own short Tx: acquire the `ai_execution` SchedulerLease, increment AIBudgetDay by the reserved cost in microdollars (estimated input tokens and `maxOutputTokens` priced per ai.md AI-03, D-25), and insert AIBudgetReservation and a running AIJob with its dedup key and lease (P-13 order). It also consumes the K6 SoC per-minute quotas in their own Tx.
2. Provider attempts with no Tx: 30 s per attempt, at most 2 attempts, jitter honouring Retry-After, within the 75 s deadline.
3. `validate`.
4. Publish Tx: the `publish` callback takes its domain locks, then the controller locks the AIJob and verifies the lease and running status, last (P-08). Any error rolls the transaction back.
5. Own short Tx in `finally`: reconcile the reservation (unknown usage is charged at the reserved amount) and release `ai_execution`.

A crash leaves the leases to expire. Later access or sweeps mark the job stale.

**Rules:**
- Raw provider errors and content are never logged or returned.
- Callers map `failed` and `input_too_large` to their own retry or manual-review rules (AI-02, AI-01).

**Resolved (see §16):**
- O-26: token counting method. No tokenizer is selected, and estimates must be conservative.
- O-27: whether `SOC_LLM_BASE_URL` includes `/v1`, and whether the gateway supports a JSON response mode.
- O-28: how the fake adapter is selected outside production. No variable exists in deployment.md 10.3, and production must refuse the fake.
- O-29: lease TTLs for the sweep leases, `ai_execution` and AIJob `lease_until`.

**Fakes:**
- `FakeLlmProvider` is deterministic and scriptable: success with usage, success with unknown usage, malformed JSON, `rate_limited`, `timeout`. Unscripted calls return `unavailable`.
- The controller stub given to A before B#5 returns `{ kind: "disabled" }`, so work stays pending.

## 14. K11 — Report evidence snapshot and receipt projection

**Provider → consumer:** A → B. **Spec basis:** FR-04, INV-04, INV-07; data-model "Report evidence_snapshot" paragraph; api.md §8.1 (receipt and report privacy); AT-04.

```ts
// src/server/services/moderation/report-evidence/
export interface EvidenceSnapshot { // Report.evidence_snapshot: immutable, private, written once at submission
  readonly reviewId: ReviewId; readonly reviewVersion: RowVersion; readonly authorId: AccountId;
  readonly movieId: MovieId; readonly movieTitle: string; readonly body: string; readonly rating: number;
}
export function parseEvidenceSnapshot(stored: unknown): Result<EvidenceSnapshot, { readonly kind: "invalid" }>;
export interface ReportReceipt { // GET /me/reports, /me/reports/:id; reporter only
  readonly id: ReportId; readonly reviewId: ReviewId; readonly category: ReportCategory;
  readonly status: ReportStatus; readonly createdAt: string; // ISO 8601 UTC
  readonly disposition?: "accepted" | "dismissed";          // present only when closed
}
```

- **Rules:**
  - B never rewrites `evidence_snapshot`.
  - B's decision sets `status` and `disposition` consistently with the receipt.
  - Snapshot text is untrusted and is rendered escaped.
  - Neither type ever appears in a target-facing projection.
- **Resolved (O-32):** the meaning of `Report.evidence_version`: snapshot schema version or captured `Review.version`. The snapshot already holds the review version.
- **Locks / Tx:** written in A's submission Tx (§3.3). Pure types and parser.
- **Fake:** none needed. Contract tests share fixtures.

## 15. K12 — Shared UI primitives

**Provider → consumer:** A → B. **Spec basis:** product 5.2, 5.3; architecture 6.6.

```ts
// src/components/ — must not import src/server
FormField     { label: string; name: string; hint?: string; error?: string; children: ReactElement } // aria-describedby wiring
DataTable<R>  { caption: string; columns: readonly { header: string; cell: (row: R) => ReactNode }[];
                rows: readonly R[]; rowKey: (row: R) => string; emptyMessage: string }
Pagination    { page: number; pageSize: number; total: number; hrefForPage: (page: number) => string }
StatusBadge   { label: string; tone: "neutral" | "success" | "warning" | "danger" } // text always shown; tone is decorative
LiveRegion    { message: string }                                                  // polite; no focus moves
ConfirmDialog { title: string; targetName: string; consequence: string; confirmLabel: string;
                onConfirm: () => void; onCancel: () => void }                      // rendered only while open
RatingValue   { value: number }                                                    // "8/10"
AggregateRating { average: number | null; count: number; emptyLabel: string }      // "8.3/10"
```

- **Rules:** keyboard operable, visible focus, labelled controls, errors tied to their fields, status never shown by colour alone. `ConfirmDialog` must name its target (FR-05, FR-06). `LiveRegion` and `ConfirmDialog` are Client Components; the others work as Server Components.
- **Fake:** not applicable. The contract check is the manual accessibility checklist plus B's review before A-01 (S-07).

---

## 16. Resolution of OPEN and Proposed items

Resolved on 12 October 2026: the human adopted the recommended resolution for every item (D-24). Where a resolution changes behaviour, `spec/` records it and wins over this table.

**OPEN items**

| ID | Resolution | Recorded in |
| --- | --- | --- |
| O-01 | READ COMMITTED plus the explicit row locks in §3. Deadlock (40P01) and serialization (40001) failures are not retried; they map to `conflict` (409) | tech-stack.md "Database driver" |
| O-02 | `SET LOCAL statement_timeout` 5 s per transaction (readiness 2 s); pool connection-acquire timeout 5 s | tech-stack.md |
| O-03 | One composition root, `src/server/composition.ts`, holds the pool and service graph as module-level constants; nothing else holds shared state | governance.md D-23, AGENTS.md |
| O-04 | Several rows of one table are locked in ascending `id` order | data-model.md lock order |
| O-05 | `error.code` values: malformed_request, unauthenticated, forbidden, csrf_failed, not_found, conflict, stale_version, payload_too_large, unsupported_media_type, validation_failed, precondition_required, rate_limited, internal_error, service_unavailable | api.md 8.1 |
| O-06 | Unknown fields 422; body over 32 KiB 413; unsupported content type 415; unexpected fault 500 `internal_error` | api.md 8.1 |
| O-07 | ETag and If-Match are the quoted integer version (`"3"`); weak validators, lists and `*` are malformed (400) | api.md 8.1 |
| O-08 | Invalid or out-of-range `page`/`pageSize` return 422; no clamping | api.md 8.1 |
| O-09 | A malformed path UUID returns 404 | api.md 8.1 |
| O-10 | Server-generated `X-Request-Id` response header; inbound IDs ignored | api.md 8.1 |
| O-11 | zod, strict mode; `Validator<T>` wraps a zod schema | governance.md D-22, tech-stack.md |
| O-12 | The "422 for insufficient reviews" wording is removed; the summary GET returns 200 `insufficient_reviews`. No DomainError kind is needed | api.md 8.1 |
| O-13 | `GET /api/v1/auth/csrf` returns `{ csrfToken }` and sets `fa_presession` when there is no session; header `X-CSRF-Token`; cookies `fa_session`/`fa_presession`, `__Host-` prefixed on HTTPS; failure 403 `csrf_failed` | api.md, security.md |
| O-14 | K3 owns the cron-secret guard (`requireCronCaller`); both cron routes use it | §6 below |
| O-15 | Vercel `x-real-ip`; fixed placeholder locally; verify against Vercel docs before release | security.md |
| O-16 | Non-USER status target returns 403 `forbidden` | api.md 8.4 |
| O-17 | `AuditResult` is `applied` or `no_op`; action and target-type vocabularies are the unions in §8; denied and failed attempts go to structured logs only | security.md, data-model.md |
| O-18 | A rejected `consume` does not increment; login failures counted only after failed verification; success does not reset; names as in §9 | security.md |
| O-19 | User mutation on a missing or archived Movie returns 404 | api.md |
| O-20 | K7 summary-schedule additions accepted | PLAN.md §5 K7 |
| O-21 | Admin approve, hide and restore are allowed on Reviews of archived Movies; content cannot become public while archived | api.md 8.4 |
| O-22 | Approve when cleared, hide when hidden and restore when not hidden are no-ops: 200, unchanged version, audit result `no_op` | api.md 8.4 |
| O-23 | Cross-module reads are allowed through read-only query repositories owned by the consuming feature; writes stay with the owning module. The `/admin/reviews` read model belongs to Moderation (B) | this file |
| O-24 | ModerationWork gains status `cancelled` for deleted or admin-hidden Reviews | data-model.md |
| O-25 | ModerationWork `model_id` is nullable until first dispatch; the unique key uses `NULLS NOT DISTINCT` | data-model.md |
| O-26 | Estimate = ceil(UTF-8 bytes ÷ 3) + 16 per message; reserve the priced cost of estimate + output cap in microdollars (D-25); reconcile with reported usage | ai.md AI-03 |
| O-27 | `SOC_LLM_BASE_URL` excludes `/v1`; the adapter appends versioned paths; no reliance on a JSON response mode | api.md 8.4, deployment.md |
| O-28 | `AI_PROVIDER=soc_llm|fake`; configuration validation rejects `fake` when `APP_ENV=production` | deployment.md 10.3, `.env.example` |
| O-29 | `ai_execution` and AIJob leases 90 s; sweep leases 150 s | data-model.md SchedulerLease |
| O-30 | Lease names `summary_sweep`, `review_moderation_sweep`, `ai_execution` | data-model.md |
| O-31 | Policy files live in `src/server/services/ai/moderation/policy/`; policy text remains OQ-04 | ai.md AI-02 |
| O-32 | `evidence_version` is the integer schema version of the snapshot, initially 1 | data-model.md |
| O-34 | Shared types live in `src/server/shared/` | this file |

**Proposals:** P-01 to P-13 are all approved as written above.

| ID | Approved rule |
| --- | --- |
| P-01 | K4 and K8 do not audit; the caller records one K5 entry in the same Tx |
| P-02 | Review writes take the Movie `FOR UPDATE` |
| P-03 | The acting Admin's Account is not locked |
| P-04 | K6 and K10 bookkeeping runs only in their own short transactions |
| P-05 | Nested `withTransaction` throws immediately |
| P-06 | `Cache-Control: no-store` on every API response |
| P-07 | Report dismissal locks only the Report |
| P-08 | AIJob lease verification is the last lock in a publish Tx |
| P-09 | Lock-handle types enforce the lock order |
| P-10 | The limiter fails closed (503) |
| P-11 | Session revocation is exposed only through K4; PLAN.md §5 K3 updated |
| P-12 | Catalogue splits into a core module (K7) and an archive/restore orchestrator, so Reviews → Catalogue core and orchestrator → Reviews, with no cycle |
| P-13 | K10's own transactions lock SchedulerLease(`ai_execution`) → AIBudgetDay → AIBudgetReservation → AIJob |

## 17. S-01 amendments (13 October 2026)

These amendments came from the S-01 analysis. Developer B (thegrimbee) delegated the choices to the agent's recommendations. **Status: approved by Developer B; approved by Developer A (Lim-ZY).** No consumer code depends on them yet.

| ID | Change | Spec basis |
| --- | --- | --- |
| AM-01 | K1 converts 40P01 and 40001 into `TransactionConflict` (§2.4). K2 `runRoute` maps it to 409 `conflict`. This changes K2, which Developer A owns | D-36, tech-stack.md "Database driver" |
| AM-02 | K1 `Database.probe()` for readiness: 2 s including connection acquisition. It is a separate named operation, not a timeout flag (§1 rule 2) | D-36, api.md 8.4 health contract |
| AM-03 | `SessionId` (§2.1, K3 `Principal`) is backed by the new `Session.id` column | data-model.md Session row |
| AM-04 | §3.1 rule 3 now matches data-model.md: rate-limit and AI-budget rows are updated only in their own short transactions. Behaviour is unchanged (P-04) | data-model.md "Lock order (D-20)" |
| AM-05 | K1 returns `bigint` as `number`, and throws above `Number.MAX_SAFE_INTEGER`. `SqlParam` is unchanged | tech-stack.md "Database driver" |

## 18. S-03 amendment (15 October 2026)

This amendment came from the S-03 analysis. Developer B (thegrimbee) decided that health handlers set their headers directly while A#1 (K2) is unmerged, and delegated the remaining choices to the agent's recommendations. **Status: approved by Developer B; approved by Developer A (Lim-ZY)**

| ID | Change | Spec basis |
| --- | --- | --- |
| AM-06 | The two health Route Handlers are outside K2's error envelope permanently. They do not use `runRoute` or `errorResponse`, because the health contract requires the minimal bodies at every status, including after an unexpected throw. While K2 is unmerged (Developer B's interim decision), they also set `Cache-Control: no-store`, the JSON content type and a server-generated `X-Request-Id` themselves. K2 needs no change. If K2 later exports a header helper with identical behaviour, the health handlers may adopt it. The §1 rule 3 sentence "`runRoute` turns a throw into a safe generic error" does not apply to health routes | D-38, api.md 8.4 health contract |

## 19. S-02 clarification (16 October 2026)

This clarification resolves the request-ID behavior for K2. **Status: approved by both developers.**

| ID | Change | Spec basis |
| --- | --- | --- |
| AM-07 | K2 `runRoute` generates the server-side `RequestId` and decorates every returned response with `X-Request-Id`. Successful-response helpers retain their existing signatures; `errorResponse` places the same ID in the error body and header. | api.md §8.1; K2 §5; P-06; O-10 |
