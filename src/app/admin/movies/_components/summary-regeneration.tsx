"use client";

import Link from "next/link";
import { useState } from "react";

import { StatusMessage } from "../../../../components/status-primitives";
import { linkClass, primaryButtonClass } from "../../_components/admin-feedback";
import { regenerateMovieSummary, type SummaryRegenerationResult } from "../../_lib/movie-client";

type SummaryRegenerationProps = Readonly<{ movieId: string }>;

export type SummaryRegenerationNotice = Readonly<{
  message: string;
  status: "error" | "info" | "success" | "warning";
}>;

export function summaryRegenerationNotice(result: SummaryRegenerationResult): SummaryRegenerationNotice {
  switch (result.status) {
    case "generated":
      return { status: "success", message: "The AI summary was regenerated and is available on the public movie page." };
    case "insufficient_reviews":
      return { status: "warning", message: "The summary is pending because at least three eligible reviews are required." };
    case "pending":
      return { status: "info", message: "The summary is pending. Scheduled recovery will continue processing it." };
  }
}

/** Active-Movie control for the explicit Admin summary-regeneration contract. */
export function SummaryRegeneration({ movieId }: SummaryRegenerationProps) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<SummaryRegenerationNotice | null>(null);

  async function regenerate() {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const result = await regenerateMovieSummary(movieId);
    setBusy(false);
    setNotice(result.ok ? summaryRegenerationNotice(result.value) : { status: "error", message: result.message });
  }

  return (
    <section aria-labelledby="summary-regeneration-title" className="space-y-3 rounded-lg border border-slate-300 bg-white p-5">
      <h2 className="text-xl font-semibold" id="summary-regeneration-title">AI review summary</h2>
      <p>
        Regeneration invalidates the existing result, so the current summary becomes pending immediately. Generation may be deferred,
        and at least three eligible reviews are required.
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <button aria-busy={busy} className={primaryButtonClass} disabled={busy} onClick={() => { void regenerate(); }} type="button">
          {busy ? "Regenerating AI summary…" : "Regenerate AI summary"}
        </button>
        <Link className={linkClass} href={`/movies/${encodeURIComponent(movieId)}`}>View public movie summary</Link>
      </div>
      {notice === null ? null : <StatusMessage status={notice.status}>{notice.message}</StatusMessage>}
    </section>
  );
}
