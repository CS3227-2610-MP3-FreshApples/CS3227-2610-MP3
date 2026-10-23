# Zi Yang's Reflection

GitHub username: **Lim-ZY**  
Reflection date: **22 October 2026**

My main responsibility as Developer A was the User side of the application, identity and session security, public APIs, reviews, reporting, and shared API/UI foundations. My contributions included the HTTP API kernel, registration and login, session management, CSRF protection, public movie and announcement browsing, review submission and editing, private review views, report submission and history, and User-facing interfaces. I also contributed to shared security and AI-safety discussions, reviewed Developer B’s work, and implemented user-side security and AI-containment tests.

Using AI helped me explore implementation options and generate tests quickly, but it also made verification more important. A few issues were only discovered when the specification was reviewed carefully, when an independent reviewer agent challenged the implementation, or when concurrency and privacy cases were tested explicitly by a tester agent.

## AI Security

AI safety and security were shared team concerns. Although Gabriel owned most of the AI runtime and admin moderation implementation, my user-side features supplied untrusted review and report content to the wider system. I also participated in the shared AI security decisions and contributed to containment and authorization testing.

### What attack surfaces did I consider?

The main attack surface was text content submitted by users as part of the movie reviews. Review bodies and report explanations could contain malicious instructions. A malicious review could also pretend to be a system message or attempt to influence a future summary generated from several reviews.

This is an indirect prompt injection because the attacker does not control the application’s system instruction directly. Instead, the attacker places instructions inside content that the application retrieves and sends to the model.

We also considered attacks outside the LLM itself:

- A user guessing another user’s review, report, or evidence ID.
- A browser sending a cross-origin request to mutate a review or submit a report.
- A malicious user repeatedly editing reviews or creating reports to exhaust resources.
- An old AI result being applied after a review had changed or an admin had acted.
- A malformed model response containing invented quotations, unknown fields, excessive text, or unsafe characters.
- Agent-produced patches, handoffs, or reference material containing misleading instructions.
- Secrets accidentally entering client code, logs, tests, or AI prompts.

This made me distinguish between security and safety. A prompt injection is an attack, but an AI agent misunderstanding a requirement or changing an unrelated security boundary can also create harm without a malicious user. Hence I found testing by invoking a testing agent to check whether requirements are actually met was very useful and important during the SDD process.

### What protections did I implement, and how were they tested?

At the application boundary, I implemented authentication, role and account-status checks, ownership checks, CSRF protection, same-origin validation, rate limiting, and private response projections. User-facing APIs do not return database records directly. They expose only the fields appropriate for the current User and route.

For reviews and reports, the system enforces that:

- Users can modify only their own reviews.
- Users can view only their own report history and evidence.
- Reported-user information and received reports are not exposed to the reporter.
- Review and report mutations require valid CSRF and same-origin checks.
- Stale updates are rejected using versioned `If-Match` checks.
- Duplicate reports are rejected deterministically.
- Review and report content is length-limited and stored as plain text.
- Public and private projections are kept separate.
- Private responses are not placed into shared caches.

The AI-related protections are similarly based on containment rather than trusting the model. AI receives only the minimum relevant review data, has no direct database access or action tools, and cannot directly accept reports, add strikes, suspend accounts, or override an Admin decision. Model output is validated before it can affect application state. Moderation results are also guarded by content revisions and captured versions so that late output cannot overwrite newer User or Admin actions.

The User-side AI containment work added deterministic adversarial fixtures and authorization tests. These tests checked that malicious review or report content did not cross privacy boundaries and that a normal User could not access Admin-only resources. An important lesson was that mocking an authorization guard is not enough to prove authorization. The later database-backed security matrix tested a real registered User against Admin movie, report, and user-management endpoints.

