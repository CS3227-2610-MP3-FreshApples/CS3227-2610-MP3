# Project Specification — Product

## 1. Product Overview

### 1.1 Problem / Purpose

Provide a moderated movie-review community where users can discover movies and discuss them, and administrators maintain the catalogue and handle abuse reports. Review summaries help users digest community opinions; report analysis helps admins inspect evidence and relevant history.

### 1.2 Product Scope

Core: accounts and two roles, movie discovery and details, review authoring and maintenance, reporting a user through a specific review, admin movie CRUD, report decisions, announcements, and one LLM feature for each role.

All movie information is text. There are no posters, image uploads, image URLs, binary image fields or external movie-data dependencies in the initial release.

Optional after core acceptance: private watchlists, spoiler flags, genre filters, release scheduling, and admin operational statistics. Optional features must not delay security, course deliverables or online deployment.

### 1.3 Goals

- G-01: Let a User find a movie, read opinions and publish a review with a short, clear flow.
- G-02: Let an Admin maintain accurate listings and make evidence-based moderation decisions.
- G-03: Provide bounded, clearly labelled AI assistance for both roles with graceful failure.
- G-04: Demonstrate security, manual SDD and specialized-agent development through reviewable evidence.

### 1.4 Non-Goals / Out of Scope

Streaming, ticket sales, payments, image storage, social messaging, recommendation engines, external catalogue scraping, autonomous moderation, public report histories, and a general-purpose AI chat interface. Production-scale distributed services are outside the initial scope.

## 2. Users and Roles

An account has exactly one role: USER or ADMIN. Anonymous browsing is an access state, not a third account role. Admins may read public content but do not author community reviews or reports under their admin account.

| Capability | Anonymous | User | Admin |
| --- | --- | --- | --- |
| Read active movies, visible reviews and published announcements | Yes | Yes | Yes |
| Register / sign in | Yes | Yes | Yes |
| Create, edit or delete own review | No | Yes | No |
| Report another user through their visible review | No | Yes | No |
| Request and read User AI summaries | No | Yes | No |
| Manage movies and announcements | No | No | Yes |
| View reports, request AI analysis, decide outcomes | No | No | Yes |
| Maintain private watchlist (optional) | No | Own only | No |

Registration always creates USER accounts. Admin accounts are provisioned through a controlled operator procedure, never a public request field. Suspended Users may browse public pages and sign out but cannot perform authenticated feature operations.

## 3. Domain Model

### 3.1 Canonical Vocabulary

- Movie: a text catalogue entry, active or archived.
- Review: one User's rating and written opinion for a Movie.
- Report: a User's allegation about another User, tied to one Review as evidence.
- Decision: an Admin's recorded disposition of a Report, distinct from AI assessment.
- Announcement: text published by an Admin, optionally associated with a Movie.
- Summary: AI-generated overview of a bounded sample of eligible Reviews.
- Report analysis: private AI assessment of a Report and a bounded history.
- AI job: persisted work item with status, input provenance and validated output.

### 3.2 Entities / Concepts

Account, Session, Movie, Review, Report, ModerationDecision, Announcement, AIJob, ReviewSummary, ReportAnalysis and AuditEntry. WatchlistEntry is optional. Field definitions and ownership are in [data-model.md](data-model.md).

### 3.3 Important Relationships

A Movie has many Reviews; a User has at most one Review per Movie. A Report identifies its reporter, reported User and evidence Review. A Report has at most one final Decision but may have multiple analysis attempts. Summaries belong to Movies; analysis belongs to Reports. AI jobs never replace source records or Decisions.

### 3.4 Domain Invariants

- INV-01: Authorization uses server-side identity, role, status and ownership.
- INV-02: Ratings are integers 1–10. Aggregate rating uses only visible Reviews on active Movies; no reviews means null average and count zero.
- INV-03: One Review per User/Movie pair, including soft-deleted rows; re-submission restores that row, unless hidden by moderation.
- INV-04: A User cannot report themself. The reported User must be the evidence Review's author. At most one open Report per reporter/evidence Review.
- INV-05: Archiving a Movie hides it publicly and blocks new reviews/reports for it; retained history remains available to admins.
- INV-06: Only human Admin actions can close Reports, hide Reviews or suspend Users.
- INV-07: Review deletion or editing never rewrites the evidence snapshot already captured by a Report.
- INV-08: AI labels never remove Reports from the queue. A filter must be reversible; unanalysed and failed-analysis Reports remain accessible.
- INV-09: Public aggregates and summary eligibility change atomically with review visibility or content changes.

