# U-01 Cache Components compatibility correction

- Task: resolve the reported Next.js 16.4 Cache Components build errors.
- Scope: only incompatible route-segment configuration declarations in U-01 public pages and GET Route Handlers.
- Baseline: `/tmp/u01-iteration-5-baseline-qLwDFW`, commit `6aa640cea47304b49c3c926071d9c5150fae5430`.

## Change

Removed the three `dynamic = "force-dynamic"` page exports and the three `runtime = "nodejs"` Route Handler exports. With `cacheComponents: true`, Next.js rejects these legacy segment configurations; removing them preserves the default Node.js Route Handler runtime and lets Cache Components control request-time behavior.

## Verification

- Reported Turbopack build failure — red evidence: rejected `dynamic` declarations, then rejected `runtime` declarations after the first fix.
- `tests/unit/catalogue/public-pages.test.ts` — PASS; 4 tests.
- `tests/unit/catalogue/public-api-routes.test.ts` — PASS; 6 tests.
- `npm run test:unit` — PASS; 48 files, 716 tests.
- `npx tsc --noEmit` — PASS.
- `npm run lint` — PASS.
- `git diff --check` — PASS.
- Turbopack build — route-config errors resolved; unavailable beyond the CSS-worker sandbox permission failure.
- Webpack build — unavailable due the existing TypeScript `--showConfig` parsing failure.

No dependency, migration, specification or API behavior changed, and no commit was created. Visual review: `_temp/u01-cache-components-compat-visual-diff.html`.
