# Developer A UI Design Handoff

## Assignment

| Field | Value |
| --- | --- |
| Task | Design all Developer A UI pages and flows |
| Role | UI Designer (`ui-designer`) |
| Agent | Bernoulli (`01a15d4f-4ce2-74d1-9672-ad29f5e8e71f`) |
| Source revision | `6269f63b16a398f9f86671f466c330b899d51b9d` on `feat/reviews-core`, 21 October 2026 |
| Research source | [Figma Web design trends](https://www.figma.com/resource-library/web-design-trends/) and 79 linked UI/UX, Web design, prototyping, typography, and colour resources |
| Permitted paths/actions | Read repository UI/specification context and provide design guidance; no file edits |
| Files changed by UI designer | None |
| Tests run by UI designer | None |

## Research synthesis and overall direction

Apply the Figma research at principle level:

- Responsive, accessible structure comes before decoration.
- Use strong typographic hierarchy, high-contrast blue actions, clear status language, and consistent spacing.
- Extend the existing semantic HTML and Tailwind direction; do not introduce maximalism, 3D, experimental navigation, a new font, or a dark theme.
- Use motion only for short colour transitions, disabled by `prefers-reduced-motion`.
- Keep the interface lean: text and CSS surfaces only, with no decorative images or new asset pipeline.

Priority:

1. P0: shared shell, authentication boundary, form feedback, status treatments, and resolution of the own-review DTO gap.
2. P1: Movie detail review/report journey, `/app/reviews`, and `/app/reports`.
3. P2: Home, catalogue, announcements, and authentication-page visual consistency.

## 1. Design recommendations by screen/component

### Shared public and User shells

Extend `src/components/route-shell.tsx` rather than replacing it.

- Page background: `bg-slate-50 text-slate-950`.
- Header: white surface, bottom border, wrapping layout; no hamburger is needed for five or fewer links.
- Inner shell: `mx-auto max-w-6xl px-4 sm:px-6 lg:px-8`.
- Main content: `py-8 sm:py-10`.
- Brand/title should be a home link, followed by navigation.
- Active navigation link must use a visible treatment and `aria-current="page"`.
- Retain the skip link and ensure it appears above all header content when focused.
- Keep User navigation separate from public navigation. Put “Browse movies” in page content rather than mixing public links into User navigation.
- Add an authenticated account control at the end of the User header: display name and a “Sign out” button. Never display email, report counts, or session details.

Focus order: skip link → brand → navigation in visual order → sign out → main content.

### Shared visual language

Use the existing blue/slate palette:

- Primary action: blue-700, white text, minimum 44px height.
- Secondary action: white/slate surface with slate-400 border.
- Destructive action: red-700 text or background, used only for confirmed deletion.
- Links: blue-700, underlined with visible focus.
- Cards: `rounded-lg border border-slate-200 bg-white p-5`; avoid unnecessary shadows.
- Page title: `text-3xl font-semibold tracking-tight sm:text-4xl`.
- Section title: `text-xl font-semibold`.
- Body text should generally stay within `max-w-3xl` for readability.

### `/` — Home

Replace the placeholder in `src/app/page.tsx` with a compact static landing page:

1. Eyebrow: “FreshApples Movie Reviews”.
2. H1: “Find your next movie through community reviews.”
3. One-sentence explanation that reviews are moderated before publication.
4. Primary CTA: “Browse movies”.
5. Secondary CTA: “Read announcements”.
6. Three short informational items: ratings out of 10, text-first reviews, moderation before publication.

Do not add dynamic featured content yet; this would add duplicate reads and loading states without a stated requirement.

### `/movies` — Catalogue

Retain the GET form and server-rendered results from `src/app/(public)/movies/page.tsx`, but improve hierarchy:

- Header with title and short search description.
- Search form in a bordered white surface.
- Desktop order: search input, sort select, submit button. Stack vertically below `sm`.
- Show a “Clear search” link only when `q` is non-empty.
- Result count follows the form.
- Results remain a semantic `<ul>`, displayed as one column on mobile and two columns on large screens.
- Each card shows title link, release year, genres, and aggregate rating.
- Use a shared `AggregateRating` so averages consistently show one decimal.
- Reuse the shared `Pagination`; do not retain a second page-local implementation.
- Pagination should render nothing when total is zero instead of “Page 0 of 0”.

Empty copy:

- Unfiltered: “No movies are available yet.”
- Filtered: “No movies match ‘{query}’.” Include “Clear search”.

Invalid query should retain the normal search form, associate the error with the invalid field, and let the user correct it.

### `/movies/[id]` — Movie detail, reviews, summary, and reporting

Expand `src/app/(public)/movies/[id]/page.tsx` in this order:

1. Breadcrumb link: “Movies”.
2. Movie title and aggregate rating.
3. Synopsis.
4. Responsive definition list for release date, genres, director, cast, and runtime.
5. Review-writing area.
6. AI summary panel.
7. “Community reviews” list and pagination.

Keep metadata, summary, and reviews independently loadable so a summary or review-list failure does not remove Movie information.

#### Review-writing area

- Anonymous visitor: show “Sign in to write a review” and “Create an account”.
- Active User: show a “Write a review” disclosure containing:
  - Rating select with options `1/10` through `10/10`.
  - Plain-text body textarea.
  - Persistent hint: “10–2,000 characters. Plain text.”
  - Visual character count that is not announced on every keystroke.
  - Submit label: “Submit review”.
- If creation returns a conflict because an active review exists, retain the form and show: “You already have a review for this movie. Manage it in My reviews.”
- A successful response replaces the form with a safe status summary and a link to `/app/reviews`.

Use a native select rather than a slider or free-form number field; it prevents fractional and out-of-range input while remaining keyboard-friendly.

#### AI summary

Use a bordered section visually distinct from source reviews.

Ready state:

- Heading: “AI summary of community reviews”.
- Generation time.
- “Based on {included} of {eligible} eligible reviews.”
- Separate lists for strengths, criticisms, and mixed opinions; omit empty categories.
- Fixed disclaimer: “AI summary of a sample; may miss opinions or make mistakes.”

Other states:

- `missing` or `stale`: “Awaiting the next scheduled summary update.” Never show stale text.
- `insufficient_reviews`: “Not enough published reviews for a summary yet.” Show eligible count.
- Error: “The summary is temporarily unavailable. Community reviews are still available.”
- Never show generate, retry, job, or moderation controls.

#### Public review cards

Each review card should show:

- Author display name.
- `RatingValue`.
- `<time>` for created/updated time and an “Edited” label when timestamps differ.
- Body rendered as escaped plain text with `whitespace-pre-wrap break-words`.
- “Report user” action only for a signed-in User who is not the author.

Empty state: “No published reviews yet. Be the first to submit one.”

#### Report interaction

Open an accessible modal titled `Report {displayName}` with supporting copy that a report is an allegation for Admin review, not an established violation.

Fields:

- Category select: Profanity, Harassment, Hate, Spam, Other.
- Explanation textarea, 10–1,000 characters.
- “Submit report” and “Cancel”.

After success, close the dialog and show a reporter-safe receipt near the review:

- “Report submitted.”
- Category.
- Status: “Submitted — awaiting review.”
- Submitted time.
- Link to `/app/reports`.

Do not display captured evidence, target account state, strike effects, AI output, or future Admin reasons.

### `/announcements`

Keep a chronological semantic list based on `src/app/(public)/announcements/page.tsx`.

- Use one-column article cards, maximum reading width `max-w-3xl`.
- Show title, human-readable UTC publication date, body, then optional related-Movie link.
- Preserve line breaks using plain-text styling; never interpret announcement content as HTML.
- Add URL-based pagination using the shared component.
- Empty state: “There are no published announcements.”
- Out-of-range nonempty page: “No announcements on this page” plus Previous navigation.

### `/sign-in`

Retain the current fields and safe generic authentication messages in `src/app/(public)/sign-in/page.tsx`.

- Keep the form at `max-w-md`.
- Add a bordered white form surface.
- Keep email and password values in the DOM after a failed attempt.
- Form-level errors appear above fields and are announced once.
- Submitting button uses `aria-busy`, is disabled, and changes label to “Signing in…”.
- Do not distinguish unknown email, incorrect password, or suspended account.
- Do not add a nonfunctional password-recovery link; recovery remains deferred.
- Preserve the existing role-based destination after successful sign-in.

### `/register`

Use the same layout as sign-in.

- Display name, email, password, repeat password.
- Keep the current password requirement hint.
- Preserve all values after recoverable errors.
- Clear password fields only after success.
- Success replaces the form with a confirmation card and prominent “Sign in” CTA.
- Never expose role or account-status controls.

### `/app` shell and overview

Replace the placeholder in `src/app/app/page.tsx` with:

- “Welcome, {displayName}”.
- Brief explanation of the private workspace.
- Three action cards: Browse movies, Manage my reviews, Check my reports.
- A short status guide explaining Awaiting moderation, Held for Admin review, and Published.

Do not fetch counts solely for this page; existing APIs do not provide aggregate dashboard counts.

Before rendering private content, verify `GET /auth/me` with `no-store`. During verification show “Checking your session…”. An invalid session should show a sign-in action or redirect without rendering private response data.

### `/app/reviews`

Use cards rather than a desktop table because review bodies, forms, and actions must remain usable on mobile.

Each card should eventually show:

- Movie title and link.
- Rating.
- Last-updated time.
- Review body.
- Textual status badge.
- Edit and Delete actions.
- Resubmit action for an author-deleted review when allowed.

Status presentation:

| Stored condition | User-facing label |
| --- | --- |
| Cleared, not hidden/deleted | Published |
| Pending | Saved — awaiting moderation |
| Flagged | Held for Admin review |
| Hidden | Hidden by moderation |
| Author-deleted | Deleted by you |

When independent flags overlap, display both factual labels rather than reducing them to a single colour-coded status.

Edit form:

- Prefill rating and body.
- Submit only changed fields.
- Disable “Save changes” until something changed.
- If body changed, show: “Edited text will be unpublished while it is checked.”
- Keep “Cancel” next to Save.
- Delete requires a confirmation naming the Movie and stating that the review can be resubmitted only when moderation and Movie state allow it.

Empty state: “You have not written any reviews yet.” Primary action: “Browse movies”.

The read-only list shell is ready, but edit/delete/resubmit is blocked by the projection issue in the unresolved decisions section.

### `/app/reports`

Render reporter-owned receipts as cards:

- Category.
- Submitted date.
- Status badge.
- Final disposition only when closed.
- Safe report reference.

Copy:

- Open: “Submitted — awaiting review.”
- Accepted: “Accepted.”
- Dismissed: “Dismissed.”

Never show Admin reasoning, actions, target status, review snapshots, received reports, or strike information.

Provide a manual “Refresh statuses” button. Do not poll automatically in the initial implementation.

A separate `/app/reports/[id]` page is not currently justified because list and detail contracts expose the same safe receipt fields. Add it later only if shareable receipt URLs become a requirement.

## 2. Interaction-state notes

### Mutation timing and feedback

For review and report submissions:

- Immediately disable submission controls, set `aria-busy`, and announce “Saving…” or “Submitting report…”.
- After roughly 8 seconds for review writes, add visible guidance that checking can take about a minute and the user should not submit again.
- Client timeout must exceed the server’s 75-second screening deadline.
- On success announce:
  - Cleared: “Saved and published.”
  - Pending: “Saved. Awaiting moderation.”
  - Flagged: “Saved. Held for Admin review.”
- On network interruption: “The connection was lost. Your review may have been saved. Refresh My reviews before submitting again.” Preserve the form.
- Never claim “saved” before a successful response because the connection may fail after database commit.

### Error handling

- `422 validation_failed`: show a form summary and field-associated errors; preserve all input.
- `409 stale_version`: preserve the draft and show “This review changed while you were editing.” Load the latest version before another save; never retry automatically.
- Generic `409 conflict`: explain duplicate review/report or unavailable review using safe contextual copy.
- `428 precondition_required`: treat as a client defect in telemetry, but show the same refresh-required UI as stale state.
- `429 rate_limited`: preserve input and use `Retry-After` when available; no animated countdown is required.
- `401`: retain visible input while the page remains open and offer sign-in. Do not store review/report text in persistent browser storage by default.
- `403`: safe “You cannot perform this action.”
- `404` for an archived/missing Movie or review: disable mutation controls and explain that it is no longer available.
- `500/503`: show a retry action and optional request reference; never expose raw server/provider details.

### Loading and empty states

- Public route loading components should include the page heading and a plain-text status, not only a floating paragraph.
- Avoid animated skeletons; text loading indicators are sufficient and respect the lean design direction.
- Summary and review lists on Movie detail must load independently.
- User-list loading should keep the page header visible and mark the result region `aria-busy="true"`.
- Empty states should include one useful next action, not disabled controls.

### Keyboard and focus behavior

- Forms follow visual DOM order; do not implement custom Enter or Ctrl+Enter shortcuts.
- On failed submit, focus a form error summary with `tabIndex="-1"`; messages should link to invalid fields.
- On successful replacement of a form, focus the success heading so focus is not lost with the removed submit button.
- Opening a report/delete dialog moves focus to its heading or first field.
- Tab and Shift+Tab remain trapped inside a modal dialog.
- Escape cancels and returns focus to the invoking button.
- Destructive confirmation places Cancel before Delete in DOM and visual order.
- Pagination links and all buttons require at least a 44px practical target.
- Status is always communicated with text and icon/shape if used, never colour alone.

The existing `src/components/confirmation-dialog.tsx` should not be reused for these flows until it invokes native `showModal()` behaviour and reliably restores focus; an `open` attribute plus `aria-modal` alone does not provide complete modal interaction.

## 3. Implementation guidance and constraints

### Reuse and component additions

Reuse:

- `RouteShell`
- `FormField` and `TextField`
- `LiveRegion`, `StatusMessage`, and `StatusBadge`
- `RatingValue` and `AggregateRating`
- `Pagination`
- `PublicReadError` and `PublicReadUnavailable`

Extend or add:

- `SelectField` and `TextareaField` using the same label/hint/error wiring as `FormField`.
- `FormFeedback` for focusable error summaries.
- `ReviewForm`.
- `PublicReviewCard`.
- `OwnReviewCard`.
- `ReviewStatusBadge`.
- `ReportDialog`.
- `ReportReceiptCard`.
- `SummaryPanel`.
- `UserSessionBoundary` and `SignOutButton`.
- Shared action/link class exports under `src/components`; User code should not import Admin-owned styling from `admin-feedback.tsx`.

Avoid a generic polymorphic component framework. These domain components are clearer and cheaper to test.

### Tokens and styling

No new theme system is required. Use Tailwind spacing and colour scales plus a small shared mapping for:

- Primary, secondary, and destructive actions.
- Link/focus treatment.
- Neutral, info, success, warning, and danger status surfaces.

The current status components render `data-tone`/`data-status` without visible styling. Add explicit high-contrast classes inside those components or in a small shared style map.

Do not add:

- A UI dependency or icon library.
- Custom fonts.
- Dark mode.
- Animation infrastructure.
- Movie imagery or image placeholders.

### Architecture and security

- Interactive Client Components call `/api/v1` through typed client helpers.
- Existing public Server Components may continue using approved server-side read services.
- No UI module imports repositories, database code, composition internals for mutations, or the LLM adapter.
- Obtain CSRF immediately before unsafe requests and send credentials same-origin.
- Keep private and changing requests `no-store`.
- Guard duplicate submissions with disabled UI and an in-flight ref.
- Do not automatically retry review/report mutations because the write may already have committed.
- Render all user, review, announcement, and AI-summary strings as text; never use `dangerouslySetInnerHTML`.
- Do not expose moderation assessment details, prompts, provider errors, report evidence, reporters, received-report counts, strike counts, emails, or session information.

### Concurrency

Every review edit/delete must use the current version with `If-Match`. On stale failure:

1. Keep the user’s draft.
2. Fetch the latest owning projection.
3. Present the latest saved value separately.
4. Require the user to choose “Use latest” or deliberately save their retained draft against the refreshed version.

Do not silently merge review bodies or overwrite after a stale response.

### Accessibility and verification

Manual checks should cover:

- 320px mobile width and 200% browser zoom.
- Full keyboard completion of sign-in, registration, review, deletion, and reporting.
- Visible focus against every surface.
- Screen-reader association of labels, hints, counters, errors, statuses, and modal descriptions.
- Reduced-motion preference.
- Long unbroken and multi-line plain text.
- Status understanding without colour.
- Private-data absence in HTML, client props, error messages, and cached responses.

Relevant behavioural sources include `spec/product.md`, `spec/api.md`, and `spec/security.md`.

## 4. Unresolved design decisions requiring product input

### Blocking: own-review projection

The current `OwnReview` adds only `moderationState` to the public projection in `src/server/services/reviews/review-read.ts`. Its tests explicitly exclude `hiddenAt` and `deletedAt`.

That conflicts with the required User UI because:

- PATCH and DELETE require a version for `If-Match`.
- The UI cannot distinguish hidden from author-deleted.
- It cannot determine whether Resubmit is permitted.
- It lacks a Movie title and archive state for a usable private list.

A human-approved contract decision is required before `/app/reviews` mutations:

- Option A: extend each safe `GET /me/reviews` item with `version`, a safe derived lifecycle state, and a minimal Movie projection.
- Option B: add an owning-user review-detail endpoint that supplies those fields and an ETag, while deciding what the list exposes.

Do not work around this with one public Movie request per review; archived Movies would fail publicly and the result would be inefficient and incomplete.

### Report receipt context

The current receipt contains report ID, review ID, category, status, timestamp, and disposition. Product must choose whether:

- The generic receipt described above is acceptable; or
- A safe Movie title/author display-name context should be added.

This is not required for correctness, but it materially affects how recognizable older reports are.

### Post-authentication destination

Current behaviour sends Users to `/app` and Admins to `/admin`. Product must decide whether a user who selected “Sign in to write/report” should return to that Movie.

If continuation is approved, only validated internal paths should be accepted; never redirect directly from an arbitrary query-string URL.

### Deleted and hidden overlap

Hidden and deleted flags are independent. Product should confirm the exact User copy and available actions when both apply. The UI must not imply that author resubmission can undo an Admin hide.

### Optional features

Private watchlist, dark mode, automatic report-status polling, dynamic Home content, and standalone report-detail pages should remain out of scope until separately approved.

## Handoff status

The UI designer provided implementation-ready guidance only. No product files, tests, dependencies, or generated artifacts were changed. Human product review is required for the unresolved contract decisions before implementing the affected User review mutation UI.