## 4. Functional Requirements

### 4.1 Accounts and Role Access (FR-01)

#### Requirements

Support registration, sign-in, sign-out and current-session lookup. Route Users to the community workspace and Admins to the admin workspace. Enforce all permissions in the backend. Public registration cannot set role or account status.

#### Acceptance Criteria

A new account is USER regardless of injected role fields. User calls to every admin endpoint fail without mutation. Logout invalidates the session. Suspension revokes existing sessions and prevents later sign-in.

#### Edge Cases

Duplicate normalized email, invalid credentials, expired session and suspended account yield safe errors. Public account recovery and email verification are deferred; document a controlled recovery process before release.

### 4.2 Movie Catalogue and Details (FR-02)

#### Requirements

Show paginated text listings with title, release year, genres, average rating and review count. Support case-insensitive title search and newest-release/title sorting. Detail pages include synopsis, director, cast, release date, genres, runtime and visible reviews.

#### Acceptance Criteria

Search and pagination return stable ordering with ID as a tie-breaker. An active Movie with no Reviews shows an explicit empty state. The UI and API contain no movie image fields.

#### Edge Cases

Duplicate titles are allowed; IDs distinguish remakes. Unknown or archived IDs return public 404. Empty search results and unknown release dates remain readable.

### 4.3 Review Management (FR-03)

#### Requirements

An active User may create, edit and delete their own Review on an active Movie. Require a 1–10 integer rating and trimmed plain-text body of 10–2,000 characters. Show author display name, rating and edited timestamp. Admin-hidden reviews cannot be restored by their author.

#### Acceptance Criteria

A second create on an existing non-deleted Review returns conflict. Another User cannot mutate it. Edits and deletion update aggregates and invalidate summaries. A deleted Review can be re-submitted through create using its existing identity.

#### Edge Cases

Concurrent creates preserve uniqueness. Stale updates return conflict. An archived Movie blocks User mutations. Deleted and hidden Reviews are excluded from public lists and AI samples.

### 4.4 User Reports (FR-04)

#### Requirements

Offer "Report user" on another User's visible Review. Collect category (harassment, hate, spam, other) and plain-text explanation of 10–1,000 characters. Capture evidence at submission. The User can see their own report status and final disposition, but not admin notes, AI analysis, reporter identities from other reports or private history.

#### Acceptance Criteria

Submission enters the open admin queue immediately, independently of AI availability. Self-reporting and duplicate open reports are rejected. The target author is derived server-side. Users see open, dismissed or action_taken status.

#### Edge Cases

Review deletion before submission returns conflict; deletion afterward preserves the report snapshot. A previously closed report permits a new submission, subject to abuse limits. Invalid allegations are allegations, not established facts.

### 4.5 Admin Movie Management (FR-05)

#### Requirements

Admins create, read, update and archive Movies. "Delete" means soft archive with a confirmation naming the Movie; restore is supported. Required fields are title and synopsis; optional metadata is defined in the data model. Record actor and time for each mutation.

#### Acceptance Criteria

A valid create becomes visible publicly. Archiving preserves related records but removes the Movie from public results. Restore returns eligible reviews to visibility. Invalid fields and stale writes make no change.

#### Edge Cases

Archiving while a User submits a Review must serialize so that the invariant holds. Referencing announcements remain stored but public movie links are omitted while archived.

### 4.6 Admin Moderation (FR-06)

#### Requirements

List all Reports with status, date, category and optional AI priority filters. Show evidence snapshot, current Review state, relevant bounded history and any AI analysis. Admins may dismiss or take action; actions are hide evidence Review and/or suspend reported User. Require a human reason of 10–1,000 characters. Support explicit audited restore-review and unsuspend-user actions.

