# Project Specification — Product

## 1. Product Overview

### 1.1 Problem / Purpose

Provide a moderated movie-review community where users can discover movies and discuss them, and administrators maintain the catalogue and handle abuse reports. Review summaries help users digest community opinions; automatic AI profanity screening checks every new Review and sends flagged content to admins.

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

Streaming, ticket sales, payments, image storage, social messaging, recommendation engines, external catalogue scraping, AI-imposed account sanctions, public report histories, and a general-purpose AI chat interface. Production-scale distributed services are outside the initial scope.

## 2. Users and Roles

An account has exactly one role: USER or ADMIN. Anonymous browsing is an access state, not a third account role. Admins may read public content but do not author community reviews or reports under their admin account.

| Capability | Anonymous | User | Admin |
| --- | --- | --- | --- |
| Read active movies, visible reviews and published announcements | Yes | Yes | Yes |
| Register / sign in | Yes | Yes | Yes |
| Create, edit or delete own review | No | Yes | No |
| Report another user through their visible review | No | Yes | No |
| Read automatically generated movie review summaries | Yes | Yes | Yes |
| Manage movies and announcements | No | No | Yes |
| List Users and manually suspend/unsuspend them | No | No | Yes |
| View reports and automatic moderation results, decide outcomes | No | No | Yes |
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
- Review moderation: private AI profanity assessment of one Review version.
- AI job: persisted work item with status, input provenance and validated output.

### 3.2 Entities / Concepts

Account, Session, Movie, Review, Report, ModerationDecision, Announcement, AIJob, ReviewSummary, ReviewModeration, ModerationWork, ModerationStrike, SchedulerLease and AuditEntry. WatchlistEntry is optional. Field definitions and ownership are in [data-model.md](data-model.md).

### 3.3 Important Relationships

A Movie has many Reviews; a User has at most one Review per Movie. A Report identifies its reporter, reported User and evidence Review. A Report has at most one final Decision. Summaries belong to Movies; profanity assessments belong to Review versions. AI jobs never replace source records or Decisions.

### 3.4 Domain Invariants

- INV-01: Authorization uses server-side identity, role, status and ownership.
- INV-02: Ratings are integers 1–10. Aggregate rating uses only visible Reviews on active Movies; no reviews means null average and count zero.
- INV-03: One Review per User/Movie pair, including soft-deleted rows; re-submission restores that row, unless hidden by moderation.
- INV-04: A User cannot report themself. The reported User must be the evidence Review's author. At most one open Report per reporter/evidence Review.
- INV-05: Archiving a Movie hides it publicly and blocks new reviews/reports for it; retained history remains available to admins.
- INV-06: Human Admins close Reports and apply explicit hide actions. Automatic profanity screening gates Review publication. Accepting Reports applies the deterministic suspension threshold in FR-06; AI never creates strikes or imposes account sanctions.
- INV-07: Review deletion or editing never rewrites the evidence snapshot already captured by a Report.
- INV-08: AI labels never remove Reviews or Reports from admin access. Unchecked Reviews and failed checks remain accessible. Received Reports and strike counts are admin-only.
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

An active User may create, edit and delete their own Review on an active Movie. Require a 1–10 integer rating and trimmed plain-text body of 10–2,000 characters. New Reviews, resubmissions and body edits automatically enter pending moderation before publication. Rating-only edits retain the existing text clearance. Show author display name, rating and edited timestamp. Admin-hidden reviews cannot be restored by their author.

#### Acceptance Criteria

A second create on an existing non-deleted Review returns conflict. Another User cannot mutate it. Edits and deletion update aggregates and invalidate summaries. A deleted Review can be re-submitted through create using its existing identity.

#### Edge Cases

Concurrent creates preserve uniqueness. Stale updates return conflict. An archived Movie blocks User mutations. Deleted, hidden, pending and flagged Reviews are excluded from public lists, aggregates and summary samples. Authors can privately view/edit their own pending or flagged text, without seeing private AI output or received reports.

### 4.4 User Reports (FR-04)

#### Requirements

