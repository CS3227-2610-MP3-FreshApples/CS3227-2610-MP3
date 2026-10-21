# Cross-boundary contracts K1–K12

Status: **approved by both developers on 12 October 2026 (S-00).** Drafted by the architect agent; OPEN and Proposed items resolved in §16 (D-24). The K10 budget amendment (D-25, microdollars) was approved by both developers on 12 October 2026. Changes now require a contract PR approved by both developers ([COMMIT-PLAN.md §2](COMMIT-PLAN.md)).

A-01/A-02 clarification (19 October 2026): D-79–D-81 are recorded under the current human requester's delegated decision authority. Their edits to §3.3, K2 and K5 change no signatures. **Status: approved by both developers (Lim-ZY and thegrimbee) on 20 October 2026.** The K8 no-op wording and K2 historical notes are corrected to match existing authoritative specifications.

Source revision: `f1266e6` on `feat/ai-catalogue-contracts`. The S-00, S-01, S-03 and S-05 amendments, the D-48 amendment, the S-02 clarification AM-12, the B#4 amendments and the B#4 architect-review amendments (§17–§23) are approved by both developers.

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
6. **Fakes fail closed.** A fake never authorizes, clears a Review, admits a rate-limited request or changes an account unless a test scripts it to. Fakes live in `tests/support/fakes/`. The one exception is the K10 provider fakes, which local, dev and E2E runs need (D-16, D-53, D-57). They live in `src/server/adapters/soc-llm/`, and production must not be able to select it (O-28).
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
| 1 | Account table (D-83 first-Admin only) | `SHARE ROW EXCLUSIVE` | Identity-internal bootstrap operation | A (Identity) |
| 2 | Movie | `FOR SHARE` | K7 `lockActiveMovieShared` | B (Catalogue) |
| 2 | Movie | `FOR UPDATE` | K7 `lockActiveMovieForUpdate`, `lockMovieForUpdate`; Catalogue-internal archive/restore | B (Catalogue) |
| 3 | Review | `FOR UPDATE` / `FOR SHARE` | K8 `lockReviewForTransition`, `lockReviewsOfMovie`; Reviews-internal write and report-submission paths | A (Reviews) |
| 4 | Report | `FOR UPDATE` | Moderation-internal decision path | B (Moderation) |
| 5 | Other tables (Session, ModerationDecision, ModerationStrike, ModerationWork, ReviewModeration, ReviewSummary, AuditEntry, AIJob) | as needed | K4 (Session), K5, K9, K10, module internals | various |
| own Tx | RateLimitWindow | upsert | K6 | B |
| own Tx | SchedulerLease, AIBudgetDay, AIBudgetReservation, AIJob creation/reconciliation | as needed | K10 | B |

- **Approved (P-08):** in a K10 publish transaction, verifying the AIJob lease is always the **last** lock. **Clarified (§25, AM-21):** it is the last lock K10 takes; a callback's insert with a `job_id` foreign key takes an earlier key-share lock on the AIJob, which does not conflict with K10's no-key-update locks (D-73).
- **Approved (P-13):** K10's own short transactions lock SchedulerLease(`ai_execution`) → AIBudgetDay → AIBudgetReservation → AIJob.
- **Approved (P-03):** the acting Admin's Account is **not** locked. The K3 guard rechecks it at request start, and no API changes ADMIN status (FR-06).

### 3.3 Per-operation lock sequences

Each step names the contract that performs it. "Unlocked read" is rule 2. Every ModerationWork write holds its Review's `FOR UPDATE` lock and comes after the Movie and Review locks (D-58, §23 AM-17).

**Review write (create, resubmit, body or rating edit, delete), U-02, A**

1. K3 `requireActiveUserMutation` (reads only, no Tx).
2. K6 `consume` on the review-mutation limit (**own Tx**).
3. Tx begins. For PATCH or DELETE, an unlocked read of Review gives `movie_id`.
4. K3 `lockActiveUserShared(author)` (Account, `FOR SHARE`).
5. K7 `lockActiveMovieForUpdate` (Movie, `FOR UPDATE`). **Approved (P-02):** always `FOR UPDATE`, so the lock never upgrades from share to update when `markReviewsChanged` is needed.
6. Review `FOR UPDATE`, or insert under the unique `(movie_id, author_id)`. Re-verify ownership and If-Match.
7. Write the Review.
8. K9 `enqueue` on create, resubmit or body edit, or K9 `cancelForDeletedReview` on delete (ModerationWork).
9. K7 `markReviewsChanged`, only if the set of eligible Reviews changed or the rating or body of a Review that was eligible before the write changed (§22 AM-13, D-51).
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