Sources: [security specification](../spec/security.md), [A#11 security-test handoff](../workflow/handoffs/A-11/2026-10-22-readiness.md), [U-02c implementation and review](../logs/2026-10-21-u02c-review-remediation.md), and [U-03 report implementation](../logs/2026-10-21-u03-iteration-3.md).

### What limits and human oversight did I use?

The application applies several limits:

- Review mutations are rate-limited per User.
- Report creation is rate-limited per User.
- Request bodies and free-text fields have strict size limits.
- AI input and output have bounded sizes.
- AI retries, execution duration, concurrency, and provider requests are limited.
- Scheduler leases prevent duplicate AI work.
- Stale content revisions prevent late results from being published.
- Failed or uncertain moderation results remain available for human review.

The most important limit is that AI does not have authority over high-impact actions. Only validated application services and human Admin actions can hide reviews, accept reports, add strikes, suspend accounts, or revoke sessions.

Human oversight was also present in the development workflow. Analyst and reviewer outputs were treated as proposals rather than approvals. Implementation continued only after the human approved the relevant scope or specification decision. Independent reviewers could challenge the implementation after it appeared complete. I found this multi-agent process to be helpful in scrutinising each step of the implementation, and actually aids me in overseeing the project.

These controls still have limitations. Deterministic fake-provider tests show that the application handles benign, malformed, and adversarial outputs correctly, but they do not prove that the live SoC LLM will always classify content accurately or resist every possible prompt injection. Similarly, some production build, browser E2E, and release checks remained unavailable because of environment limitations. I should therefore avoid presenting passing unit and integration tests as proof of complete production readiness.

## Spec-Driven Development

### What should be clear before implementation starts?

A useful specification must define more than the main success case. For a user feature, it should make clear:

- Who may perform the action.
- Which records the User may access.
- The exact input fields and limits.
- The response projection and privacy boundary.
- Error codes and status responses.
- Concurrency and versioning behaviour.
- Transaction boundaries.
- Rate limits and security requirements.
- Behaviour when dependent services or AI providers fail.
- The negative cases that must be tested.
- Which part of the work is explicitly out of scope.

For example, “allow users to edit reviews” was not precise enough by itself. We needed to define ownership, edit validation, deletion behaviour, review versions, stale updates, moderation re-screening, public visibility, and the behaviour of an unchanged body with a changed rating.

The [architecture specification](../spec/architecture.md) also clarified the division between Route Handlers, services, repositories, adapters, and UI components. This prevented UI code from accessing the database or the LLM directly and made the boundaries reviewable before implementation.

I found a specification precise enough when an analyst could write acceptance examples and an implementer could write tests without inventing new product behaviour. If two reasonable implementations could produce different security or privacy outcomes, the decision was not yet sufficiently specified.

Hence in general, I think that a clear specification should have a good acceptance criteria that is easy to check by the AI.

### How did changes flow through the project?

The intended flow was:

1. Identify the missing or changed requirement.
2. Update the specification or contract.
3. Obtain human approval.
4. Implement the change in a bounded task.
5. Update unit, integration, security, and UI tests.
6. Update the handoff, plan, guide, and interaction log.
7. Re-run the applicable verification checks.

The review features demonstrated why this sequence mattered. During U-02c, the requirement that changed review content should trigger moderation had to be connected carefully to transaction ordering, review revision changes, deletion cancellation, and post-commit dispatch. An independent review later found that a rating-only edit could incorrectly dispatch existing moderation work. The implementation and tests were then corrected.

The review-edit UI also required a specification decision about exposing a safe integer version in the User’s own-review projection. The version was recorded before it was used for `If-Match` editing. This avoided silently adding a concurrency contract through the UI implementation.

SDD did not mean that the first specification was perfect. It meant that new discoveries were recorded explicitly rather than being hidden inside implementation assumptions. So some specifications had to be updated along the way.

### How did tests check intent rather than wording?

The project used more than happy-path tests. My work included tests for:

- Unauthenticated, wrong-role, suspended, and inactive accounts.
- Cross-user access and guessed IDs.
- Missing, invalid, expired, or wrongly bound CSRF tokens.
- Cross-origin browser requests.
- Duplicate reports.
- Private report evidence leakage.
- Stale `If-Match` versions.
- Concurrent review updates.
- Review deletion and moderation-work cancellation.
- Malformed API responses and invalid UI data.
- Empty, loading, unavailable, and error states.
- AI containment and User-to-Admin denial cases.

A particularly important lesson came from independent review. An early authorization test mocked the guard, which made the test pass without proving that a real user was denied access. The test was strengthened with a database-backed authorization matrix. This showed me that a high test count is not enough. Tests must cross the actual security boundary and fail when the protection is removed.

The U-02c review remediation also showed the value of negative cases. The reviewer found a defect involving a rating-only edit and moderation dispatch. Adding a test for that case connected the implementation to the actual domain intent rather than merely checking that the endpoint returned a success response.

## Basic Multi-Agent Software Engineering

### Which parts benefited from specialised agents?

The analyst role was useful for finding missing requirements, conflicts, and acceptance examples before implementation. The architect role examined module boundaries, transactions, concurrency, privacy, and security implications. The implementation agent made bounded changes. The code-quality and test-generation agent looked for missing negative cases, while the reviewer/tester independently challenged the implementation against the specification.

This division was especially useful for review moderation and report submission. The implementation could appear correct locally, but independent review identified privacy, dispatch, validation, and concurrency cases that needed stronger evidence.

The roles were not substitutes for human judgement. They helped create different viewpoints, and I still had to decide whether a proposed specification change was acceptable and whether a task could proceed.

With different viewpoints, the app can be made more robust since a junior developer might not be able to spot that many bugs by his own. Hence multiple specialised agents helped in this SDD process.

### How should specialised agents be built and tested?

Each agent needs:

- A clear role and objective.
- A defined source of truth.
- Permitted paths and actions.
- Explicit exclusions.
- A required handoff format.
- A stopping condition when the specification is incomplete.
- A requirement to report skipped or unavailable tests.
- No authority to approve its own work or deploy production.

The workflow definitions under `workflow/agents/` helped make these boundaries explicit. Read-only reviewers were not allowed to silently modify the code they were reviewing. Implementation agents were expected to work only within approved paths. Test-generation agents were expected to derive tests from requirements rather than merely matching the current implementation.

Agents should be evaluated by evidence, not confidence. A review that cannot run a required test must say so. A passing result is meaningful only when the source revision, environment, and command are recorded.

### What information must pass between agents?

A useful handoff should include:

- Task and requirement IDs.
- Source revision.
- Approved scope and exclusions.
- Relevant specification and contract decisions.
- Dependencies and assumptions.
- Changed files.
- Tests and exact results.
- Unverified or unavailable checks.
- Security and privacy concerns.
- Remaining risks.
- The next required human action.

Without this information, the next agent may work against stale code, repeat an already rejected assumption, or even re-implement a specification differently.

### Where could errors or malicious instructions slip through?

An analyst could misunderstand the specification, an architect could accept an unsupported recommendation, and an implementation agent could treat that recommendation as an approved requirement. A reviewer could also inspect the wrong branch or an earlier source revision.

The same problem can occur with malicious or misleading instructions in issue text, reference documents, generated patches, or handoffs. The project therefore treated those materials as untrusted data and required claims to be checked against the approved specifications, source code, tests, and Git state.

One practical lesson was that multiple agents do not automatically provide independent judgement. If every agent starts from the same incorrect assumption, they may all agree on the wrong result. Human review and explicit evidence are still necessary.

## Overall reflection

The most important lesson to me was that AI-assisted development increased both speed and verification responsibility. AI was effective at producing scaffolding, implementation candidates, tests, and review checklists. However, it could not be trusted to decide whether a requirement was complete, whether an approval had really occurred, or whether a passing test demonstrated the intended security property. A human is still needed to validate the outputs and ensure the security and robustness of the system.

Another insight I got from using multi-agents in this project was that some things can actually be made more complicated by using multiple agents. This is due to the overhead of passing information around and orchestrating these agents. Moreover, it is not easy to identify tasks that can be done in parallel with one another, and have different agents work on them concurrently, if specs are not well defined. So if I were to repeat the project, I would plan early and find out what tasks can be done in parallel such that they have minimal dependencies. I think this would definitely make the multi agent process smoother.

My strongest contribution was learning to connect user features to the wider security and specification boundaries. Authentication affected every protected route. Review ownership affected private projections, UI states, and moderation. Report privacy affected both database queries and client validation. AI safety affected not only the model prompt but also transactions, revisions, leases, output schemas, and human Admin authority.

If I repeated the project, I would record direct approval evidence more systematically, and identify potential for using even more specialised agents earlier. I would also ask agents to produce smaller, independently verifiable changes. The most useful AI output was often not generated code, but a failing test, an identified ambiguity, or a concrete explanation of why a proposed implementation could violate the specification. I hope these insights I got would turn into implementation in the next mini project.