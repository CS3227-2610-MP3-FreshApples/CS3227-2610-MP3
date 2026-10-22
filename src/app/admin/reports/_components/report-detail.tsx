"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { ConfirmDialog } from "../../../../components/confirmation-dialog";
import { FormField } from "../../../../components/form-primitives";
import { LiveRegion, StatusMessage } from "../../../../components/status-primitives";
import { linkClass, secondaryButtonClass } from "../../_components/admin-feedback";
import { decideReport, getReport, validateReportReason, type ReportDecision } from "../../_lib/report-client";
import { useAdminResource } from "../../_lib/use-admin-resource";

export function ReportDetail({ reportId }: Readonly<{ reportId: string }>) {
  const load = useCallback(() => getReport(reportId), [reportId]);
  const { state, reload } = useAdminResource(load);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [choice, setChoice] = useState<ReportDecision | null>(null);
  const [busy, setBusy] = useState(false);
  const reasonControl = useRef<HTMLTextAreaElement>(null);
  function prepare(disposition: ReportDecision["disposition"], actions: ReportDecision["actions"]) { const invalid = validateReportReason(reason); setReasonError(invalid); if (invalid !== "") { reasonControl.current?.focus(); return; } setError(""); setChoice({ disposition, actions, reason: reason.trim() }); }
  async function confirm() { if (choice === null || state.status !== "ready" || busy) return; const report = state.value; setChoice(null); setBusy(true); setAnnouncement("Saving report decision…"); const result = await decideReport(report.id, report.version, choice); setBusy(false); if (!result.ok) { setError(result.message); setAnnouncement("Report decision could not be completed."); return; } setAnnouncement(`Report ${choice.disposition}. ${result.value.strikeAdded ? "A strike was added." : "No new strike was added."}`); setReason(""); reload(); }
  return <section className="space-y-6">
    <p><Link className={linkClass} href="/admin/reports">Open reports</Link></p><h1 className="text-2xl font-semibold">Report detail</h1><p>Admin-only report evidence is never shown to the target account.</p><LiveRegion message={announcement} />
    {state.status === "loading" ? <StatusMessage status="info">Loading report…</StatusMessage> : null}
    {state.status === "error" ? <StatusMessage status="error">{state.failure.message}</StatusMessage> : null}
    {error !== "" ? <StatusMessage status="error">{error}</StatusMessage> : null}
    {state.status === "ready" ? <>
      <header className="space-y-3"><h2 className="text-xl font-semibold">{state.value.category} report for {state.value.review.movieTitle}</h2><p>Status: {state.value.status}. Target account: {state.value.target.status}.</p></header>
      <section aria-labelledby="report-explanation-title" className="space-y-3"><h2 id="report-explanation-title" className="text-xl font-semibold">Reporter explanation</h2><p>{state.value.explanation}</p></section>
      <section aria-labelledby="evidence-title" className="space-y-3 rounded-lg border border-slate-300 bg-white p-5"><h2 id="evidence-title" className="text-xl font-semibold">Admin-only report evidence</h2><p>This immutable snapshot is private to Admins.</p><blockquote className="whitespace-pre-wrap">{state.value.evidence.body}</blockquote><p>Rating: {state.value.evidence.rating}/10</p></section>
      <section aria-labelledby="effect-title" className="space-y-3"><h2 id="effect-title" className="text-xl font-semibold">Projected effect</h2><p>{state.value.projectedEffect.strikeAdded ? "A new strike would be added." : "No new strike would be added."} Strike count after decision: {state.value.projectedEffect.strikeCountAfter} of {state.value.target.strikeThreshold}.</p><p>{state.value.projectedEffect.wouldSuspend ? "The account would be suspended." : `Account would remain ${state.value.projectedEffect.accountStatusAfter}.`}</p></section>
      {state.value.status === "open" ? <section aria-labelledby="decision-title" className="space-y-4 rounded-lg border border-slate-300 bg-white p-5"><h2 id="decision-title" className="text-xl font-semibold">Human report decision</h2><FormField label="Reason" name="reason" hint="10–1,000 characters after trimming." error={reasonError}><textarea ref={reasonControl} rows={4} value={reason} disabled={busy || choice !== null} onChange={(event) => setReason(event.target.value)} /></FormField><div className="flex flex-wrap gap-3"><button className={secondaryButtonClass} disabled={busy || choice !== null} onClick={() => prepare("dismissed", [])} type="button">Dismiss report</button><button className={secondaryButtonClass} disabled={busy || choice !== null} onClick={() => prepare("accepted", [])} type="button">Accept report</button><button className={secondaryButtonClass} disabled={busy || choice !== null} onClick={() => prepare("accepted", ["hide_review"])} type="button">Accept and hide review</button></div></section> : null}
      <ConfirmDialog open={choice !== null} title={choice?.disposition === "dismissed" ? "Dismiss report" : "Accept report"} targetName={`the ${state.value.category} report for ${state.value.review.movieTitle}`} consequence={`${choice?.actions.includes("hide_review") ? "The Review will be hidden. " : ""}${state.value.projectedEffect.strikeAdded ? "A strike may be added. " : "No new strike is projected. "}Reason: ${choice?.reason ?? ""}`} confirmLabel="Confirm decision" dialogId="report-decision-dialog" onCancel={() => setChoice(null)} onConfirm={() => { void confirm(); }} />
    </> : null}
  </section>;
}
