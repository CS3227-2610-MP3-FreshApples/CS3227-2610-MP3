# S-07 UI-shell final remediation

Human-approved single increment:

- [ ] Correct `ConfirmDialog` control and keyboard dispatch so each user action invokes exactly its matching callback once; remove the unsafe legacy wrapper and add interaction-level tests.
- [ ] Adopt K12 `LiveRegion({ message })` and extend `TableState` through loading, empty, error, stale, and success with accessible text semantics and tests.
- [ ] Run focused and full unit tests, lint, type-check, scope/import and agent-name audits, bounded build, visual diff, and deterministic grading; record unavailable browser/build evidence accurately.

