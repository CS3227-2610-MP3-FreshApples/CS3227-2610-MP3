# S-07 remediation accessibility checklist

Iteration: `s07-ui-shell-remediation-iteration-4`  
Branch: `feat/ui-shell`

This is a source-and-unit-evidence checklist for the completed remediation cycle. Browser automation and a production build were unavailable in this environment, so runtime visual and keyboard claims remain unverified.

- [x] Focus order: native links, form controls, pagination links, and dialog buttons remain keyboard reachable in source order; focus-visible classes are present on interactive primitives.
- [x] Dialog interaction: the dialog is rendered only when open, names the target in its heading/description, submits confirm through the callback, and maps Escape to cancel.
- [x] Headings and landmarks: route-shell behavioral tests verify one `main` landmark per rendered route; the dialog uses an `h2` and route placeholders use page headings.
- [x] Errors: `FormField`/`TextField` associate hint and error IDs through `aria-describedby`, set `aria-invalid`, and expose the error with `role="alert"`.
- [x] Live region: the existing `LiveRegion` uses `role="status"` and `aria-live="polite"`; table empty state and status primitives expose textual status.
- [x] Responsive layout: the remediation preserves structural, text-first primitives without fixed-width controls; browser viewport inspection is UNVERIFIED because build/browser automation was unavailable.

## Runtime gaps

- `npm run build` was attempted and failed with a Turbopack panic while processing CSS: `Operation not permitted (os error 1)` while binding to a port. Build is unverified, not a pass.
- No browser automation or manual viewport session was available; visual and live keyboard runtime checks remain unverified.