**D-83 first-Admin bootstrap, Identity-internal, A**

1. Before the Tx, validate and normalize the configured email and validate/hash
   the password using the same private primitives as public registration.
2. Tx begins. The first database operation is
   `LOCK TABLE app.account IN SHARE ROW EXCLUSIVE MODE`.
3. Query Admin existence after the lock. If an Admin exists, return the typed
   already-provisioned outcome without an Account or AuditEntry write.
4. Otherwise insert one active ADMIN through the private Account insertion
   primitive. Public registration remains a separate named operation that can
   insert only active USER and accepts no role/mode selector.
5. On a normalized-email conflict, return a typed safe conflict; never promote
   an existing USER and write no audit entry.
6. K5 records `account.admin_provisioned`; commit Account and AuditEntry
   together. An audit failure rolls back the Account insert.
7. No `admin_bootstrap` table, completion marker, advisory lock or
   bootstrap-state repository method exists. Admin existence is the durable
   idempotency marker.

The deployment-only POST ignores browser identity, cookies, CSRF tokens and
Origin. Before calling Identity it constant-time compares the separately
configured high-entropy `ADMIN_BOOTSTRAP_SECRET`; a missing, wrong, disabled or
removed secret never invokes Identity. The human-approved mapping is recorded
in `spec/api.md`: configuration/service/dependency unavailability is 503,
missing or incorrect secret while enabled is 403, normalized-email conflict is
409, and both created and already-provisioned outcomes are 200 with distinct
minimal `status` bodies. Availability is checked before the secret.

**Movie archive or restore, A-01, B**

1. Tx: Movie `FOR UPDATE` (Catalogue-internal, If-Match).
2. If the requested archive state already holds, record one K5 `no_op` entry and commit without changing the Movie, its version/timestamps or summary markers (D-79). The If-Match check precedes this branch. Otherwise K8 `lockReviewsOfMovie` (Reviews `FOR UPDATE`, O-04 order).
3. Set or clear `archived_at`, increment Movie.version once and set updated_at.
4. `markReviewsChanged` (Catalogue-internal).
5. K5 `record`.
6. Commit.

**Review approve, hide or restore, A-04, B**

1. Tx: K8 `lockReviewForTransition` (Movie `FOR UPDATE`, then Review `FOR UPDATE`).
2. K8 `approveHeldReview`, `hideReview` or `restoreHiddenReview` with If-Match. This calls `markReviewsChanged` internally when eligibility changes.
3. ModerationWork: supersede on approve, cancel on hide, reactivate on restore when still pending (B-internal; D-55, §23 AM-17).
4. K5 `record`.
5. Commit.

**Automatic clearance or flag, A-03, B, via K10**

1. Before dispatch, K10 runs **own short Tx** steps (lease, budget, AIJob). The provider call runs with **no Tx**.
2. Publish Tx (K10 `publish` callback): K8 `lockReviewForTransition` → K8 `applyAutomaticClearance` or `applyAutomaticFlag` (guarded by captured revision and version) → insert ReviewModeration, update ModerationWork → K5 `record` with a null actor.
3. The controller then locks the AIJob and verifies the lease. If the lease is lost, the transaction rolls back.
4. Afterwards, K10 runs an **own short Tx** to reconcile the budget and release `ai_execution`.

