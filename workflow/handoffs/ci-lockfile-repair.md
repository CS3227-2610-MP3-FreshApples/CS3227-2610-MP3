# CI lockfile repair handoff

- Task: repair the reported npm ci EUSAGE failure; requirement: DEP-02 (install from lockfile).
- Source revision: 93613b167ab1cd2e243598594459f6b407d84167.
- Scope: package-lock.json and this session's disclosure/handoff documentation. No application behaviour, specification, workflow or direct dependency changes.
- Diagnosis: missing top-level @emnapi/core and @emnapi/runtime 1.11.3 records, plus missing bundled core/runtime 1.11.1 records under @tailwindcss/oxide-wasm32-wasi.
- Repair: generated metadata with npm 12.2.1 in a temporary directory without node_modules; retained only four missing records, preserving all existing entries and versions.
- Verification: Node 24.15.0 / npm 12.2.1, clean temporary directory, npm ci --dry-run --ignore-scripts --no-audit --no-fund --allow-remote=all --os=linux --cpu=x64: exit 0, 443 packages planned. git diff --check passed.
- Earlier attempts: local npm 11.6.2 regeneration did not repair the missing entries. An offline sandbox check failed; npm 12 initially required a compatible Node and explicit remote permission. These were resolved using temporary tooling.
- Generated artifact: package-lock.json. No direct dependencies added; existing optional transitive dependencies are now recorded.
- Gaps: full install, build/test suite and actual Ubuntu CI were not run. No runtime code changed. Independent reviewer and human verification remain pending.
- Next action: human reviews the diff and logs/2026-10-23-ci-lockfile-repair.md, then commits/pushes through the normal reviewed process and reruns CI. No commit, push, PR, deployment or database action performed.
