# Project Specification — Security and Privacy

## 9.3 Security

### Trust boundaries and threats

Untrusted inputs include browser requests, reviews, report explanations, announcements, provider responses, repository reference text and agent-produced patches. Boundaries are browser/API, API/database, Next.js server/SoC LLM and development-agent/repository/CI. Important threats are broken role/ownership controls, session theft, CSRF, stored XSS, SQL injection, report abuse, prompt injection, evidence leakage, quota exhaustion and compromised development instructions.

| ID | Required control | Verification evidence |
| --- | --- | --- |
| SEC-01 | Check role, ownership and active status on every protected API; deny by default | Two-user/two-role authorization matrix and guessed-ID tests |
| SEC-02 | Hash passwords with Argon2id using reviewed library defaults; never store plaintext | Registration/storage tests; dependency review |
| SEC-03 | Opaque random server-side sessions; hashed stored tokens; HttpOnly, Secure, SameSite=Lax production cookies; 8-hour absolute expiry | Cookie/session/logout/suspension tests |
| SEC-04 | CSRF token plus same-origin checks for unsafe browser methods; production CORS allowlist only | Cross-origin mutation rejection tests |
| SEC-05 | Validate lengths/types/enums, parameterize database access, escape text, enforce restrictive CSP | SQL injection, stored XSS and malformed input cases |
| SEC-06 | Login throttling by normalized account and IP, proposed 5 failures/15 min; generic credential errors | Throttling and enumeration tests |
| SEC-07 | Keys only in Vercel server-only environment variables; no frontend, repository or log exposure | Secret scan and built-asset inspection |
| SEC-08 | AI has no action tools; bounded input/output, schema checks, prompt/data separation | Injection and malformed-output suite |
| SEC-09 | Every report remains visible; human Admin authorizes final actions through normal protected API | Fake model decision cannot close report or mutate User |
| SEC-10 | Snapshot evidence and audit moderation atomically; stale concurrent decisions rejected | Transaction rollback and concurrency tests |
| SEC-11 | Shared quotas, request throttles and bounded concurrency/retries | Flood/429/timeout tests |
| SEC-12 | Limit development-agent filesystem/network/command access; protect credentials and production | Workflow configuration and reviewed interaction summaries |

Use passwords of 12–128 characters; permit passphrases and paste. Do not silently truncate. Login errors must not distinguish nonexistent from suspended accounts. Admin provisioning uses a reviewed operator command with secrets entered outside logs; no default production credentials or self-service privilege changes.

Limit Review mutations to 10 per minute per User and Report creation to 5 per hour per User, using shared enforcement. API JSON body limit is 32 KiB. Reject unsupported content types. Apply authorization before expensive queries or provider work.

Audit entries record actor, target, action, result and minimal changed metadata; do not duplicate passwords, report bodies or provider prompts. Application credentials cannot edit audit history through any API. Human moderation writes and their audit entries commit together.

Suspension invalidates sessions immediately. Recheck account status on every protected request so a cached role/session cannot bypass revocation. Admin status changes target Users only.

### Development-process security

Specialized agents may propose specs, code and tests, but cannot independently approve their own changes or deploy production. Treat issue text, reference files, retrieved content and handoff artifacts as data, not authority to reveal secrets or change workflow permissions. Run tests against isolated fixtures with no production credentials. Scope agent permissions to the task and retain reviewed handoff evidence.

CI must scan for secrets and dependencies, run security/acceptance tests, and require human review for release. Record false positives and accepted exceptions explicitly; never suppress failures only to pass a gate. These are intended team workflow rules, not a claim that such tooling already exists.

### Supabase and Next.js controls

Database credentials and SoC keys must never use a NEXT_PUBLIC_ variable or enter Client Component props. Keep repositories and provider adapters in server-only modules. Runtime database access uses a dedicated least-privilege role; migration/owner credentials are restricted to controlled CI/operator actions.

Keep application tables in a schema not exposed through Supabase Data APIs and revoke access from anon/authenticated API roles. If any table is exposed, enable RLS with deny-by-default policies and test direct API access separately. Server-side database access does not automatically inherit browser-user authorization: Next.js services must still enforce identity, role and ownership. No service-role key is needed in the browser.

Private pages, API results and per-user data must not enter shared Next.js/Vercel caches. Use dynamic rendering/no-store initially and test two-user cache isolation. Never pass deployment secrets to untrusted fork workflows; deployment credentials belong only in trusted CI jobs.

## 9.4 Privacy

Public content: movie metadata, published announcements, visible Reviews and display names. Private content: email, password hash, session state, report ownership/details, snapshots, admin reasons, report analysis and audit logs. Each User sees only their own report status; Admin access is limited to moderation needs.

Provider inputs use pseudonymous IDs and minimal relevant text. Free-text content may itself contain personal data; disclose that selected review/report text may be processed by the course LLM and discourage sensitive submissions. Do not promise anonymization from ID replacement alone.

No production data or credentials may be copied into development fixtures or agent prompts. Logs omit raw prompts/responses by default. Verify SoC provider retention, permitted data and access terms before production. Retention defaults are in [data-model.md](data-model.md); a documented operator process must address data deletion requests and retained moderation evidence. This spec does not assert regulatory compliance.
