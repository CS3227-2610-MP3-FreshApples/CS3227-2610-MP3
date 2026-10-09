# Project Specification — Interfaces and Contracts

## 8. Interfaces and Contracts

### 8.1 HTTP APIs

Base path: /api/v1, implemented by Next.js App Router Route Handlers using the Node.js runtime. JSON requests/responses; reject unknown mutation fields. Successful reads/updates return 200, creates 201, deletes/logout 204, and references to already-running AI work 202. Cookies carry sessions; state-changing browser requests require CSRF protection. IDs, ownership, roles and account status are validated server-side.

Lists return { items, page, pageSize, total }; page starts at 1, pageSize defaults to 20 and caps at 100. Stable ordering always includes ID. Timestamps use ISO 8601 UTC. Private responses use Cache-Control: no-store.

Errors have { error: { code, message, fieldErrors?, requestId } }. Use 400 for malformed input, 401 for no valid session, 403 for forbidden role/status, 404 for missing or ownership-protected objects, 409 for conflicts/stale writes, 422 for valid JSON with invalid fields or insufficient reviews, 429 for limits (with Retry-After), and 503 for unavailable dependencies. Never return stack traces or provider raw errors.

Versioned mutations require If-Match containing the current integer version; absent preconditions return 428, mismatches 409. Return the new version in the resource and ETag header. This applies to review updates/deletes, admin movie and announcement updates/deletes/restores, report decisions, review approval/hiding/restoration and account status changes.

| Method and path | Access | Request / result |
| --- | --- | --- |
| POST /auth/register | Anonymous | email, password, displayName → safe account projection |
| POST /auth/login | Anonymous | email, password → safe account; session cookie |
| POST /auth/logout | Authenticated | invalidate session and clear cookie |
| GET /auth/me | Authenticated | id, displayName, role, status |
| GET /movies | Public | q ≤200, sort=release_desc/title_asc, page, pageSize → active Movie summaries |
| GET /movies/:id | Public | active Movie detail and aggregate |
| GET /movies/:id/reviews | Public | page, pageSize; newest first → visible Review projections |
| POST /movies/:id/reviews | User | rating, body → own Review; restores author-deleted row when allowed |
| PATCH /reviews/:id | Owning User | rating and/or body → updated Review |
| DELETE /reviews/:id | Owning User | soft delete |
| GET /me/reviews | User | own Reviews including pending/flagged, page, pageSize; safe moderation state only |
| POST /reports | User | reviewId, category, explanation → own Report receipt |
| GET /me/reports | User | Reports submitted by caller only, page, pageSize |
| GET /me/reports/:id | Owning User | submitted report status/disposition; never reports received; no private evidence history or notes |
| GET /announcements | Public | published announcements, page, pageSize |
| GET /movies/:id/summary | Public | current summary state/output; never starts generation |
| GET /internal/cron/summaries | Scheduler secret only | bounded daily sweep; process pending Movies; no browser/session access |
| GET /internal/cron/review-moderation | Scheduler secret only | bounded automatic recovery of due review checks |
| GET /ai/jobs/:id | Admin, review-moderation jobs only | state, retryAfterSeconds, safe result/error |
| GET /admin/movies | Admin | includes archived; page, pageSize |
| GET /admin/movies/:id | Admin | current metadata, archive state, version |
| POST /admin/movies | Admin | Movie writable fields → Movie |
| PATCH /admin/movies/:id | Admin | Movie writable fields → Movie |
| DELETE /admin/movies/:id | Admin | archive |
| POST /admin/movies/:id/restore | Admin | restore |
| GET /admin/reports | Admin | status, category, page, pageSize; default all open |
| GET /admin/reports/:id | Admin | immutable evidence, live state, private strike count and projected threshold effect |
| GET /admin/reviews | Admin | movieId?, assessment?, page, pageSize; includes unchecked, failed, hidden and deleted |
| GET /admin/reviews/:id | Admin | current text/version, visibility and latest profanity assessment |
| POST /admin/reviews/:id/approve | Admin | reason and If-Match; approve current held text, no AI call or strike |
| POST /admin/reviews/:id/hide | Admin | reason; hide current Review with If-Match; no strike |
| POST /admin/reports/:id/decision | Admin | disposition, actions, reason → Decision and updated Report |
| POST /admin/reviews/:id/restore | Admin | reason → Review visibility state |
| GET /admin/users | Admin | status?, q (display name, max 200), page, pageSize; USER accounts only; id, displayName, status, version |
| GET /admin/users/:id | Admin | USER account id, displayName, status, version; no credentials/session secrets |
| PATCH /admin/users/:id/status | Admin | status active/suspended, reason (10-1,000), If-Match; manual suspend/unsuspend, no Report required; USER targets only |
| GET /admin/announcements | Admin | drafts/published/deleted, page, pageSize |
| GET /admin/announcements/:id | Admin | full Announcement and version |
| POST /admin/announcements | Admin | title, body, movieId? → draft |
| PATCH /admin/announcements/:id | Admin | title?, body?, movieId?, state=draft/published → Announcement |
| DELETE /admin/announcements/:id | Admin | soft delete |
| GET /me/watchlist | User, optional | own entries, page, pageSize |
| PUT /me/watchlist/:movieId | User, optional | idempotent add |
| DELETE /me/watchlist/:movieId | User, optional | idempotent remove |
| GET /health/live | Public, no session | 200 { status: "ok" }; process responsiveness only, no dependency calls |
| GET /health/ready | Public, no session | 200 { status: "ready" } or 503 { status: "unavailable" }; core configuration and bounded database connectivity check |

