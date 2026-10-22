# A#12 user-guide update from latest master

## Human verification summary

The user requested another User Guide update after the repository advanced beyond the guide branch.

## Interaction and scope

- Compared the guide branch with `origin/master`, which contained newer Admin and navigation UI changes.
- Updated the guide to describe the persistent Admin Dashboard link and Admin sign-out control on public and Admin pages.
- Documented the Back to admin dashboard link available on Admin subpages.
- Kept the existing review, report, account, catalogue, announcement, summary, and user-status workflows aligned with the current implementation.

## Validation

- `git diff --check` passed after the update.
- MarkBind build from `docs/` is required after this change and will be recorded with the final handoff.

## Human follow-up

Review the navigation wording against the latest deployed UI before release. No commit or push was performed in this session.
