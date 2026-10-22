# Developer B Admin UI design handoff

## Assignment

| Field | Value |
| --- | --- |
| Task | Design additive UI improvements for all currently coded Developer B/Admin pages |
| Role | UI Designer (`ui-designer`) |
| Source revision | `d135824ee4d357ae9ac46b3f1d365437bbe6e00d` |
| Repository scope | `src/app/admin/**`, shared UI primitives only where an existing Admin surface already uses them, related Admin UI tests |
| Product changes | None; this is a design-only handoff |
| Existing B source | `workflow/handoffs/A-01-A-02/2026-10-20-a01-a02-admin-ui.md` and current Admin implementation |
| Delegation note | Two read-only UI-designer delegation attempts were made, but neither returned a usable result. This handoff is the direct repository/Figma evaluation and is not attributed to an agent response. |

## Research basis

The review covered the Figma Web design trends page and its linked UI/UX Design principles and Web design resource pages, including design tokens and systems, button states, user-centered design, interaction design, Fitts' law, visual hierarchy, accessibility and inclusion, design ethics, reducing complexity, content design, consistency, responsive/mobile-first design, website structure, layout/grid, color, and calls to action.

Primary sources:

- [Figma Web design trends](https://www.figma.com/resource-library/web-design-trends/)
- [Figma UI design principles](https://www.figma.com/resource-library/ui-design-principles/)
- [Figma accessible and inclusive design](https://www.figma.com/resource-library/creating-accessible-and-inclusive-design/)
- [Figma design consistency](https://www.figma.com/resource-library/consistency-in-design/)
- [Figma responsive website design](https://www.figma.com/resource-library/responsive-website-design/)
- [Figma mobile-first design](https://www.figma.com/resource-library/mobile-first-design/)
- [Figma visual hierarchy](https://www.figma.com/resource-library/what-is-visual-hierarchy/)
- [Figma button states](https://www.figma.com/resource-library/button-states/)
- [Figma web design grid layout](https://www.figma.com/resource-library/web-design-grid-layout-examples/)

The relevant conclusion for this Admin product is to use the useful parts of current trends—responsive structure, strong hierarchy, clear states, high-contrast actions, consistent tokens, and restrained motion—while avoiding decorative 3D, experimental navigation, maximalism, dark-mode expansion, or a new asset/font pipeline. The Admin interface is an operational tool; clarity, status visibility, keyboard access, and error recovery take priority over novelty.

## Current implementation evaluation

Developer B already has functional UI for:

- `/admin/movies`, `/admin/movies/new`, and `/admin/movies/[id]`
- `/admin/announcements`, `/admin/announcements/new`, and `/admin/announcements/[id]`
- An Admin shell with navigation and account/sign-out control
- Guarded browser API reads/writes, optimistic busy states, live announcements, confirmation dialogs, tables, pagination, and form-level/field-level failures

The following remain plain placeholders and need the largest additive design work:

- `/admin` — overview
- `/admin/reviews` — moderation queue
- `/admin/reports` — report queue
- `/admin/users` — user management

The existing Movie and Announcement flows need visual consistency and state polish rather than new contracts. Do not replace their guarded HTTP-client architecture or move Admin data access into Server Components.

## Shared Admin shell and visual language

Extend the existing `RouteShell`, `AdminAccountControl`, K12 form primitives, status primitives, `DataTable`, `Pagination`, and `ConfirmDialog`.

- Keep `bg-slate-50 text-slate-950`, white header surface, `max-w-6xl`, visible active navigation, skip link, and keyboard focus rings.
- Keep the five-link Admin navigation as a wrapping horizontal navigation at desktop/tablet widths; allow a compact stacked layout below the mobile breakpoint rather than introducing a hidden navigation pattern.
- Treat the Admin account control as a distinct utility cluster: display name, sign-out action, busy state, and an inline alert region. It should remain reachable after navigation and not compete with the page title.
- Use a consistent page header: eyebrow/context, `text-3xl font-semibold tracking-tight sm:text-4xl` title, one concise description, then the primary action.
- Use white bordered cards and tables with consistent `rounded-lg border border-slate-200`; reserve shadows for elevation that communicates a dialog or primary surface.
- Primary actions use blue-700/white, minimum 44px height, hover/focus/disabled states. Destructive actions require confirmation and use red only for destructive meaning.
- Status badges must not rely on color alone: pair tone with visible words such as Active, Archived, Draft, Published, Deleted, or Suspended.
- Preserve `aria-live`/alert behavior, field associations, plain-text rendering, and safe generic error messages.
- Motion should be limited to short state/color transitions and respect reduced-motion preferences.

## Page recommendations

### `/admin` — Admin overview (P0)

Replace the placeholder with an operational landing page:

1. Header: “Admin overview” and a short description of catalogue, announcements, moderation, and account work.
2. A responsive grid of destination cards for Movies, Announcements, Reviews, Reports, and Users. Each card has a one-line purpose, a clear link, and no fabricated counts.
3. A compact “What needs attention” panel only if a real API projection exists. Until then, use explicit copy such as “Operational summaries will appear here when available”; do not invent pending totals.
4. Keep the visual order aligned with the Admin navigation and use a single primary destination per card.

### `/admin/movies` — catalogue list (P1)

Keep the existing table and archive/restore behavior. Add:

- A stronger page header/action grouping and a short explanatory paragraph.
- A responsive table wrapper with horizontal scrolling and a clear mobile fallback.
- A visually distinct status column with text badges and a consistent action column.
- Empty state hierarchy: first-time “No movies yet. Create the first one.” versus page-empty state; keep the create action visible.
- Loading state as a page-level skeleton or neutral status surface, not a floating text fragment.
- Error state with a bordered alert, safe message, and “Try again” aligned with the existing `LoadFailure` behavior.
- Pagination and row action controls with stable widths so busy labels do not cause layout shift.

### `/admin/movies/new` and `/admin/movies/[id]` — movie forms (P1)

- Use a constrained form column (`max-w-3xl`) with a clear “Create movie” or “Edit movie” title and a small context link back to the list.
- Group fields into “Required details” and “Additional metadata” without changing the API fields.
- Keep the synopsis, genres, and cast plain-text hints visible; use consistent textarea borders, focus rings, and error placement.
- Keep submit actions together at the end, with a primary action and a secondary back/cancel link where the current flow permits it.
- On archived edit pages, keep the existing archived note prominent but informational; do not imply that editing restores publication.
- Keep stale-version recovery visible beside the form-level error; preserve typed values and make “Load latest version” a deliberate secondary action.
- Preserve the movie ID reference as secondary metadata, visually separated from editable content.

### `/admin/announcements` — announcement list (P1)

Keep the existing all-state table and publish/unpublish behavior. Add:

- A state filter only if the API contract later supports it; do not add client-only filtering that misrepresents the total.
- State badges with text and a compact legend or explanatory sentence for Draft, Published, and Deleted.
- A clear distinction between “Never published” and a real UTC publication time.
- Deleted rows visually muted and without action controls, preserving the current no-action rule.
- Empty, loading, and retry surfaces matching the Movies list.

### `/admin/announcements/new` and `/admin/announcements/[id]` — announcement forms (P1)

- Use the same constrained form layout and heading hierarchy as Movie forms.
- Make the two-action state model explicit: “Save draft” versus “Save and publish” for drafts; “Save” versus “Save and unpublish” for published items.
- Add short supporting text explaining the consequence of publishing/unpublishing, without adding a confirmation flow that the product contract does not require.
- Keep the related Movie ID field secondary and visibly optional.
- For deleted announcements, present a read-only summary surface rather than an editable form; preserve the current API behavior.

### `/admin/reviews` — moderation queue (P0, contract-dependent)

The current page is a placeholder. When the approved `GET /admin/reviews` read model is available, use:

- A queue header with filters/search only for fields in the approved read model.
- A dense but readable table/list with review author display name, Movie, rating, moderation/publication state, created/updated time, and explicit action affordances.
- Separate “needs review” from already-cleared/hidden/deleted states; never imply that AI flags are human decisions.
- A review detail drawer/page with escaped plain text, state history only where the contract permits it, and primary Admin actions for approve/hide/restore.
- Confirmed destructive/hiding actions with reason fields and current-version conflict recovery.
- Empty copy that distinguishes “No reviews need attention” from “No reviews exist.”
- Loading, unavailable, forbidden, stale-version, and action-success states with live announcements.

Do not design new moderation controls, AI retry controls, or review state transitions beyond the approved moderation contract.

### `/admin/reports` — report queue (P0, contract-dependent)

When the approved report decision read/write model is available, use:

- A queue that foregrounds report category, target review/user, report status, created time, and whether a decision is pending.
- A detail view that separates reporter evidence from Admin-only decision context.
- A decision panel with explicit “Accept” and “Dismiss” actions, a required reason where the contract requires it, and effect preview only from server-derived values.
- A clear warning that a report is an allegation under review, not an established violation.
- Confirmation and version-conflict recovery for decisions; no action should be available while the row is stale or loading.
- Empty copy that distinguishes no open reports from no historical reports.

Do not expose reporter identity or received-report details to target-facing pages, and do not allow the UI to choose strikes, suspension, or report-derived effects.

### `/admin/users` — user management (P0, contract-dependent)

When the approved Admin user read model is available, use:

- Search and status filters only for approved query fields.
- A table with display name, status, last relevant update, and an action column; never show email, strike ledgers, reporter identities, or received-report counts unless the approved Admin projection explicitly permits them.
- Status badges with text and a concise account-status explanation.
- A user detail panel with a deliberate suspend/reinstate action, reason input, current-version handling, and a confirmation step.
- Clear distinction between active, suspended, and unavailable/forbidden states.
- Success/error announcements that do not expose audit internals or raw provider/database errors.

## Priority and acceptance criteria

### P0 — implement first

- Admin overview replaces the placeholder without invented metrics.
- Reviews, Reports, and Users receive implementation-ready empty/available/loading/error states, but data-dependent controls wait for the approved read models.
- Shared Admin shell, focus, status, table, form, and account-control styling is consistent across existing pages.

### P1 — polish existing flows

- Movie and Announcement list/form pages share hierarchy, responsive table behavior, action sizing, status treatment, and recovery copy.
- Existing API calls, guarded client architecture, authorization behavior, and plain-text handling remain unchanged.

### Acceptance examples

- At 320px wide, every Admin action remains reachable without clipped text or inaccessible horizontal controls.
- A loading, forbidden, unavailable, stale-version, or success state is visually distinct and announced to assistive technology.
- A destructive or publication-changing action names its target and preserves the existing confirmation/API semantics.
- Empty states never fabricate totals, reports, review decisions, or user statuses.
- No Admin page exposes private reporter, strike, password, session, or raw provider details.
- Keyboard focus is visible for navigation, form fields, table links, pagination, dialogs, and account actions.

## Known gaps and decisions

- `/admin/reviews`, `/admin/reports`, and `/admin/users` currently lack their data-bearing UI contracts; implementation must wait for the approved read models and mutation decisions.
- Existing Developer B handoff identifies Admin UI work as in progress and lists API/UI boundaries. This design handoff does not resolve those product or architecture gaps.
- No new dependencies, images, fonts, dark theme, animation framework, or API/database fields are recommended.

## Next action

Human Developer B reviews this design handoff against the relevant Admin specifications and records approval/required changes. An implementation agent may then execute one bounded UI increment, beginning with the shared Admin state polish and `/admin` overview.
