# U-01 iterative-TDD implementation plan

Confirmed scope: implement Developer A's public catalogue and announcement reads under U-01. U-01 owns active movie list/search, active movie detail metadata and visible-review aggregates, and published announcement reads. U-02 owns visible review listings and `GET /movies/:id/reviews`. Public pages are Server Components calling read services directly; Route Handlers remain the versioned HTTP contract.

Approved decisions recorded in `../../../spec/governance.md` D-79:

- Archived associated Movies leave announcements public, with `movie: null`.
- `release_desc` places null release dates last; ID tie-breakers are ascending.
- Omitted, empty, and whitespace-only `q` values mean no title filter; non-empty `q` is trimmed and capped at 200 Unicode code points.
- Announcement DTO: `id`, `publishedAt`, `title`, `body`, and `movie`.

## Checklist

- [x] Increment 1 — Define public read DTOs, validation, and repository/service contracts; add red/green unit and contract tests for query normalization, stable ordering inputs, and public projection shape.
- [x] Increment 2 — Implement PostgreSQL movie list/detail and announcement read queries; add integration tests for active/archive filtering, aggregates, announcement state, archived movie references, pagination, and stable ordering. Evidence: `_temp/u01-iteration-2-evidence.json` and deterministic grade PASS.
- [x] Increment 3 — Add public GET Route Handlers using K2; add API integration tests for envelopes, request IDs, no-store, validation, 404s, and safe dependency failures. Evidence: `_temp/u01-iteration-3-evidence.json`, semantic second-pass PASS, and deterministic grade PASS.
- [x] Increment 4 — Replace public placeholders with Server Component pages using the read services; add rendering tests for loading/empty/error/success states and text-only accessible projections. Evidence: `_temp/u01-iteration-4-evidence.json`, semantic second-pass PASS, and deterministic grade PASS.
- [ ] Increment 5 — Run full applicable validation, visual diff, deterministic iterative-TDD grading, and prepare the scoped conventional commit for human review.

Every increment must have a red test before production edits, a green focused test, repository-required validation, iteration-scoped evidence, and explicit human approval before the next increment.