**Summary publication, U-04, B (reassigned from A, D-85), via K10**

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
- **Versioned deletes (D-81):** return 204 with no body and a quoted ETag containing the resulting version, unchanged for no-op. The handler sets ETag on the response from `noContentResponse()`; this does not change the helper signature. Movie restore uses `versionedJsonResponse(200, movie, version)`, including no-ops.
- **Resolved (see §16):**
  - O-06: unknown mutation fields return 422, oversized bodies 413, unsupported content types 415 and unexpected faults 500, as recorded in api.md §8.1.
  - O-07: If-Match and ETag value format.
  - O-08: out-of-range `page`/`pageSize`, clamp or reject.
  - O-09: malformed path UUID, 400 or 404.
  - O-10: request-ID response header name, and whether inbound IDs are accepted. **Approved:** always generate server-side.
  - O-11: strict zod schemas (D-22); the in-repo `Validator` interface wraps their results.
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
  - O-14: the `Authorization: Bearer <CRON_SECRET>` check is needed by both U-04 (A at the time; B since D-85) and A-03 (B), but no contract owns it.
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
- **Amended (§19, AM-09, AM-10):** entry validation and request IDs (D-46); the security-event log for denied and failed attempts (D-47).
- **A-01/A-02 selection (D-81):** one audit entry per successful mutation, including no-ops. Announcement PATCH chooses publish/unpublish only for an actual state transition, otherwise update; mixed content/state changes use the transition action and scalar changed-field markers. No resource text is copied into metadata. All resource changes and the entry share one transaction.

## 9. K6 — Shared rate limiter

**Provider → consumer:** B → A. **Spec basis:** SEC-06, SEC-11, D-12, D-13; security.md (10 review mutations per minute, 5 reports per hour, 5 login failures per 15 minutes).

```ts
// src/server/services/rate-limit/
export type RateLimitKey = Brand<string, "RateLimitKey">;
export type RateLimitName =
  | "login_failure_email" | "login_failure_ip" | "review_mutation" | "report_create" | "soc_requests";
export interface RateLimitPolicy { readonly limit: number; readonly windowSeconds: number }
export type RateLimitOutcome =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly retryAfterSeconds: number }; // computed from window end

export interface RateLimiter {
  /** Atomic upsert-increment of RateLimitWindow by `units` (1 for every current policy). */
  consume(key: RateLimitKey, policy: RateLimitPolicy, units: number): Promise<RateLimitOutcome>;
  /** Read-only check (e.g. login before verifying a password). */
  check(key: RateLimitKey, policy: RateLimitPolicy): Promise<RateLimitOutcome>;
}
export interface RateLimitKeys {
  forAccount(limit: RateLimitName, accountId: AccountId): RateLimitKey;
  forEmail(limit: RateLimitName, normalizedEmail: string): RateLimitKey; // HMAC(RATE_LIMIT_KEY_SECRET)
  forClientIp(limit: RateLimitName, ip: string): RateLimitKey;           // HMAC(RATE_LIMIT_KEY_SECRET)
  forEnvironment(limit: RateLimitName): RateLimitKey;                    // SoC per-minute request quota
}
```

- **Outcomes:** `allowed: false` maps to `rate_limited` (429 with Retry-After). **Approved (P-10):** a database failure throws and maps to 503, so the limiter fails closed. Windows are computed from the database clock.
- **Resolved (O-18):**
  - Whether a rejected `consume` still increments.
  - Whether a successful login clears failure counts.
  - The `RateLimitName` values. **Approved:** `login_failure_email`, `login_failure_ip`, `review_mutation`, `report_create`, `soc_requests`. `soc_tokens` was removed by D-48 (SoC documents no tokens-per-minute limit; AM-11).
- **Locks / Tx:** **own short Tx**. It must be called with no Tx open (§1 rule 8).
- **Fake:** an unscripted key returns `{ allowed: false, retryAfterSeconds: 60 }`.
- **Amended (§19, AM-07, AM-08):** windows, admission, input validity and purge (D-43, D-45); key format, policies, client IP and the login sequence (D-44).

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
  - Call `markReviewsChanged` only when the set of eligible Reviews changed, or when the rating or body of a Review that was eligible before the mutation changed. No-op mutations must not advance the revision (data-model). **Amended (§22, AM-13):** this replaces "only when public eligibility actually changed", so a rating-only edit of an eligible Review advances the revision (D-51).
  - Eligibility requires an active Movie, so outside Catalogue's own archive/restore it is never called for an archived Movie.
- **Locks / Tx:** inside the caller's Tx, Movie at position 2. The caller may already hold only Account locks.
- **Fake:** lock functions return `not_found` unless a test seeds the Movie. The marker records calls.
- **Amended (§22, AM-13):** the columns each operation writes, the lock-then-check order for archived Movies, and `Movie.version` left unchanged (D-51).

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
- Increment `version` only for an actual change. O-22's already-cleared approval, already-hidden hide and non-hidden restore return the unchanged version; check If-Match first. The caller records `no_op` for these cases (api.md §8.4).
- Call K7 `markReviewsChanged` internally when eligibility changes.
- Do not touch ModerationWork. Superseding, cancelling and reactivating work is B's job (K9-internal).
- Do not audit. The caller does (P-01).

