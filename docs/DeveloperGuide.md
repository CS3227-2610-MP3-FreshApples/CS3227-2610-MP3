# Developer Guide

This guide will document the FreshApples architecture, development workflow, setup, and acknowledgements as implementation progresses.

## Admin Review API (A-04)

Active Admin sessions can read `/api/v1/admin/reviews` and `/api/v1/admin/reviews/:id`.
The list defaults to all Reviews, including retained hidden/deleted rows, with `page` and `pageSize`,
optional `movieId` and `assessment` filters, and stable `updated_at DESC, id ASC` ordering.
Filter values and projections are recorded in `spec/api.md` under A-04 API detail.
Historical assessments include their content revision; they do not describe newly edited text.

POST `approve`, `hide` or `restore` beneath `/api/v1/admin/reviews/:id` with a JSON `reason`
(10–1,000 trimmed Unicode code points), the quoted current version in `If-Match`, and the normal
session-bound CSRF token and same-origin header. Success returns the visibility/clearance state
and resulting ETag. Repeated transitions return 200 with the same version and an audited `no_op`;
a stale version returns 409 even for an otherwise redundant transition.

Moderation orchestrates K8, work updates and K5 in one transaction. Approval preserves deletion
and hidden state; restore only clears the Admin hidden flag. Pending, undeleted restored Reviews
stay unpublished while their current cancelled work is reactivated with attempt history preserved.
The recovery sweep performs screening later; these Admin routes never invoke the provider or add strikes.
The service works with AI disabled. Archived Movies remain non-public throughout these operations.

## Database roles (operator step)

Migrations never create login roles or set passwords (D-31). Before the first migration runs against a Supabase project, an operator creates the runtime role once in that project:

1. Connect with `psql` to the project's direct connection as the database owner.
2. Create the role with no elevated attributes:

   ```sql
   CREATE ROLE app_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
   ```

3. Set its password interactively with `\password app_runtime`. `psql` prompts for the password and sends only a hash. Never put the password in a SQL statement, a shell command, the Supabase SQL editor, the repository or a log.
4. Store the runtime connection string, which uses `app_runtime` through the transaction pooler, as the server-only `DATABASE_URL` in that environment's Vercel settings.

Supabase already provides the `anon` and `authenticated` roles. The initial migration fails and rolls back if `app_runtime`, `anon` or `authenticated` is missing. It revokes all access to schema `app` from `anon`, `authenticated` and `PUBLIC`, and grants `app_runtime` only the table privileges listed in `spec/data-model.md` "Runtime privileges" (D-32). The integration test harness creates the three roles as synthetic `NOLOGIN` roles in its disposable database.
