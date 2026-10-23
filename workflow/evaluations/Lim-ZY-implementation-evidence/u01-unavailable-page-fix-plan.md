# U-01 public-read unavailable-state correction

User-approved correction: public catalogue and announcement pages must not throw when
the server composition cannot provide their read service.

- [x] Add a focused regression test for null public-read services.
- [x] Render a safe, accessible unavailable state on the three affected public pages.
- [x] Run focused and repository checks, review the diff, and capture visual evidence.
