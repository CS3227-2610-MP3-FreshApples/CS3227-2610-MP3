# Next.js and Agent Scaffolding Plan

## Confirmed request

Initialize the repository as a current Next.js TypeScript application that supports both frontend pages and backend Route Handlers, then scaffold the specialist agents required by `../../../AGENTS.md`. Add no product feature implementation, database schema, migration, external integration, or CI workflow.

The application boundaries follow `../../../spec/architecture.md` and `../../../spec/tech-stack.md`. The test and workflow paths correspond to required verification levels and workflow artifacts:

```text
.github/
  workflows/
.codex/
  agents/
docs/
logs/
  TEMPLATE.md
src/
  app/
    api/
      v1/
  components/
  server/
    adapters/
    repositories/
    services/
tests/
  ai-evaluation/
  e2e/
  integration/
    api/
    database/
  unit/
workflow/
  agents/
  evaluations/
  handoffs/
```

The official `create-next-app@latest` initializer will supply the minimum TypeScript/App Router starter, dependency manifest, lockfile, framework configuration, and Tailwind CSS support. It will be generated in an external temporary directory because this repository is non-empty, then merged without overwriting `../../../AGENTS.md`, `../../../README.md`, `../../../.gitignore`, `../../../spec`, or existing `_temp/` artifacts. Tailwind CSS, ESLint, the App Router, `../../../src`, npm, and the `@/*` import alias will be enabled explicitly.

Empty structural directories will contain `.gitkeep` placeholders. The `../../../logs` directory will contain one summary for this chat session, marked as awaiting human verification until reviewed, and a reusable `TEMPLATE.md` for later agent sessions.

The agent configuration will use five roles named by `../../../AGENTS.md`: analyst, architect, implementation, code-quality/test-case generation, and reviewer/tester. Thin executable configuration will live under `../../../.codex/agents`; substantive role prompts and handoff rules will live under `../../agents`, as required by the repository instructions. The configurations will inherit the model selected by the human instead of pinning a model. Analyst, architect, and reviewer/tester will be read-only. Implementation will use workspace-write permissions within its assigned scope. The code-quality/test-case generation agent will use workspace-write permissions for tests and workflow evidence, but will report production-code quality findings rather than silently changing implementation outside an explicitly assigned scope. Project configuration will limit concurrency to five threads and nesting to one level, following the bounded subagent pattern shown in the lecture reference.

### Proposed interaction log template

`../../../logs/TEMPLATE.md` will prioritize a concise review summary first and detailed evidence second. It will contain these sections:

1. **Session metadata** — date/time zone, task title, chat/session identifier if available, human owner/reviewer, working branch, starting source revision, participating agent roles, and verification status.
2. **Goal and approved scope** — requested outcome, permitted paths/actions, applicable requirement IDs copied from recorded sources, exclusions, and approval gates.
3. **Sources consulted** — specifications, decisions, code, external references, and untrusted inputs; distinguish authority from reference material.
4. **Interaction timeline** — a compact table with sequence, actor/agent, summarized request or assignment, action/result, and approval/handoff evidence. Do not reproduce entire prompts unless a short excerpt is essential.
5. **Decisions, assumptions, and conflicts** — decision, source/decision-maker, status (`approved`, `proposed`, or `unresolved`), rationale, and affected artifacts. Never present an agent proposal as a human decision.
6. **Agent assignments and handoffs** — role, bounded assignment, permissions/tools used, files inspected or changed, returned evidence, unresolved risks, and receiving role/human.
7. **Changes and reuse** — changed/generated files with rationale, dependencies, reused ideas/code/documentation and attribution, plus confirmation that unrelated files were untouched.
8. **Verification evidence** — tests/checks with command, environment, result, and evidence path; clearly label failed, skipped, or unavailable checks.
9. **Security and responsible-AI review** — data sensitivity, prompt-injection/untrusted-input handling, secrets/production-data confirmation, agent permission limits, human approval gates, SoC LLM/resource considerations when applicable, and security findings.
10. **Gaps, failures, and next actions** — known limitations, deferred work, unverified claims, blockers, owner, and required next approval.
11. **Reflection notes** — short concrete observations useful for `../../../docs/Reflections.md`, grouped under AI Security, SDD, and Basic Multi-Agent SE.
12. **Human verification** — checklist confirming accuracy, traceability, redaction, and agreement with actual diffs/results, followed by reviewer name and verification date.

Use one `logs/YYYY-MM-DD-short-task.md` summary per new chat session. The coordinating agent maintains that single file; specialist agents return structured handoff evidence for inclusion instead of creating duplicate session logs. Never include secrets, credentials, raw production data, or unnecessarily long prompt transcripts.

## Iteration checklist

- [ ] Increment 1 — Initialize the latest Next.js TypeScript foundation and directory skeleton.
  - Capture the complete pre-change working tree in an external temporary Git repository.
  - Red check: assert that the Next.js package metadata, TypeScript/App Router files, frontend/component/server boundaries, `/api/v1` Route Handler directory, and required test/documentation/workflow directories exist; confirm failure because they are absent.
  - Run `create-next-app@latest` with explicit TypeScript, ESLint, App Router, `../../../src`, npm, empty-starter, Tailwind CSS, and `@/*` alias options in an external temporary directory; merge the generated starter without overwriting existing repository artifacts.
  - Add only structural `.gitkeep` placeholders, `../../../logs/TEMPLATE.md`, and `../../../logs/2026-10-11-project-scaffold.md` alongside the generated starter.
  - Green check: rerun the structure assertion and confirm it passes.
  - Validation: record the resolved Next.js and Tailwind CSS versions; run generated lint, type-check/build checks that are available; verify a production build recognises the App Router and Tailwind setup; verify the log template contains the required traceability, security, reflection, and human-verification sections; verify no database schema, migrations, product features, external integrations, or CI workflow definitions were introduced; run `git diff --check`.
  - Generate `_temp/visual-diff.html` against the external iteration baseline.
  - Complete and grade `_temp/project-scaffold-iteration-1-evidence.json`; mark this item complete only if output correctness and process compliance both pass.

- [x] Increment 2 — Scaffold the five specialist Codex agents and workflow artifacts.
  - Begin only after explicit human approval following Increment 1's handoff, then capture a fresh external baseline.
  - Red check: parse the proposed TOML and assert the five agent configurations, bounded concurrency/depth, distinct permissions, durable role prompts, and handoff/evaluation directories; confirm failure because they are absent.
  - Add `../../../.codex/config.toml`, five `.codex/agents/*.toml` files, `../../README.md`, five `workflow/agents/*.md` role prompts, and structural placeholders for `../../handoffs` and `..`.
  - Configure each role with a bounded purpose, authoritative sources, permitted actions, prohibited actions, required handoff fields, and its human approval gate. Treat the lecture content as reference, not repository authority.
  - Green check: rerun the configuration assertion and confirm it passes.
  - Validation: parse all TOML, validate configuration with the installed Codex CLI in strict mode where supported, confirm the quality/test agent may generate tests but cannot silently broaden production-code scope, confirm role prompts do not grant deployment or Git-history authority, and run `git diff --check`.
  - Update the same session log, generate the iteration-scoped visual diff, complete the second evidence manifest, and grade the increment.

## Explicit exclusions

- No product feature code beyond the unmodified minimal framework starter generated by `create-next-app@latest`.
- No database schema or migration directory, because its location/tooling is not recorded.
- No GitHub Actions workflow file, because its implementation and commands are not recorded.
- No model names, external MCP servers, secrets, or production credentials in agent configuration.
- No commits, staging, pushes, or pull requests.