Offer "Report user" on another User's visible Review. Collect category (profanity, harassment, hate, spam, other) and plain-text explanation of 10–1,000 characters. Capture evidence at submission. A reporter sees only reports they submitted and their final dispositions. A reported User cannot see whether they received a Report, its count, evidence, reporter or decision. Do not send received-report notifications. Admin notes and AI assessments remain private.

#### Acceptance Criteria

Submission enters the open admin queue immediately, independently of AI availability. Self-reporting and duplicate open reports are rejected. The target author is derived server-side. Reporters see open, dismissed or accepted status for their own submissions only. Target-facing responses never expose received reports or strike counts.

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

List all Reports by status, date and category; show immutable evidence and current Review state. Admins accept or dismiss allegations with a reason of 10-1,000 characters. An accepted Report records a strike for its target; hiding the evidence Review is optional. Dismissal records no strike or action. Direct review moderation can hide a Review with a reason without creating a Report or strike.

Default threshold: 3 distinct accepted review incidents since the last reinstatement change status from active to suspended, revoke all sessions, and block sign-in and authenticated operations. Recommend reversible suspension rather than permanent banning; there is no banned status. Suspension remains until an Admin explicitly reinstates the account after review. Admins can manually suspend any active USER account or unsuspend any suspended USER account from the admin user-management screen, independently of Reports, strike count or AI availability. Require a reason of 10-1,000 characters and confirmation naming the User. These controls cannot target ADMIN accounts. Manual suspension revokes all sessions immediately; unsuspension permits a fresh login and starts a new strike cycle without restoring old sessions or deleting history. Neither action creates or accepts a Report.

Count at most one strike per target/review for the lifetime of that Review, regardless of reporter count, resubmission or edits. Only human-accepted Reports count; pending, dismissed and AI-flagged content do not. A previously counted Review cannot add another strike after reinstatement. Retain the incident ledger; reinstatement starts a new strike cycle without erasing prior decisions. Strike counts and received-report information are admin-only. A User may receive a generic account-suspended notice, never a received-report notification or count. Login errors remain generic.

#### Acceptance Criteria

Report closure, unique strike insertion, threshold evaluation, optional Review hiding, session revocation and audit commit atomically while locking the target account. Acceptance below threshold need not hide a Review or suspend the account. Simultaneous acceptances cannot lose increments, double-count an incident or apply suspension twice. Repeated/stale decisions conflict. Admin UI previews strike and suspension effects before confirmation. Manual status changes use the same account lock, optimistic version check and atomic audit/session rules as report-triggered suspension. A request for the existing status is a no-op and must not advance the strike cycle; a stale version returns 409. Only a suspended-to-active transition advances the cycle.

#### Edge Cases

AI failure never blocks manual decisions. Suspension alone does not hide prior reviews. Restore does not undo author deletion. Reinstatement resets the active cycle, leaves old sessions revoked and preserves history; old strikes do not immediately re-suspend the account. Correcting a mistaken suspension uses audited reinstatement with a reason referencing the original decision; Reports are not silently rewritten or reopened.

### 4.7 Announcements (FR-07)

#### Requirements

Admins create, edit, publish, unpublish and delete text announcements with title, body and optional Movie reference. Users see published announcements ordered by publication time. Drafts are admin-only.

#### Acceptance Criteria

Drafts never appear through public APIs. Publishing exposes the approved content; unpublishing removes it. Deletion is soft and audited.

#### Edge Cases

Archived associated Movies do not break the announcement. Empty or oversized content is rejected. Publishing again uses a new publication timestamp.

### 4.8 Public AI Review Summary (FR-08)

#### Requirements

Automatically check daily for Movies whose eligible reviews changed since the last successful summary. Generate only for changed Movies with at least 3 eligible Reviews; summarize up to 20 randomly sampled Reviews from the current eligible set, not just new Reviews. Creation, editing, deletion, hiding and restoration count as changes. Missed or budget-deferred updates remain pending even without further changes.

Anonymous visitors, Users and Admins read the same summary on Movie details. No role can request, regenerate or retry a summary through the UI or a public API. Show sample size, eligible count, generation time, strengths, criticisms, mixed opinions and a sampling disclaimer. Summaries describe review opinions, not invented Movie facts.

#### Acceptance Criteria

