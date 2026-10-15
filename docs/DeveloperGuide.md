# Developer Guide

This guide will document the FreshApples architecture, development workflow, setup, and acknowledgements as implementation progresses.

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
