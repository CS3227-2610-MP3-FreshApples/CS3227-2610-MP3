# Project Specification — Constraints and Decisions

## 12. Constraints

### 12.1 Technical

CON-01: Movie listings and details are text-only; no image storage pipeline.

CON-02: Use SoC LLM for both runtime AI features. Verify and enforce actual allocation constraints. No assumed provider compatibility or unrestricted retries.

CON-03: Use team-managed deployment with suitable automation; build-and-host environments offered by coding agents are prohibited.

CON-04: Perform SDD directly without an SDD toolkit. Maintain specifications in this directory, with stable requirement IDs and traceable acceptance evidence.

### 12.2 Regulatory / Course / Organisation

The following are requirements transcribed from [the project brief](../references/requirements.md), not optional product choices:

- Exactly two roles and two developers; each developer completes all features for a specific role plus a substantial portion of shared work.
- At least one LLM feature for each role.
- Simple, separate role interfaces; properly designed shared components following SRP and DRY.
- Explicit implementation and testing of security for runtime AI and the development process.
- Spec-driven development and basic multi-agent software engineering, including specialized-agent evidence.
- Online deployment and separated development/production environments.
- Source code in src/; agent workflow artifacts consolidated in workflow/ as far as practical.
- docs/UserGuide.md accurately describes current features and tester access.
- docs/DeveloperGuide.md covers design, process, workflow files and acknowledgements for reused ideas/code/documentation.
- A GitHub Pages product website.
- docs/Reflections.md contains concrete AI security, SDD and multi-agent SE reflections.
- logs/ contains AI-produced summaries of development prompts/interactions, verified by a human.
- Correct repository naming/structure and up-to-date master branch for grading.

The brief states the submission deadline as 23 October (Friday), 2 pm SGT. In the current project context this is 23 October 2026, 14:00 Asia/Singapore; verify against the official course submission channel. No additional legal compliance claims are made.

### Proposed team ownership

| Owner | Role features | Substantial shared responsibilities |
| --- | --- | --- |
| Developer A | User UI, discovery, reviews, reporting, summary, optional watchlist | Identity/session implementation, public API contracts, User security tests, user guide |
| Developer B | Admin UI, Movie CRUD, moderation, announcements, report analysis | Database/migrations, deployment/CI, audit/job infrastructure, developer guide |
| Both | Cross-review and end-to-end integration | Architecture, provider adapter contract, threat model, acceptance tests, reflections, logs, product website and release |

Names and final allocation remain to be filled in. Shared foundations must have clear owners without splitting a role's features between developers.

### SDD and specialized-agent workflow

1. Analyst proposes a scoped requirement change with IDs, assumptions and acceptance examples.
2. Architect reviews boundaries, contracts and threats; records decisions and unresolved risks.
3. A human developer reviews the spec before implementation.
4. Implementation agent works on an assigned scope using approved specs and isolated test data.
5. A separate reviewer/tester agent checks intent, negative cases, security and the implementation diff; it must not merely copy implementation assumptions.
6. Human developer resolves findings and approves merge; both developers review release evidence.
7. Update specs first for behaviour changes, then code, tests, guides and interaction summaries together.

This defines a future development workflow; it does not claim agents were used to produce this draft. Roles can run sequentially through separate task invocations; simultaneous agents are not necessary.

Each handoff records task ID, requirement IDs, source revision, permitted paths/actions, changed files, rationale, tests run/results, known gaps and next action. Keep prompts, role definitions, runners and grader-facing scripts under workflow/. Natural exceptions include CI files in .github/workflows/ and specs in spec/. Explain these in the developer guide.

Suggested future artifacts:

- workflow/README.md and role prompts for analyst, architect, implementer and reviewer/tester.
- workflow/handoffs/ for task evidence; workflow/evaluations/ for security and AI evaluation rubrics.
- logs/YYYY-MM-DD-task.md with human-verified summaries, no secrets.
- docs/Reflections.md with concrete examples of injection attacks, guardrail tests, human gates, specification changes and handoff mistakes.

## 13. Assumptions

| ID | Starting assumption |
| --- | --- |
| ASM-01 | Anonymous visitors can browse; authenticated Users author reviews/reports and use summaries |
| ASM-02 | Reports target users through a specific Review; profile-only reports are deferred |
| ASM-03 | One account has one role; admins do not post reviews as admins |
| ASM-04 | One editable Review per User/Movie, rated on a 1–10 integer scale |
| ASM-05 | Movie deletion is reversible archival; evidence is retained privately |
| ASM-06 | No email delivery, social sign-in or self-service password reset in the first release |
| ASM-07 | Selected: Next.js/TypeScript frontend and backend on Vercel; PostgreSQL on Supabase. Target free tiers; eligibility and operational limits require deployment checks |
| ASM-08 | English is the initial UI/evaluation language; text may contain Unicode |
| ASM-09 | AI uses sampled/bounded evidence and human oversight, never automatic sanctions |
| ASM-10 | Numeric performance, retention and application-rate limits are initial design targets |

## 14. Open Questions / Approved Exceptions

| ID | Decision needed | Resolution required by |
| --- | --- | --- |
| OQ-01 | Verify SoC endpoint/authentication, models, context, quotas, retention and permitted data | Before provider integration and production enablement |
| OQ-02 | Verify Vercel Hobby eligibility/repository deployment, Supabase project allocation, regions, and environment-specific SoC quota partitioning; stack selection is resolved | Before infrastructure implementation |
| OQ-03 | Confirm user-report scope, anonymous access and proposed account recovery scope | Before respective product flows |
| OQ-04 | Approve moderation policy, suspension/restoration rules and handling of contested decisions | Before moderation/AI acceptance |
| OQ-05 | Confirm retention, operator deletion process and privacy notice | Before production |
| OQ-06 | Assign developer names; confirm shared ownership and tester accounts | Before task allocation/release |
| OQ-07 | Select optional watchlist, spoiler handling, filters or admin statistics | Only after core scope is on track |
| OQ-08 | Confirm product name, repo naming requirement and official deadline | Before release |
| OQ-09 | Verify host meets backup, restore and performance targets | Before production acceptance |

Approved exceptions: none.

Design decision D-01: AI may prioritise reports but never silently exclude them from admin access. This is the proposed treatment of the user's optional AI-valid-only view, because incomplete or mistaken analysis must not prevent human inspection.

Design decision D-02: Use reproducible random sampling of at most 20 Reviews, minimum 3, with revision-based invalidation and a 24-hour cache. These are starting defaults, not course-imposed numbers.

Design decision D-03: Use Next.js for frontend/backend on Vercel and PostgreSQL in Supabase, targeting the free tiers. See [tech-stack.md](tech-stack.md) for assessment and verified documentation links.

Design decision D-04: Replace the originally proposed persistent AI worker with bounded request-driven execution and persisted deduplication/status records. No background queue or frequent cron is required for the initial release. This keeps deployment within the chosen stack.

Suggested enhancements, in priority order: private watchlist; spoiler controls; genre filters; admin report-age/AI-failure statistics. Each requires its own requirement and acceptance update before implementation.

## 15. References

- [Selected stack assessment and platform references](tech-stack.md), checked 8 October 2026; account allocations and plan limits must be rechecked before deployment.
- User's project proposal and requested 15-section structure, supplied in this conversation on 8 October 2026.
- [SoC LLM guide](https://dochub.comp.nus.edu.sg/cf/guides/soclaas/start): referenced by the brief; access attempt during drafting failed, so provider details remain unverified.
- Repository README: project identifier CS3227-2610-MP3.