#### Acceptance Criteria

One transactional decision closes the Report and applies selected actions. Dismissal applies none. action_taken requires at least one action. A repeated or stale decision conflicts. Hidden/deleted evidence can still be assessed; an already-applied action is recorded without duplicate side effects.

#### Edge Cases

An AI failure never blocks manual review. Conflicting admin updates return 409. Suspension alone does not hide all past reviews; hiding is explicit. Reversing an action does not erase or reopen the original Report decision.

### 4.7 Announcements (FR-07)

#### Requirements

Admins create, edit, publish, unpublish and delete text announcements with title, body and optional Movie reference. Users see published announcements ordered by publication time. Drafts are admin-only.

#### Acceptance Criteria

Drafts never appear through public APIs. Publishing exposes the approved content; unpublishing removes it. Deletion is soft and audited.

#### Edge Cases

Archived associated Movies do not break the announcement. Empty or oversized content is rejected. Publishing again uses a new publication timestamp.

### 4.8 User AI Review Summary (FR-08)

#### Requirements

Active Users request a summary from a Movie detail page. Summarize up to 20 randomly sampled eligible Reviews, with at least 3 required. Show sample size, eligible review count, generation time, strengths, criticisms, mixed opinions and a sampling disclaimer. Use only source opinions; do not invent Movie facts.

#### Acceptance Criteria

Sampling is without replacement; the same movie/revision shares a cached job/result. Zero to two Reviews yield insufficient_reviews without an LLM call. New/edited/removed Reviews invalidate current output. Invalid or unavailable AI output leaves normal browsing operational.

#### Edge Cases

Biased samples, contradictory opinions and prompt injection are covered in [ai.md](ai.md). A summary is not the numerical average rating or an endorsement.

### 4.9 Admin AI Report Analysis (FR-09)

#### Requirements

Admins request bounded evidence analysis from report details. Return possible policy concerns, source references, counter-evidence, uncertainty and suggested priority. Use suspected_violation, insufficient_evidence or no_clear_violation as advisory assessments. Keep human moderation controls separate.

#### Acceptance Criteria

The output refers only to supplied evidence IDs and does not make final validity decisions. Admins can view all Reports regardless of assessment. History distinguishes past upheld decisions from unproven reports.

#### Edge Cases

Missing history, deleted content, hostile instructions and conflicting evidence produce qualified output or failure. New relevant history makes the previous analysis stale.

### 4.10 Private Watchlist (FR-10, Optional)

#### Requirements

An active User may add/remove active Movies and list their own watchlist. One entry per User/Movie.

#### Acceptance Criteria

Repeated add/remove is idempotent. Other Users and Admin UI cannot browse someone's private watchlist.

#### Edge Cases

Archived Movies show as unavailable in the owner's list; links to public details are disabled.

## 5. User Experience

### 5.1 User Flows

User: browse/search → detail → read reviews → sign in → write/edit review or report author → receive confirmation. On detail: request summary → pending indicator → summary or actionable failure.

Admin: sign in → separate dashboard → manage catalogue/announcements or open report queue → inspect evidence → optionally request AI analysis → make explicit human decision → confirmation and audit reference.

### 5.2 UI Requirements

Use a simple responsive text-first layout. Label rating inputs and displayed ratings as out of 10 (for example, 8/10); show aggregate ratings to one decimal (for example, 8.3/10). Separate /app and /admin navigation; shared inputs, validation messages and tables use common components. Include loading, empty, error, stale and success states. Preserve form text after a recoverable failure. Confirm archive and moderation actions. AI output must be labelled, distinguishable from source reviews and accompanied by limitations. A visible "All reports" reset prevents filters from concealing pending work.

### 5.3 Accessibility Requirements

All flows must work with keyboard navigation, visible focus, labelled controls and semantic headings. Error messages must be associated with fields. Do not communicate status through colour alone. Announce async completion through a polite live region; do not move focus unexpectedly. Target WCAG 2.2 AA practices and verify core flows manually; no conformance certification is claimed.
