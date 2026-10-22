# Public account dropdown session

Date: 2026-10-22, Asia/Singapore  
Task: Show the user account dropdown on public pages and disable its account-management action on account pages.  
Branch: `feat/ui-design`  
Starting revision: `d5dd20dab1268513586829cfd1c6d3b16d6812b6`  
Human owner/reviewer: awaiting assignment  
Verification status: awaiting human verification

## Request and scope

The human requested that the dropdown menu remain available while navigating
public pages, and that “Manage my account” be greyed out and unclickable on
the account overview, My reviews, and My reports pages.

## Sources consulted

- `AGENTS.md` for repository workflow, scope, testing, and interaction-summary requirements.
- `src/components/route-shell.tsx`, `src/components/navigation-data.ts`, and
  `src/components/user-account-control.tsx` for the existing shell and account
  control behavior.
- `spec/product.md` and `spec/architecture.md` for the public/user route
  boundaries and UI layering.
- Next.js local documentation for App Router client navigation hooks.

## Changes

- Mounted the authenticated normal-user account control in the public layout
  and home page.
- Removed the duplicate normal-user account destination from public primary
  navigation; admin dashboard navigation remains available to admins.
- Rendered “Manage my account” as a disabled grey button on `/app`,
  `/app/reviews`, and `/app/reports`; it remains a link elsewhere.
- Updated focused navigation and account-menu assertions.

No dependencies, credentials, production data, commits, or deployments were
added. Existing unrelated working-tree changes were preserved.

## Verification

| Check | Result |
| --- | --- |
| Focused Vitest tests (3 files, 24 tests) | PASS |
| `npm run lint` | PASS |
| `npx tsc --noEmit` | PASS |
| `git diff --check` on changed task files | PASS |

## Gaps and next action

Visual browser verification of the public authenticated state and the disabled
control across all three account routes remains for human review. No open
specification conflict was identified.

## Follow-up interaction

The human requested that the sign-in card not show a separate “Signing in…”
message above the email field because the blue submit button already conveys
that state. Removed the redundant live-region status, clear any previous error
when submission starts, and retained the button text and `aria-busy` state.

Follow-up verification: focused public-auth UI tests passed (5 tests), lint
passed, and TypeScript checking passed.

## Human verification

- [ ] Summary matches the interaction and outcomes.
- [ ] Changed files and checks match the working tree.
- [ ] No secrets or production data are included.

Reviewer:  
Verification date:  
Corrections or notes:
