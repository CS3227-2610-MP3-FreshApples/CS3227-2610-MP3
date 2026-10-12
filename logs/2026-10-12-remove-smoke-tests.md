# AI Interaction Summary: Remove temporary smoke tests

| Field | Value |
| --- | --- |
| Date | 2026-10-12 |
| Task | Remove temporary SoCLaaS and Supabase smoke tests after human confirmation |
| Branch / base revision | `soc-llm-test` @ `38d14a6` (with uncommitted spec confirmations) |
| Tool | Claude Code (Claude Opus 5.5) |
| Human verification | Pending |

## Request

Human confirmed both smoke tests pass and asked to remove the smoke tests and their instructions, keeping the record that the constraints were confirmed.

## Changed files

| File | Change |
| --- | --- |
| `src/app/api/smoke/` | Deleted (`soclaas` and `supabase` temporary routes), as explicitly requested |
| `README.md` | Removed both smoke test sections |
| `.env.example` | Removed `SMOKE_TEST_TOKEN` placeholder |
| `spec/tech-stack.md` | Dropped "verify with a smoke test" instruction; kept confirmation and evidence link |
| `spec/deployment.md` | Reworded "Verify that..." as a requirement; kept confirmation |

Confirmation statements and evidence logs (`logs/2026-10-11-*`) retained unchanged.

## Checks

- `npm run lint`: see session output.
- `npx tsc --noEmit`: only errors are stale `.next/` generated types referencing the deleted routes; cleared by the next `npm run dev`/`npm run build`.

## Follow-up (human)

- Remove `SMOKE_TEST_TOKEN` from `.env.local` and Vercel environment variables.
- Drop `app.smoke_env` / `app.smoke_check` tables in Supabase dev and prod if no longer needed.
- `pg` dependency retained: it is the selected driver in `spec/tech-stack.md`.