**Resolved (see §16):**
- O-21: whether Admin approve, hide and restore are allowed on Reviews of archived Movies.
- O-22: hide when already hidden, restore when not hidden, and approve when already cleared. Each could be a no-op or a 409 `conflict`.
- O-23: the read model for `GET /admin/reviews`. Its filters join Reviews (A) with ReviewModeration and ModerationWork (B). The same question applies to cross-module reads in general (`/admin/users` reading Account, U-01 reading Movie).

**Locks / Tx:** inside the caller's Tx. `lockReviewForTransition` acquires positions 2 then 3. The caller may hold an Account lock already, but no Report or later-table lock.

**Fake:** automatic transitions return `stale` and admin transitions return `stale_version` unless scripted. The fake never clears.

**Interim consumer note (D-84):** until U-02 merges, B's archive/restore orchestrator declares a structural `ReviewsOfMovieLock` type with this section's `lockReviewsOfMovie` signature, stays unwired in production (503), and is tested with a test-only PostgreSQL stand-in. The K8 signatures and ownership are unchanged.

## 12. K9 — Moderation work dispatch

**Provider → consumer:** B → A. **Spec basis:** AI-02 "Automatic dispatch and recovery", FR-09, DEP-10; AT-21, AT-24.

```ts
// src/server/services/ai/moderation/
export interface ModerationWorkQueue {
  /** In the review-write Tx after the Review lock. Creates pending work for
   *  (review, revision, prompt, policy) with model_id NULL; supersedes older revisions (D-50). */
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
- **Amended (§22, AM-14, AM-15):** `enqueue` writes `model_id` NULL and takes its prompt and policy versions from module constants. The supersede and cancel status sets, and idempotency on (review, revision, prompt, policy), are defined there. The production `attemptAfterCommit` stub writes nothing (D-49, D-50, D-52).
- **Amended (§23, AM-17):** work for hidden or deleted Reviews is cancelled at dispatch and excluded from sweep selection (D-54). Restore reactivates the current row (D-55). Every ModerationWork write holds the Review lock (D-58).

## 13. K10 — AI runtime: provider and execution controller

**Provider → consumer:** B → A. **Spec basis:** AI-03, AI-04, SEC-08, SEC-11, CON-02, api.md §8.2 and §8.4, D-13, D-15, D-16; AT-10.

```ts
// src/server/adapters/soc-llm/ — imported only by src/server/services/ai/runtime/, the composition root (D-23) and tests/
export interface LlmMessage { readonly role: "system" | "user"; readonly content: string }
export interface TokenUsage { readonly inputTokens: number; readonly outputTokens: number }
export type LlmFailure =
  | { readonly kind: "rate_limited"; readonly retryAfterSeconds: number | null }
  | { readonly kind: "timeout" } | { readonly kind: "unavailable" }
  | { readonly kind: "rejected" } | { readonly kind: "malformed_response" }
  | { readonly kind: "misconfigured" }; // §25 AM-21: 401, 403, 404 or 3xx (D-74)
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
  | { readonly kind: "deferred"; readonly retryAfterSeconds: number | null } // slot, budget, quota, provider 429 or configuration fault; no AI-02 execution consumed (AM-19, AM-21)
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
1. Own short Tx: acquire the `ai_execution` SchedulerLease, increment AIBudgetDay by the reserved cost in microdollars (estimated input tokens and `maxOutputTokens` priced per ai.md AI-03, D-25), and insert AIBudgetReservation and a running AIJob with its dedup key and lease (P-13 order). It also consumes the K6 SoC per-minute request quota in its own Tx.
2. Provider attempts with no Tx: 30 s per attempt, at most 2 attempts, jitter honouring Retry-After when present (D-48), within the 75 s deadline.
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
- **Amended (§22, AM-15):** the controller stub is production code in `src/server/services/ai/runtime/`, writes nothing and is wired by the composition root until S-06. `complete` takes an `AbortSignal` in place of a deadline value, and the model is fixed at construction (D-52, api.md 8.2).
- **Amended (§23, AM-18):** running servers use the stateless `MarkerFakeLlmProvider`; the scripted fake is for tests only (D-57). With `soc_llm` and the v0 policy, the composition root wires the dispatcher stub (D-56).
- **Amended (§22, AM-16):** the fake's script order, malformed output, `hang`, abort and `modelId` behaviour (D-53).
- **Amended (§24, AM-19):** `soc_requests` is consumed once per provider request, the first before step 1 (D-62); a provider 429 after the last attempt gives `deferred` (D-61); lease length, deadline, budget settlement, AIJob columns and slot expiry follow D-63 to D-66. **Amended (§24, AM-20):** retry hints, input estimate and output cap checks, backoff and marker-fake test delivery (D-67–D-70). Signatures are unchanged.
- **Amended (§25, AM-21, AM-22):** final-status writes and settlement guards, a `misconfigured` provider failure that defers, `run` never throwing on its own faults, deadline coverage, the slot pre-check and S-06 wiring details (D-73–D-78).

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
| O-13 | D-14 defines the complete CSRF wire contract: `GET /api/v1/auth/csrf` returns `csrf_v1.<issuedAt>.<nonce>.<signature>`; HMAC-SHA-256 under `SESSION_SECRET` binds it to the current session or signed pre-session; token TTL is 8 hours; `fa_presession` TTL is 30 minutes; header is `X-CSRF-Token`; hosted cookies are `__Host-`-prefixed, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, with no `Domain`; login clears pre-session and rotates binding; failure is 403 `csrf_failed` | governance.md D-14, api.md, security.md |
| O-14 | K3 owns the cron-secret guard (`requireCronCaller`); both cron routes use it | §6 below |
| O-15 | Vercel `x-real-ip`; fixed placeholder locally; verify against Vercel docs before release | security.md |
| O-16 | Non-USER status target returns 403 `forbidden` | api.md 8.4 |
| O-17 | `AuditResult` is `applied` or `no_op`; action and target-type vocabularies are the unions in §8; denied and failed attempts go to structured logs only | security.md and data-model.md (result vocabulary, structured logs); the action and target-type unions are recorded only in §8 (open vocabularies, D-33); log format D-47 |
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