Unchanged Movies make no provider call. Sampling is without replacement with Movie/revision deduplication. Zero to two eligible Reviews cause no LLM call. Changes invalidate displayed output immediately; show awaiting scheduled update until a current result exists. Daily scheduling is a target, not a per-movie daily completion guarantee; quotas and bounded runtime may defer work. Unchanged valid summaries remain readable without daily expiry.

#### Edge Cases

Start with a daily change-driven check, token limits and fair processing of pending Movies. If measured usage is excessive, configure a 7-day minimum refresh interval while retaining pending changes. Do not enable per-click generation. See [ai.md](ai.md) for capacity, recovery and sampling. Normal browsing works when AI is unavailable.

### 4.9 Automatic AI Review Profanity Moderation (FR-09)

#### Requirements

Automatically screen every new Review on submission, without an Admin request or a Report. Re-submissions and body edits trigger screening again so edits cannot bypass moderation. Send only complete bounded review text and the versioned profanity policy, never user history or reports. There is no check, regenerate or retry button or admin generation endpoint.

Save the Review as pending before any provider call. The server attempts screening automatically during the submission request when capacity is available. A validated no_profanity_detected result clears the current text for publication. suspected_profanity or uncertain keeps it unpublished as flagged for Admin review. Provider failure, disabled AI or exhausted capacity leaves it pending with automatic recovery; it must never silently publish unchecked text.

#### Acceptance Criteria

Admins see automatic assessments beside source text and can approve a held Review or explicitly hide it with an audited reason. Manual approval is an explicit human override for the current text version, including during AI outages. AI cannot edit text, clear an admin hide, accept Reports, create strikes or suspend accounts. Only cleared, non-deleted, non-hidden Reviews on active Movies appear publicly, contribute to ratings or enter summaries. New visibility changes update these derived values atomically.

#### Edge Cases

Check the whole body without truncation; oversize model inputs remain held for manual review. Cover obfuscation, benign substrings, quotations, unsupported languages and prompt injection. Use version guards so stale AI results cannot publish an edited/deleted/hidden Review or override a later human decision. Screening can miss profanity; Admins retain manual controls. Authors see saved/pending, held for review or published state, without private AI details or received-report information. Editing published text removes that Review from public view until the new text clears. Rating-only changes cannot clear pending/flagged state.

### 4.10 Private Watchlist (FR-10, Optional)

#### Requirements

An active User may add/remove active Movies and list their own watchlist. One entry per User/Movie.

#### Acceptance Criteria

Repeated add/remove is idempotent. Other Users and Admin UI cannot browse someone's private watchlist.

#### Edge Cases

Archived Movies show as unavailable in the owner's list; links to public details are disabled.

## 5. User Experience

### 5.1 User Flows

User: browse/search, read Movie details and reviews, then sign in to write/edit a review or report another author. Movie details show the latest valid scheduled summary or an awaiting-update/insufficient-reviews state, including for anonymous visitors. There is no generate or retry control. Saving new or edited review text shows its pending, held or published state; no moderation request is needed.

Admin: sign in, open the separate dashboard, manage catalogue/announcements, inspect Reports or open Reviews. Inspect automatically screened Reviews and flagged text, then make a human decision with confirmation and audit reference. Accepting a third distinct report incident suspends the target atomically.

### 5.2 UI Requirements

Use a simple responsive text-first layout. Label rating inputs and displayed ratings as out of 10 (for example, 8/10); show aggregate ratings to one decimal (for example, 8.3/10). Separate /app and /admin navigation; shared inputs, validation messages and tables use common components. Include loading, empty, error, stale and success states. Preserve form text after a recoverable failure. Confirm archive and moderation actions. AI output must be labelled, distinguishable from source reviews and accompanied by limitations. A visible "All reports" reset prevents filters from concealing pending work.

### 5.3 Accessibility Requirements

All flows must work with keyboard navigation, visible focus, labelled controls and semantic headings. Error messages must be associated with fields. Do not communicate status through colour alone. Announce async completion through a polite live region; do not move focus unexpectedly. Target WCAG 2.2 AA practices and verify core flows manually; no conformance certification is claimed.
