# S-07 final remediation accessibility evidence

Branch: `feat/ui-shell`  
Iteration: `s07-ui-shell-remediation-final`

- [x] Dialog controls: Cancel is a native `button` and calls only `onCancel`; Confirm is the form submit control and calls only `onConfirm` after preventing navigation.
- [x] Keyboard cancellation: the native dialog `cancel` event (the Escape interaction) prevents browser dismissal and invokes `onCancel` once.
- [x] Keyboard confirmation: submitting the rendered form invokes `onConfirm` once; the confirmation control remains labelled by its visible text.
- [x] Dialog labels: heading names the requested action and target; description states the consequence; no authorization claim is present.
- [x] Live updates: `LiveRegion({ message })` is `role="status"`, `aria-live="polite"`, and `aria-atomic="true"`; it does not move focus.
- [x] Table states: loading, empty, stale, and success use `role="status"`; error uses `role="alert"`; each state has visible text instead of colour-only meaning.

## Runtime limitations

Browser automation is not installed in the unit-test environment, so the interaction evidence invokes handlers on the rendered React controls rather than a browser DOM. `npm run build` was attempted with a 60-second limit and failed immediately because Turbopack could not create/bind a subprocess in this sandbox (`Operation not permitted`). Runtime browser and responsive-layout verification remain unverified.