Review rating inputs must be integers from 1 to 10 inclusive; reject fractional and out-of-range values with 422.

Public Review projection: id, movieId, author { id, displayName }, rating, body, createdAt, updatedAt. Do not expose email or account history. A report receipt includes id, reviewId, category, status, createdAt and disposition when closed.

Movie writes accept title, synopsis, releaseDate, genres, director, cast, runtimeMinutes only. Reject derived/actor fields. Report disposition is accepted or dismissed; accepted may request hide_review, with targets derived from the Report. Dismissed requires empty actions. Report-derived strikes and threshold suspension are computed server-side, never supplied through the Report decision payload. Accepted with empty actions is valid. Manual suspension/reinstatement uses the protected account-status endpoint and an audited reason; reinstatement advances the strike cycle.

Review creation returns 201 and edit returns 200 with the saved Review and moderationState pending|flagged|cleared, even if the automatic provider call failed or was deferred. Include a safe saved/pending message, never private AI evidence. The request may await screening up to its bounded deadline; GET /me/reviews supports reconnect without resubmitting. Reject client-supplied clearance/assessment fields. Admin AI-generation POST endpoints do not exist. GET summary remains read-only: 200 { status: ready|missing|stale|insufficient_reviews, summary?, eligibleCount }, with no old text when stale. Job reads expose safe status only and never dispatch work.

Job authorization: only active Admins may read review-moderation jobs. Scheduled summary execution records are internal; public access is through the safe Movie summary projection only. Never expose job inputs, prompts, credentials, Reports or private assessments in public output.

Scheduler contract: require Authorization: Bearer <CRON_SECRET> before any work; reject missing/invalid secrets with 401 even if the caller has an Admin session. Return no-store aggregate counts only (processed, skipped, deferred, failed). Duplicate sweeps safely skip while the scheduler lease is active. Capacity failures retain pending work for later runs. The GET endpoint is an internal cron integration, not a browser operation; unsafe browser routes retain CSRF protection.

Report privacy: /me/reports always filters reporter_id by the session; guessed report IDs belonging to another reporter return 404, including when the caller is the target. Account projections may include status but never received-report counts, strike counts, reporters or decision reasons. The admin decision response includes computed strikeAdded and accountStatus for confirmation.

Examples:

```json
{"rating":8,"body":"Thoughtful characters and a memorable ending."}
```

```json
{"disposition":"accepted","actions":["hide_review"],"reason":"The cited review contains targeted harassment."}
```

### 8.2 Internal APIs / RPC

No network RPC is required. Define typed services for authenticateSession, authorize, createReview, changeReviewVisibility, submitReport, decideReport, prepareSummaryInput, prepareReviewModerationInput, enqueueReviewModeration, applyReviewClearance, recoverReviewModeration, runScheduledSummaries, acceptReportAndApplyThreshold, startAIExecution and publishValidatedResult.

The SoC adapter accepts bounded messages, configured model, output token budget and deadline; returns content and safe usage metadata or a typed error. Only AI orchestration may call it.

### 8.3 Events

Logical events ReviewChanged, ReviewModerated, MovieVisibilityChanged, ReportCreated, ReportDecided and AccountModerated update revisions, pending work, eligibility, strikes and audit transactionally. Review creation/body changes create durable moderation work; clearance transitions update Movie aggregates/summary revision atomically. Each invocation performs bounded execution; automatic recovery sweeps consume remaining work without a persistent worker.

### 8.4 External Integrations

SoC LLM is the required runtime AI provider. Its actual endpoint, authentication scheme, models, quotas and retention behaviour must be verified against the course guide before integration. Do not assume compatibility with any vendor SDK. The provider adapter isolates those differences.

GitHub Actions is the team-managed CI/CD mechanism; GitHub Pages is the required product website host. Next.js frontend/backend are hosted on Vercel and PostgreSQL on Supabase. No external movie API is required.

Review approval is a manual override for the current content revision, requires a reason and If-Match, and supersedes automatic work. It does not clear author deletion or admin hidden_at; restore clears hidden_at only and never bypasses pending/flagged moderation. Every control is server-authorized.

Health contract: both endpoints use Cache-Control: no-store and bypass login/role middleware so external uptime checks work without an Admin session. Liveness never queries the database or LLM. Readiness checks required core configuration and a read-only database probe with a 2-second timeout; AI availability/quota does not determine core readiness. No database writes, provider calls or migrations. Health responses use the minimal shapes above even on failure, not raw dependency errors; detailed causes go to restricted server logs. Do not expose hostnames, versions, connection strings, stack traces or per-dependency diagnostics. Protect against flooding at the edge without relying on application database/session access.

Manual account status changes return 200 with id, displayName, status and version. A same-status request with a current If-Match is a no-op; it must not reset strike_cycle. Unauthorized callers receive 401/403, non-USER targets are rejected, and stale versions return 409. The status transaction serializes with Report acceptance and revokes sessions atomically on suspension. Manual actions do not reveal received-report details to the target.
