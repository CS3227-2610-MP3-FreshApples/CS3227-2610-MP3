# A#12 current-implementation guide update

## Human verification summary

The user requested another User Guide update after the repository was updated.

## Interaction and scope

- Compared the committed guide with the current branch implementation after the repository merge.
- Confirmed that Users can now edit existing reviews from movie details pages.
- Confirmed that the Admin Users workspace now supports filtering, display-name search, suspension, and reinstatement.
- Updated the guide to document these workflows and their current constraints, including session revocation and fresh-login behavior.
- Preserved the existing structured ordering for User workflows and the grouped Admin workspace.

## Validation

- `git diff --check` passed after the update.
- MarkBind build from `docs/` is required after this change and will be recorded with the final handoff.

## Human follow-up

Review the new review-editing and User-account-management instructions against the deployed UI before release. No commit or push was performed in this session.
