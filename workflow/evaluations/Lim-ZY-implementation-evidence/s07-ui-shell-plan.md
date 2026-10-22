# S-07/A#2 Iterative-TDD Plan

Task: S-07, Developer A task A#2  
Branch: `feat/ui-shell`  
Base: `master` at `315ef06b95f3aaa75dee254335c720d2405cdb01`  
Requirements: product §§5.2–5.3; architecture §6.6; K12; D-21; finalized D-49  
Allowed application paths: `../../../src/components`, `../../../src/app/layout.tsx`, and the D-49 route/layout paths under `../../../src/app`

## Confirmed behavior

- Public routes remain at the root; `(public)` is URL-neutral.
- User routes are under `/app`; Admin routes are under `/admin`.
- Shared UI lives in `../../../src/components` and does not import `../../../src/server`.
- Shell navigation is presentation only; authorization remains in services and handlers.
- K12 components provide labelled fields and associated errors, keyboard operation, visible focus, non-colour-only status, polite live regions, named confirmation targets, and `8/10` / `8.3/10` rating displays.

## Increment checklist

- [x] Increment 1 — route shells and navigation structure
  - Behavioral tests/evidence: render the root, User and Admin layouts; verify the D-49 URL structure and that User navigation does not expose Admin destinations; verify layouts do not perform authorization.
  - Validation: focused UI/layout test; `npm run lint`; `npx tsc --noEmit`.

- [x] Increment 2 — K12 form, table, pagination, status, live-region and rating primitives
  - Behavioral tests/evidence: labelled controls and `aria-describedby` errors; keyboard reachability and visible focus; empty/loading/error table states; bounded pagination controls; status understandable without colour; polite announcements; `8/10` and one-decimal aggregate formatting.
  - Validation: focused component tests; `npm run lint`; `npx tsc --noEmit`.

- [x] Increment 3 — confirmation dialog and integration/accessibility evidence
  - Behavioral tests/evidence: dialog names its target, supports keyboard confirm/cancel, and does not claim authorization; manual keyboard/accessibility checklist recorded for the completed S-07 surface.
  - Validation: focused dialog tests; applicable unit suite; `npm run lint`; `npx tsc --noEmit`; `npm run build` if the environment permits; scope/import check confirming no UI import reaches `../../../src/server`.

## Per-increment evidence requirements

For each increment, capture a real external baseline snapshot, expected red test, green test, validation results, temporary visual diff, evidence manifest, and deterministic iterative-TDD grade. Leave the real Git index and history unchanged unless separately authorized.