## 19. S-05 amendments (16 October 2026)

These amendments came from the S-05 analysis. Developer B (thegrimbee) delegated every choice to the agent's recommendations. **Status: approved by Developer B; approved by Developer A (Lim-ZY).** AM-08 adds a K2 helper and fixes the K6 login sequence for S-04, and AM-10 makes K2 and Identity emit security events. Both affect Developer A's modules. No consumer code depends on these amendments yet.

```ts
// src/server/services/rate-limit/ (AM-07, AM-08)
export interface RateLimiter {
  consume(key: RateLimitKey, policy: RateLimitPolicy, units: number): Promise<RateLimitOutcome>;
  check(key: RateLimitKey, policy: RateLimitPolicy): Promise<RateLimitOutcome>;
  /** Own short Tx; deletes at most 1,000 expired rows and returns how many it deleted (D-45). */
  purgeExpired(): Promise<number>;
}
export const RATE_LIMIT_POLICIES: Readonly<
  Record<"login_failure_email" | "login_failure_ip" | "review_mutation" | "report_create", RateLimitPolicy>
>; // D-44 values
export function createRateLimiter(deps: { database: Database; sql: Sql }): RateLimiter;
export function createRateLimitKeys(deps: { secret: string }): RateLimitKeys; // config.core.rateLimitKeySecret

// src/server/http/ (K2, AM-08)
export type ClientIpResolver = (headers: Headers) => string;
export function clientIpFromVercelHeaders(headers: Headers): string; // trimmed x-real-ip, else "unknown"
export function placeholderClientIp(headers: Headers): string;       // always "unknown"

// src/server/services/audit/ (AM-09, AM-10)
export function createAuditLog(deps: { sql: Sql }): AuditLog;
export type SecurityEvent =
  | "auth.login_failed" | "auth.login_throttled" | "auth.csrf_failed"
  | "access.denied" | "rate_limit.rejected" | "rate_limit.purge_failed";
export interface SecurityEventInput {
  readonly event: SecurityEvent;
  readonly requestId: RequestId;
  readonly actorId?: AccountId;
  readonly limit?: RateLimitName;
  readonly code?: string; // api.md 8.1 error code
}
export interface SecurityLog { record(entry: SecurityEventInput): void } // never throws
export function createConsoleSecurityLog(): SecurityLog;
```

| ID | Change | Spec basis |
| --- | --- | --- |
| AM-07 | K6 windows, admission and input validity. These cover the epoch-aligned database-clock windows, admission when `count + units <= limit` through one atomic statement, and the read-only `check` (count below the limit, no row created). They also cover `retryAfterSeconds = ceil(window end − now())` with a minimum of 1, and a throw when `limit`, `windowSeconds` or `units` is invalid or `units > limit`. New `purgeExpired()`, called once per invocation by the review-moderation cron route | D-43, D-45 |
| AM-08 | K6 keys and policies, and the K2 client-IP helper. These cover the `bucket_key` format, HMAC-SHA256 over `<limit>:email:` and `<limit>:ip:`, and raw account UUIDs. They also cover the fixed `RATE_LIMIT_POLICIES` and the SoC policies built by K10 from AI configuration. The composition root injects `clientIpFromVercelHeaders` for `development` and `production` and `placeholderClientIp` otherwise. The S-04 login sequence is check, verify, then consume on every failed-authentication path: unknown email, invalid password and known suspended account all consume one email and one IP unit and return the same generic credential error; pre-throttled requests do not verify or increment; successful active-account login consumes nothing | D-44, SEC-06 |
| AM-09 | K5 validates every entry with a strict zod schema and throws on a violation. It checks the closed unions, UUID ids and request ID, and flat scalar metadata of at most 20 keys with values of at most 1,000 code points. It also rejects the forbidden key names. Operator commands generate one request ID per run. Metadata is passed to SQL as a JSON string cast to `jsonb`, because `SqlParam` has no object variant (AM-05 unchanged) | D-46 |
| AM-10 | `SecurityLog` beside K5, with a console implementation and a recording fake in `tests/support/fakes/`. K2/auth handlers record `access.denied` for authenticated 403 authorization denials and `auth.csrf_failed` for CSRF failures; K2/rate-limit consumers record `rate_limit.rejected`. K3 receives the same server-only dependency and records safe `access.denied` events for role/status failures. Identity records `auth.login_failed` and `auth.login_throttled`. Missing/invalid 401 credentials are not logged. The composition root builds `createAuditLog`, `createRateLimiter`, `createRateLimitKeys`, `createConsoleSecurityLog` and the K3 guards from valid core configuration | D-47, D-23 |

## 20. D-48 amendment (16 October 2026)

Approved by both developers (Lim-ZY and thegrimbee) on 16 October 2026.

| ID | Amendment | Basis |
| --- | --- | --- |
| AM-11 | K6 `RateLimitName` drops `soc_tokens`; `soc_requests` is the only SoC policy, and every current `consume` uses 1 unit. K10 consumes only `soc_requests` before dispatch. `SOC_LLM_TOKENS_PER_MINUTE` is removed from AI configuration. Retries honour `Retry-After` only when the provider sends one | D-48, D-44 |

## 21. S-02 clarification (16 October 2026)

This clarification resolves the request-ID behavior for K2. **Status: approved by both developers.**

| ID | Change | Spec basis |
| --- | --- | --- |
| AM-12 (renumbered from a duplicate AM-07 on 17 October 2026; `logs/2026-10-16-s02-http-api-kernel.md` cites it as AM-07) | K2 `runRoute` generates the server-side `RequestId` and decorates every returned response with `X-Request-Id`. Successful-response helpers retain their existing signatures; `errorResponse` places the same ID in the error body and header. | api.md §8.1; K2 §5; P-06; O-10 |

## 22. B#4 amendments (17 October 2026)

These amendments came from the B#4 analysis. Developer B (thegrimbee) delegated every choice to the agent's recommendations. **Status: approved by both developers (Lim-ZY and thegrimbee) on 17 October 2026**, including AM-13, which changes the rule that U-02 (Developer A) follows when calling `markReviewsChanged`. No consumer code depends on these amendments yet. Signatures are unchanged.

