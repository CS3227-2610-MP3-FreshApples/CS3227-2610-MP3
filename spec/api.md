# Project Specification — Interfaces and Contracts

## 8. Interfaces and Contracts

### 8.1 HTTP APIs

Base path: /api/v1, implemented by Next.js App Router Route Handlers using the Node.js runtime. JSON requests/responses; reject unknown mutation fields. Successful reads/updates return 200, creates 201, deletes/logout 204, and references to already-running AI work 202. Cookies carry sessions; state-changing browser requests require CSRF protection. IDs, ownership, roles and account status are validated server-side.

Lists return { items, page, pageSize, total }; page starts at 1, pageSize defaults to 20 and caps at 100. Stable ordering always includes ID. Timestamps use ISO 8601 UTC. Private responses use Cache-Control: no-store.

Errors have { error: { code, message, fieldErrors?, requestId } }. Use 400 for malformed input, 401 for no valid session, 403 for forbidden role/status, 404 for missing or ownership-protected objects, 409 for conflicts/stale writes, 422 for valid JSON with invalid fields or insufficient reviews, 429 for limits (with Retry-After), and 503 for unavailable dependencies. Never return stack traces or provider raw errors.

Versioned mutations require If-Match containing the current integer version; absent preconditions return 428, mismatches 409. Return the new version in the resource and ETag header. This applies to review updates/deletes, admin movie and announcement updates/deletes/restores, report decisions, review restoration and account status changes.

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
| POST /reports | User | reviewId, category, explanation → own Report receipt |
| GET /me/reports | User | own Reports, page, pageSize |
| GET /me/reports/:id | Owning User | own status/disposition; no private evidence history or notes |
| GET /announcements | Public | published announcements, page, pageSize |
| GET /movies/:id/summary | User | cached summary state/output; never starts generation |
| POST /movies/:id/summary-jobs | User | empty body → shared job or fresh cached result |
| GET /ai/jobs/:id | Authorized requester/context | state, retryAfterSeconds, safe result/error |
| GET /admin/movies | Admin | includes archived; page, pageSize |
| GET /admin/movies/:id | Admin | current metadata, archive state, version |
| POST /admin/movies | Admin | Movie writable fields → Movie |
| PATCH /admin/movies/:id | Admin | Movie writable fields → Movie |
| DELETE /admin/movies/:id | Admin | archive |
| POST /admin/movies/:id/restore | Admin | restore |
| GET /admin/reports | Admin | status, assessment, page, pageSize; default all open, including unanalysed |
| GET /admin/reports/:id | Admin | immutable evidence, live state, bounded history, latest analysis |
| POST /admin/reports/:id/analysis-jobs | Admin | empty body → job or cached analysis |
| POST /admin/reports/:id/decision | Admin | disposition, actions, reason → Decision and updated Report |
| POST /admin/reviews/:id/restore | Admin | reason → Review visibility state |
| PATCH /admin/users/:id/status | Admin | status active/suspended, reason → User status; USER targets only |
| GET /admin/announcements | Admin | drafts/published/deleted, page, pageSize |
| GET /admin/announcements/:id | Admin | full Announcement and version |
| POST /admin/announcements | Admin | title, body, movieId? → draft |
| PATCH /admin/announcements/:id | Admin | title?, body?, movieId?, state=draft/published → Announcement |
| DELETE /admin/announcements/:id | Admin | soft delete |
| GET /me/watchlist | User, optional | own entries, page, pageSize |
| PUT /me/watchlist/:movieId | User, optional | idempotent add |
| DELETE /me/watchlist/:movieId | User, optional | idempotent remove |
| GET /health/live | Public minimal | process liveness |
| GET /health/ready | Public minimal | 200 database ready, otherwise 503; no internals |

Review rating inputs must be integers from 1 to 10 inclusive; reject fractional and out-of-range values with 422.

Public Review projection: id, movieId, author { id, displayName }, rating, body, createdAt, updatedAt. Do not expose email or account history. A report receipt includes id, reviewId, category, status, createdAt and disposition when closed.

Movie writes accept title, synopsis, releaseDate, genres, director, cast, runtimeMinutes only. Do not accept aggregate, archive, revision or actor fields. Report decision actions are hide_review and suspend_user; targets derive exclusively from the Report. Dismissed decisions require an empty action list.

AI POST returns 200 { jobId, status, result } for a fresh cached result or successful generation performed within that request. A duplicate while the same input is running returns 202 { jobId, status, pollUrl }; no new work is detached after the response. Return 422 insufficient_reviews, 429 with Retry-After for caller/provider/concurrency capacity, 503 ai_unavailable for disabled service/provider failure, 504 ai_timeout for an exhausted execution deadline, or 409 ai_stale if input changed before publication. Once a job exists, error bodies also include jobId. A disconnected client may re-POST to reuse the running/completed record; never assume the old function will continue.  GET summary returns 200 { status: ready|missing|stale|insufficient_reviews, summary?, eligibleCount }. Missing/stale responses contain no old summary text. GET job returns terminal failures as status failed with a safe errorCode, not provider internals.

Job authorization: summary jobs may be read by any active USER allowed to access that Movie; report-analysis jobs by ADMIN only. If the Movie is archived or context revoked, deny subsequent polling/output access. Never return job input snapshots, prompt text or provider credentials.

Examples:

```json
{"rating":8,"body":"Thoughtful characters and a memorable ending."}
```

```json
{"disposition":"action_taken","actions":["hide_review"],"reason":"The cited review contains targeted harassment."}
```

### 8.2 Internal APIs / RPC

No network RPC is required. Define typed services for authenticateSession, authorize, createReview, changeReviewVisibility, submitReport, decideReport, prepareSummaryInput, prepareReportInput, startAIExecution and publishValidatedResult.

The SoC adapter accepts bounded messages, configured model, output token budget and deadline; returns content and safe usage metadata or a typed error. Only AI orchestration may call it.

### 8.3 Events

Logical events ReviewChanged, MovieVisibilityChanged, ReportCreated, ReportDecided and AccountModerated update revision counters and audit records inside the originating transaction. They are not best-effort notifications. Persisted AI execution records track in-request work and deduplication; no background queue or public event consumption contract is required.

### 8.4 External Integrations

SoC LLM is the required runtime AI provider. Its actual endpoint, authentication scheme, models, quotas and retention behaviour must be verified against the course guide before integration. Do not assume compatibility with any vendor SDK. The provider adapter isolates those differences.

GitHub Actions is the team-managed CI/CD mechanism; GitHub Pages is the required product website host. Next.js frontend/backend are hosted on Vercel and PostgreSQL on Supabase. No external movie API is required.
