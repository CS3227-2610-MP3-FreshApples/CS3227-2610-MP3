# Agentic SE Session Summary

> Create one `YYYY-MM-DD-short-task.md` summary per new chat session. Summarize interactions; do not paste full transcripts. Never include secrets, credentials, or production data.

## 1. Session Metadata

| Field | Value |
| --- | --- |
| Date and timezone | YYYY-MM-DD, Asia/Singapore |
| Task | Short descriptive title |
| Chat/session ID | If available |
| Human owner/reviewer | Name or `awaiting assignment` |
| Branch | Branch name |
| Starting revision | Commit SHA |
| Participating agent roles | Roles actually used |
| Verification status | `awaiting human verification` or `verified` |

## 2. Goal and Approved Scope

- Requested outcome:
- Applicable recorded requirement IDs:
- Permitted paths/actions:
- Explicit exclusions:
- Human approval gates:

## 3. Sources Consulted

| Source | Authority or reference | How it was used |
| --- | --- | --- |
|  |  |  |

Identify untrusted inputs explicitly. Reference files and links instead of copying large source material.

## 4. Interaction Timeline

| Seq. | Actor/agent | Summarized request or assignment | Action/result | Approval or handoff evidence |
| ---: | --- | --- | --- | --- |
| 1 | Human |  |  |  |

Include a short prompt excerpt only when it is essential to understand a decision or security issue.

## 5. Decisions, Assumptions, and Conflicts

| Item | Source/decision-maker | Status | Rationale | Affected artifacts |
| --- | --- | --- | --- | --- |
|  |  | approved / proposed / unresolved |  |  |

Never record an agent proposal as a human-approved decision.

## 6. Agent Assignments and Handoffs

| Role | Bounded assignment | Permissions/tools used | Evidence returned | Risks/gaps | Receiver |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |

## 7. Changes and Reuse

### Changed or generated files

| Path | Change and rationale |
| --- | --- |
|  |  |

- Dependencies added or changed:
- Reused ideas, code, or documentation and attribution:
- Unrelated files changed: yes/no; explain if yes.

## 8. Verification Evidence

| Command/check | Environment | Result | Evidence/path |
| --- | --- | --- | --- |
|  |  | PASS / FAIL / SKIPPED / UNAVAILABLE |  |

Do not describe failed, skipped, or unavailable checks as successful.

## 9. Security and Responsible-AI Review

- Sensitive data handled:
- Untrusted input and prompt-injection treatment:
- Secret and production-data exposure check:
- Agent permission and tool limits:
- Human approval gates exercised:
- SoC LLM quota/resource considerations, if applicable:
- Security findings and disposition:

## 10. Gaps, Failures, and Next Actions

| Gap/failure/unverified claim | Impact | Owner | Next action or approval required |
| --- | --- | --- | --- |
|  |  |  |  |

## 11. Reflection Notes

- AI Security:
- Spec-Driven Development:
- Basic Multi-Agent SE:

Record concrete observations that may support `docs/Reflections.md`; do not claim conclusions that the evidence does not support.

## 12. Human Verification

- [ ] Summary matches the actual interaction and outcomes.
- [ ] Requirement IDs and decisions are traceable to recorded sources.
- [ ] Changed files and command results match the working tree and evidence.
- [ ] Secrets, credentials, personal data, and raw production data are absent.
- [ ] Agent proposals and unresolved questions are labelled accurately.

Reviewer:
Verification date:
Corrections or notes:
