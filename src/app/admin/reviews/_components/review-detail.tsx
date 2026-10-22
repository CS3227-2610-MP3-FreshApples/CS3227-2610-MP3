"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { ConfirmDialog } from "../../../../components/confirmation-dialog";
import { FormField } from "../../../../components/form-primitives";
import { LiveRegion, StatusMessage } from "../../../../components/status-primitives";
import { linkClass, secondaryButtonClass } from "../../_components/admin-feedback";
import { approveReview, getReview, hideReview, restoreReview, validateReviewReason, type ReviewTransition } from "../../_lib/review-client";
import type { AdminResult } from "../../_lib/admin-http";
import { useAdminResource } from "../../_lib/use-admin-resource";
import { ReviewSource } from "./review-source";
import { ReviewState, visibilityMessage } from "./review-state";

type Action = Readonly<{
  label: string;
  consequence: string;
  run: (id: string, version: number, reason: string) => Promise<AdminResult<ReviewTransition>>;
}>;
const APPROVE: Action = {
  label: "Approve review", run: approveReview,
  consequence: "Approve the current text as a human decision. This does not undo author deletion or an Admin hide, and an archived Movie remains non-public. No strike is added.",
};
const HIDE: Action = {
  label: "Hide review", run: hideReview,
  consequence: "Hide this review from public view and cancel outstanding automatic assessment work. No strike is added.",
};
const RESTORE: Action = {
  label: "Restore review", run: restoreReview,
  consequence: "Remove the Admin hide only. Pending or flagged text stays unpublished; deletion and Movie archive state are preserved. Eligible pending work resumes automatically later.",
};

export function ReviewDetail({ reviewId }: Readonly<{ reviewId: string }>) {
  const load = useCallback(() => getReview(reviewId), [reviewId]);
  const { state, reload, replace } = useAdminResource(load);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<Action | null>(null);
  const submitting = useRef(false);
  const reasonControl = useRef<HTMLTextAreaElement>(null);

  function prepare(action: Action) {
    if (busy || stale) return;
    const invalid = validateReviewReason(reason);
    setReasonError(invalid);
    setError("");
    setAnnouncement("");
    if (invalid !== "") { reasonControl.current?.focus(); return; }
    setConfirmation(action);
  }
  async function confirm() {
    if (confirmation === null || state.status !== "ready" || submitting.current) return;
    const action = confirmation;
    const review = state.value;
    submitting.current = true;
    setConfirmation(null);
    setBusy(true);
    setAnnouncement("Saving moderation decision…");
    try {
      const result = await action.run(review.id, review.version, reason);
      if (!result.ok) {
        setError(result.message);
        setAnnouncement("Moderation decision could not be completed.");
        setReasonError(result.fieldErrors?.reason?.join(" ") ?? "");
        setStale(result.kind === "stale" || result.kind === "conflict");
        return;
      }
      const saved = result.value;
      replace({ ...review, version: saved.version, moderationState: saved.moderationState, hidden: saved.hidden, deleted: saved.deleted });
      setReason("");
      setReasonError("");
      setAnnouncement(`${action.label}: ${saved.version === review.version ? "no change was needed; the reason was recorded." : "decision saved."} ${visibilityMessage({ ...review, ...saved })}`);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  function loadLatest() {
    setStale(false);
    setError("");
    setAnnouncement("Loading the latest review. Your reason has been kept.");
    reload();
  }

  return <section className="space-y-6">
    <p><Link className={linkClass} href="/admin/reviews">All reviews</Link></p>
    <h1 className="text-2xl font-semibold">Review detail</h1>
    <LiveRegion message={announcement} />
    {state.status === "loading" ? <StatusMessage status="info">Loading review…</StatusMessage> : null}
    {state.status === "error" ? <StatusMessage status="error">{state.failure.message}</StatusMessage> : null}
    {error !== "" ? <StatusMessage status="error">{error}</StatusMessage> : null}
    {state.status === "ready" ? <>
      <header className="space-y-3">
        <h2 className="text-xl font-semibold">Review by {state.value.authorDisplayName} for “{state.value.movieTitle}”</h2>
        <ReviewState review={state.value} />
        <p>{visibilityMessage(state.value)}</p>
      </header>
      <ReviewSource review={state.value} />
      <section aria-labelledby="human-decision-title" className="space-y-4 rounded-lg border border-slate-300 bg-white p-5">
        <h2 className="text-xl font-semibold" id="human-decision-title">Human moderation decision</h2>
        <p>Explain your decision. Your reason is recorded in the private audit history.</p>
        <FormField label="Reason" name="reason" hint="10–1,000 characters after trimming." error={reasonError}>
          <textarea ref={reasonControl} rows={4} value={reason} disabled={busy || confirmation !== null}
            onChange={(event) => setReason(event.target.value)} />
        </FormField>
        {stale ? <div className="space-y-2">
          <p>Your reason has been kept. Load and read the latest text before confirming another decision.</p>
          <button className={secondaryButtonClass} onClick={loadLatest} type="button">Load latest version</button>
        </div> : null}
        <div className="flex flex-wrap gap-3">
          {state.value.moderationState !== "cleared" ? <button className={secondaryButtonClass} disabled={busy || stale} onClick={() => prepare(APPROVE)} type="button">Approve review</button> : null}
          {state.value.hidden
            ? <button className={secondaryButtonClass} disabled={busy || stale} onClick={() => prepare(RESTORE)} type="button">Restore review</button>
            : <button className={secondaryButtonClass} disabled={busy || stale} onClick={() => prepare(HIDE)} type="button">Hide review</button>}
        </div>
      </section>
      <ConfirmDialog open={confirmation !== null} title={confirmation?.label ?? "Confirm decision"}
        targetName={`Review by ${state.value.authorDisplayName} for “${state.value.movieTitle}”`}
        consequence={`${confirmation?.consequence ?? ""} Reason: ${reason.trim()}`}
        confirmLabel={confirmation?.label ?? "Confirm"} dialogId="review-decision-dialog"
        onCancel={() => setConfirmation(null)} onConfirm={() => { void confirm(); }} />
    </> : null}
  </section>;
}
