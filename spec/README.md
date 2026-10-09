# Project Specification

Status: starting specification, version 0.2, 8 October 2026. Working product name: FreshApples.

This set defines intended behaviour, not an implemented system. "Must" denotes an acceptance requirement. Numerical limits and technology choices are proposed defaults unless explicitly identified as course constraints. Resolve blocking questions before the relevant implementation begins. The course requirements take precedence; record product changes here before changing code and tests.

## Specification map

The section numbers below preserve the requested project-specification structure across focused files.

| Sections | Canonical document |
| --- | --- |
| 1. Product Overview; 2. Users and Roles; 3. Domain Model; 4. Functional Requirements; 5. User Experience | [product.md](product.md) |
| 6. Technical Architecture; 9. Non-Functional Requirements | [architecture.md](architecture.md) |
| Selected technology stack, free-tier assessment and hosting caveats | [tech-stack.md](tech-stack.md) |
| 7. Data Model | [data-model.md](data-model.md) |
| 8. Interfaces and Contracts | [api.md](api.md) |
| 9.3 Security; 9.4 Privacy, expanded | [security.md](security.md) |
| AI feature algorithms and provider contracts, expanding 4 and 8 | [ai.md](ai.md) |
| 10. Runtime / Deployment Requirements | [deployment.md](deployment.md) |
| 11. Verification Requirements | [verification.md](verification.md) |
| 12. Constraints; 13. Assumptions; 14. Open Questions / Approved Exceptions; 15. References | [governance.md](governance.md) |

Read product, architecture and data model first. API contracts must follow the product invariants; security applies to every component. Requirement IDs are stable links between specifications, implementation tasks and tests.

## Initial scope

Deliver text-only movie listings, movie details, reviews, user reports, announcements, separate User and Admin interfaces, public scheduled AI review summaries, and automatic AI profanity moderation for every new Review. Watchlists and other enhancements are optional. Build one Next.js/TypeScript application on Vercel with clear module boundaries, Supabase-hosted PostgreSQL, and bounded scheduled-summary and submission-triggered moderation with automatic recovery.

Next.js on Vercel and PostgreSQL on Supabase are selected. The target is free-tier hosting with the operational constraints recorded in [tech-stack.md](tech-stack.md). SoC provider-specific facts remain open. The SoC LLM guide could not be retrieved during drafting; no quota or supported model is claimed as verified.
