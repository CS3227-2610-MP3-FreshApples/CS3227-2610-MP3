# AI interaction summary: CI lockfile repair

Date/timezone: 23 October 2026, Asia/Singapore.
Source revision: 93613b167ab1cd2e243598594459f6b407d84167.
Branch: manual-ai-summary.
Human verification: **awaiting human verification**.

The human reported all application CI jobs failing at npm ci with missing @emnapi/runtime and @emnapi/core 1.11.3. The agent inspected package.json, package-lock.json, CI workflows, DEP-02 and the log template. The supplied error output was treated as diagnostic data.

The agent regenerated the lockfile in an isolated temporary directory using Node 24.15.0 and npm 12.2.1 after local npm 11.6.2 failed to populate the missing entries. Only four missing records were retained, including two bundled dependency records. No existing dependency version, application behaviour, specification or CI workflow changed. No direct dependencies were added.

Changed files: package-lock.json; workflow/handoffs/ci-lockfile-repair.md; this summary. The handoff records scope, rationale, verification, failed attempts and next actions. Generated artifact: the repaired lockfile. No secrets or production data were used or recorded. No git history changes, GitHub writes, deployment or database actions occurred.

Verification: clean-directory npm 12.2.1 ci dry run with Linux x64 settings, scripts disabled, audit disabled and remote registry fetches permitted passed (exit 0; 443 packages planned). git diff --check passed. Earlier sandbox/offline and incompatible-tooling attempts did not establish success. Full installation, builds, application tests and actual Ubuntu CI remain unverified. A separate agent review was not performed for this scoped metadata repair; human review remains required.

Next human action: verify this summary and the diff, then commit/push under the repository review process and rerun CI.

- [ ] Human confirms this summary matches the interaction and changed files.
- [ ] Human reviews the lockfile and CI evidence.

Reviewer: pending.
