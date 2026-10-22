# Developer Guide implementation refresh

Date: 22 October 2026 (Asia/Singapore). Source revision: 34d416aa7626119d8ca4662fbba2da3b6e61872f.
Task: human request to complete the Developer Guide from current implementation and follow the existing diagram convention.
Requirements referenced: A-05, A-06, FR-06, AT-25, D-104; existing FR-03/FR-09 behavior and release verification contract. No new requirement or design decision.

## Scope and rationale

Documentation-only inspection and update, local SVG generation, site build and visual checks. Changed docs/DeveloperGuide.md to replace stale absence claims; describe Report decisions/transaction boundaries, user suspension/reinstatement, User create/edit forms and their limits, Admin navigation, uncertain-write read-back, presentation test commands and current evidence paths. Added docs/assets/developer-guide/report-decision.svg using the existing palette, fonts, rounded boxes, title/desc and ordinary Markdown image convention. Preserved the release runbook and unverified acceptance gates.

No application, specification, dependency, migration, lockfile or unrelated service changes. No commit, staging, push, PR or deployment. Disclosure is logs/2026-10-22-developer-guide-refresh.md.

## Review and validation

Independent reviewer inspected new text/SVG against spec, services, routes, browser clients and test handoffs. Corrected its findings: user status uses PATCH, and PowerShell stdin had corrupted non-ASCII punctuation in initial additions. Repaired punctuation with Unicode escapes/entities. No behavior gap was filled by inference.

- npm.cmd run build --prefix docs: PASS, 7 pages, final build with no reported invalid links.
- git diff --check: PASS (Git reports expected LF-to-CRLF conversion warning).
- PowerShell XML parse: PASS for report-decision.svg, viewBox 0 0 900 695.
- Chromium rendering: PASS at 1280px and 390px; diagram loads and stays inside viewport. Visually inspected both built-page captures and standalone SVG. Narrow view scales diagram text; adjacent prose repeats the flow for readability.
- Application lint, type-check, build, unit, database and E2E suites: NOT RUN for documentation-only changes. Referenced historic results retain their original revision/scope; no current release pass inferred.

Generated artifacts: ignored docs/_site; temporary freshapples-guide-1280.png, freshapples-guide-390.png and freshapples-report-decision.png in OS TEMP. No dependencies added. No sensitive data or live-provider requests.

Next human action: review the guide and verify the session disclosure. Hosted release, full User/Admin acceptance, provider evaluation and manual accessibility remain pending per the guide/spec; this task supplies documentation, not operational evidence.
