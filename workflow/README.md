# Agent Workflow

This directory contains the durable role prompts and evidence structure for the specification-driven workflow recorded in `AGENTS.md`. The repository instructions and `spec/` remain authoritative; these files do not create new product requirements.

## Roles and sequence

| Stage | Agent | Access | Outcome |
| --- | --- | --- | --- |
| 1 | Analyst | Read-only | Proposed requirement changes, assumptions, and acceptance examples |
| 2 | Architect | Read-only | Boundary, contract, and threat review with decisions and open risks |
| 3 | Human developer | Human gate | Approval of the specification before implementation |
| 4 | Implementation | Workspace-write | Assigned implementation and evidence based on approved specifications |
| 5 | Code-quality/test-case generator | Workspace-write, constrained | Independent tests in scope and evidence-backed quality findings |
| 6 | Reviewer/tester | Read-only | Independent intent, security, negative-path, test, and diff review |
| 7 | Human developer | Human gate | Resolution of findings and approval to merge or release |

Do not run roles concurrently against the same files. Give each agent a bounded assignment with task and requirement identifiers copied from recorded sources, a source revision, permitted paths/actions, and an explicit receiver. Agents return evidence to the coordinating agent; they do not approve their own output.

## Evidence locations

- `workflow/handoffs/` stores task handoffs when a durable artifact is required.
- `workflow/evaluations/` stores agent evaluation or grading evidence when required.
- `logs/` contains the single human-verified interaction summary for each chat session. Specialist agents return concise evidence to the coordinator instead of creating duplicate session logs.

Every handoff must include the task ID, requirement IDs, source revision, permitted paths/actions, changed files, rationale, tests and results, known gaps, and next action. Never include secrets, credentials, or production data.

## Authority limits

Agent configuration grants no authority to approve specifications, merge changes, deploy, or write Git history. The repository-level Git rules apply to every role: do not run `git commit`, push, open or merge a pull request, rebase, reset, force-push, or change Git configuration without the separate explicit human instruction required by `AGENTS.md`.