| ID | Change | Spec basis |
| --- | --- | --- |
| AM-13 | K7. A Review mutation calls `markReviewsChanged` when the set of eligible Reviews changes, or when it changes the rating or body of a Review that was eligible before it. A rating-only edit of an eligible Review therefore advances the revision. This resolves a conflict between §10 and §3.3 ("only if public eligibility changed") and data-model.md, FR-08 and AI-01, which count every edit of an eligible Review. `markReviewsChanged` sets `reviews_revision`, `summary_pending_since` and `updated_at` only. It leaves `Movie.version` and the summary attempt columns unchanged. The lock functions lock first and then report `archived`. `recordSummaryAttempt` sets the last and next attempt times. `recordSummaryPublished` clears pending state and sets the success time, but only for an active Movie at the published revision; otherwise it returns `stale` with no write | D-51 |
| AM-14 | K9 `ModerationWorkQueue`. `enqueue` writes `model_id` NULL, and its prompt and policy versions come from moderation-module constants (`review-screening-prompt-v1`, `profanity-policy-v0` until OQ-04). It does nothing when a row exists for the same review, revision, prompt and policy, and never reactivates a final row. It supersedes `pending`, `running` and `needs_manual_review` rows of lower revisions. `cancelForDeletedReview` cancels the same three statuses and is a no-op when there are none. Both operations run in the caller's Tx and are real in B#4, with integration tests | D-49, D-50 |
| AM-15 | K9 and K10 stubs. The production `attemptAfterCommit` stub returns `"deferred"`, and the controller stub returns `{ kind: "disabled" }`. Neither writes anything or calls the provider. The composition root wires both until A-03 and S-06 replace them, and constructs no LLM provider before S-06. The LLM adapter fixes its model at construction and takes an `AbortSignal` as its deadline | D-52, api.md 8.2 |
| AM-16 | K10 `FakeLlmProvider`. Scripted outcomes are consumed in order, and the script running out gives `unavailable`. "Malformed JSON" means a success whose content fails `validate`; `malformed_response` is scripted separately. A new `hang` outcome waits for abort. An aborted signal gives `timeout`, and the promise never rejects. `modelId` is a required constructor argument, which the composition root sets from `SOC_LLM_MODEL`. Requests are recorded for inspection. No randomness or clock | D-53 |

## 23. B#4 architect-review amendments (17 October 2026)

These amendments came from the architect review of §22. Developer B (thegrimbee) delegated every choice to the agent's recommendations. **Status: approved by both developers (Lim-ZY and thegrimbee) on 17 October 2026.** D-54 records how U-02 treats edits of admin-hidden Reviews, and D-57 amends the D-42 e2e environment used by R-02, so both affect Developer A's work. No consumer code depends on these amendments yet. Signatures are unchanged.

| ID | Change | Spec basis |
| --- | --- | --- |
| AM-17 | K9 and the moderation module. An author may still edit a hidden Review, and the edit calls `enqueue`. The dispatcher re-reads the Review under its lock, and for a hidden or deleted Review it cancels the work and returns `not_current` with no AIJob, budget or execution count. Sweep selection skips such work. On restore of a pending, undeleted Review, the current-version row moves from `cancelled` back to `pending` in place, keeping `execution_count`; if there is no such row, one is inserted as `enqueue` would. This is the only transition out of `cancelled`. Every ModerationWork write holds the Review `FOR UPDATE` lock, after Movie and Review and before the AIJob lease check, and never shares a transaction with K10 bookkeeping | D-54, D-55, D-58 |
| AM-18 | K10 and the composition root. When `AI_PROVIDER=fake`, the composition root builds the stateless `MarkerFakeLlmProvider` (D-57), with the outcome chosen by the first `[fake-llm:<outcome>]` marker in user content and `unavailable` when there is none. `FakeLlmProvider` (D-53) is test-only. With `soc_llm` and `profanity-policy-v0`, the composition root wires the dispatcher stub and logs one issue naming `AI_PROVIDER` (D-56). The adapter may be imported by the AI runtime, the composition root and `tests/` | D-56, D-57, D-23 |

## 24. S-06 amendments (18 October 2026)

These amendments came from the S-06 analysis. Developer B (thegrimbee) delegated every choice to the agent's recommendations. **Status: approved by both developers (Lim-ZY and thegrimbee) on 18 October 2026**, including AM-19, which changes when U-04 receives `deferred` from K10, and AM-20, which assigns U-04 a conformance test. No consumer code depends on these amendments yet. Signatures are unchanged.

