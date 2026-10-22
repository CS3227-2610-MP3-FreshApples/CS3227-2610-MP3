# B#11 / R-04 release tooling handoff

Date: 22 October 2026 (Asia/Singapore). Starting revision: `2686b9be9d98f702ad6555897eaa525b11f3f7ad`. Specification commit: `3114090`. Branch: `chore/deploy-release`.

Requirements: DEP-03, DEP-04, DEP-08, DEP-09, DEP-10; D-27, D-30, D-31, D-32, D-35, D-83. The human requested B#11, authorized splitting commits, and delegated missing decisions. The operator choices were recorded in `spec/deployment.md` before dependent implementation. Hosted release and merge approval remain human actions.

## Scope and changes

Permitted actions were repository inspection, scoped release tooling/documentation, isolated synthetic validation and requested local commits. No production database access, deployment, push or PR creation occurred. The branch preserves the starting `fix-ui` commits above local `master`; those existing UI changes are not part of the B#11 commits. Review the B#11 range from `2686b9b`, and integrate the existing UI branch through its own review rather than treating those commits as new B#11 work.

| Files | Rationale |
| --- | --- |
| `spec/deployment.md` | Delegated operator encryption/storage/restore and local service-backed seed choices |
| `scripts/db-backup.mjs`, `scripts/db-restore.mjs`, `scripts/lib/backup-common.mjs`, `scripts/lib/backup-envelope.mjs` | App-schema custom archives, authenticated encryption, safe credential transport, confirmed isolated restore |
| `scripts/db-release.mjs`, `package.json` | Backup success gates existing migration runner; operator command entry points |
| `scripts/db-seed.mjs` | Three fictitious Movies through existing authenticated CSRF-protected Admin API and owning services |
| `vercel.json` | Separate daily summary and moderation schedules, UTC 00:00 and 01:00 |
| `.env.example`, `docs/DeveloperGuide.md` | Placeholder-only operator settings and Vercel/Supabase setup, bootstrap, backup/restore/rollback procedures |
| `.github/workflows/ci.yml` | PostgreSQL 17 client tools for real archive integration tests |
| `tests/unit/deployment/`, `tests/integration/deployment/` | Encryption, negative operator paths, migration gate, real restored data/history/grants and API seeds |
| `workflow/COMMIT-PLAN.md`, `workflow/PLAN.md` | B#11 implementation state without closing hosted R-04 evidence |
| `logs/2026-10-22-b11-release-tooling.md` | One session disclosure; awaiting human verification |

No dependencies added, no lockfile or migrations changed, no application services or API contracts changed. Existing migration runner, API/session/CSRF/services, D-31 synthetic roles and disposable database harness were reused. Generated artifacts are temporary synthetic databases/encrypted archives and `.next` output; none are committed. A checksum-verified gitleaks 8.30.1 download and synthetic test connection state were kept in the OS temporary directory, outside the checkout.

## Validation

Windows PowerShell, Node 24.12.0; disposable PostgreSQL 17 on `127.0.0.1:55439`, PostgreSQL 18 client tools (compatible with the server). Tests used synthetic data and a fake provider only. Commands use `.cmd` because the shell blocks `npm.ps1`.

| Command/check | Result |
| --- | --- |
| `npm.cmd run test:unit -- --maxWorkers=2` | PASS: 116 files, 1,868 tests |
| `npm.cmd run test:integration` with loopback `TEST_DATABASE_URL` and client tools on PATH | PASS: 50 files, 803 tests |
| `npm.cmd run test:integration -- tests/integration/deployment` after final scratch cleanup | PASS: 2 files, 4 tests |
| `npm.cmd run lint` | PASS, no warnings after test cleanup |
| `npx.cmd tsc --noEmit` | PASS |
| `npm.cmd run build` | PASS; existing private `.env.local` was loaded by Next.js, values were not inspected or recorded |
| `npm.cmd run check:secrets` with temporary checksum-verified gitleaks 8.30.1 on PATH | PASS for preexisting commit range and built static assets; rerun after B#11 commits |
| `gitleaks dir` on scripts and both deployment test directories, with config/redaction | PASS: no leaks |
| `git diff --check` | PASS |

Initial unconstrained unit run hit existing test timeouts during parallel validation; the bounded full rerun passed. An initial backup fixture used absent columns; corrected to the current schema. The real restore test found that restore-time `--schema=app` omitted schema creation; removed that filter because the exported archive already contains only `app`. Real archive restore then passed. First attempts at npm and gitleaks failed due shell policy/missing binary; `.cmd` and a temporary verified download resolved them. No checks were weakened or skipped to obtain a pass.

## Independent review and findings

Analyst identified D-35 service-only seeding and missing operator storage/encryption choices. Architect required authenticating the entire archive before executing any restore content, preserving ACLs and preprovisioning roles. Implementation uses a private encrypted snapshot, complete authentication to a sink, then a second decryption pass from the same snapshot.

The code-quality agent added six independent negative cases in `quality.test.ts` and identified an orphaned encrypted scratch directory on a copy/open failure; cleanup now covers that path. Reviewer/tester reproduced early stream errors escaping redaction during asynchronous scrypt derivation. `Transform.construct` now performs derivation after pipeline error handlers are installed; two regression tests pass. Reviewer independently reran the original reproduction and the deployment unit suite, confirming the finding resolved and no remaining serious findings in the inspected implementation. Inherited `PG*` overrides and restore conninfo-like database names are rejected; existing symlinks/junctions are canonicalized for outside-checkout archive paths.

## Remaining operator actions and limits

- Human: review the diff, CI configuration and session summary; run PR CI and approve merge. The new Ubuntu PGDG installation step is not validated on a hosted runner in this session.
- Vercel owner: environment-scoped exact `PUBLIC_APP_URL`, runtime DB/CA and independent signing/cron secrets; fresh environment builds; Fluid compute and effective 120-second function limits; first Admin bootstrap verification/removal/redeployment; Production cron authentication/overlap/backlog and business smoke evidence. No migration/backup credentials in runtime.
- Supabase owner: separate development/production projects, runtime login provisioning, direct/session operator connection and CA, controlled backed-up migrations and unexposed `app` schema. No new migration is introduced here.
- Backup owner: select and verify private off-site storage, daily authenticated export/upload scheduling and alerts, separate passphrase custody, download/restore and rollback/cutover evidence. Local rehearsal does not establish hosted TLS, storage reliability or RPO/RTO.
- OQ-06 tester assignments remain open. Seed command is deliberately local/test only; shared-development tester access is not provisioned.
- Browser E2E/accessibility and hosted release checks were not run for this operator-only change; they remain release evidence requirements.

Next action: human review and hosted setup following `docs/DeveloperGuide.md`. R-04 remains operationally incomplete until that evidence exists. No hosted operation is implied by local tooling completion.