| ID | Change | Spec basis |
| --- | --- | --- |
| AM-19 | K10. Step 1 of `run` is preceded by consuming one `soc_requests` unit in K6's own Tx, and the second attempt consumes another; a denied unit before step 1 gives `deferred` with no writes, and before the second attempt gives no retry. `deferred` also covers a provider 429 after the last attempt; its AIJob ends `failed` with `provider_rate_limited`, and it still consumes no AI-02 execution. `rate_limited`, `timeout` and `unavailable` are retried; `rejected` and `malformed_response` map to `failed`/`provider_rejected`. The `ai_execution` and AIJob lease is `AI_EXECUTION_DEADLINE_MS` + 15 s (O-29's 90 s is the default). Step 1 expires abandoned running jobs and settles their reservations at the reserved amount. The `finally` Tx settles the reservation per attempt charge (`reconciled` or `released`), capped at the day's headroom, and releases the lease by `lease_token` | D-59–D-66 |
| AM-20 | K10. `deferred.retryAfterSeconds` is K6's value for the quota, the seconds left on the `ai_execution` lease, the seconds to the next UTC midnight for the budget, and the last `Retry-After` (or null) for a provider 429. `run` recomputes the input estimate from `messages` and uses the larger of it and `estimatedInputTokens`. A `maxOutputTokens` that is not a positive integer of at most 1,200 throws before any write. Backoff without `Retry-After` is 1–3 s uniform jitter. The controller takes its random source, clock and sleep as constructor dependencies. `MarkerFakeLlmProvider` ships in S-06; its output-schema conformance tests ship with U-04 (`summary`) and A-03 (`clean`, `flag`) | D-67–D-70 |

## 25. S-06 architect-review amendments (19 October 2026)

These amendments came from the S-06 architect review of D-59–D-71. Developer B (thegrimbee) delegated every choice to the agent's recommendations. **Status: approved by both developers (Lim-ZY and thegrimbee) on 19 October 2026**, including AM-21, which changes when U-04 and A-03 receive `deferred` and adds an `LlmFailure` kind. No consumer code depends on these amendments yet. `AiExecutionOutcome`, `AiExecutionRequest` and `SchedulerLeases` signatures are unchanged.

| ID | Change | Spec basis |
| --- | --- | --- |
| AM-21 | K10. The publish Tx's P-08 check is a guarded `UPDATE` that sets the AIJob `succeeded`; the settlement Tx writes `failed` or `stale` only while the job is `running`, and settles a reservation only while it is `reserved`, moving AIBudgetDay only then. Step 1 settles every `reserved` reservation whose job lease has passed, at R × `AI_MAX_ATTEMPTS`. K10 locks AIJob rows only by `UPDATE`, and P-08's "last lock" is the last lock K10 takes. `LlmFailure` gains `misconfigured` (401, 403, 404, 3xx; redirects not followed): not retried, charged 0, outcome `deferred` with null `retryAfterSeconds`, job `failed` with `provider_misconfigured`, no AI-02 execution consumed. `run` never throws except for the output-cap caller bug: a step-1 or quota fault gives `deferred` (null), a publish fault or a throw from `validate` or `publish` gives `failed`/`transient` with `storage_failed`, and a settlement fault leaves the decided outcome unchanged for step 1 to recover | D-73, D-74, D-75 |
| AM-22 | K10. Usage outside the `integer` range is unknown; `Retry-After` is capped at 86,400 s; 200 bodies are read up to 1 MiB. The deadline covers quota, step 1, attempts and `validate`, and the publish Tx starts before it; the first attempt also needs 5 s before the attempt end point; `AI_EXECUTION_DEADLINE_MS` is at least 15,000. Before the first quota unit, an unlocked read of the `ai_execution` lease defers without consuming when it is held. A budget deferral commits step 1's expiry; only step 1 expires. The budget day is computed in UTC in SQL; the daily budget must fit one maximum reservation; with no database the controller stub stays; A-03 logs the D-56 issue; the adapter takes `fetch` as a dependency; the marker fake lives in `marker-fake-provider.ts` | D-75–D-78 |
