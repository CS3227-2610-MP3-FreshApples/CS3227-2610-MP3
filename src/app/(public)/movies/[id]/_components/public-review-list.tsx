"use client";

import { useEffect, useRef, useState } from "react";

import { StatusMessage } from "../../../../../components/status-primitives";
import { formatReportDate, reportCategoryLabel, submitReport, type ReportCategory, type ReportReceipt } from "../../../../app/reports/_lib/report-client";

export type PublicReview = Readonly<{ id: string; movieId: string; author: Readonly<{ id: string; displayName: string }>; rating: number; body: string; createdAt: string; updatedAt: string }>;
type ReviewPage = Readonly<{ items: readonly PublicReview[]; page: number; pageSize: number; total: number }>;
type ReviewState = Readonly<{ status: "loading" }> | Readonly<{ status: "error" }> | Readonly<{ status: "ready"; value: ReviewPage }>;

export function PublicReviewList({ movieId }: Readonly<{ movieId: string }>) {
  const [state, setState] = useState<ReviewState>({ status: "loading" });
  const [accountId, setAccountId] = useState<string | null>(null);
  const [selected, setSelected] = useState<PublicReview | null>(null);
  const [returnFocus, setReturnFocus] = useState<HTMLButtonElement | null>(null);
  const [receipt, setReceipt] = useState<ReportReceipt | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let current = true;
    void fetch(`/api/v1/movies/${movieId}/reviews?page=1&pageSize=20`, { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<unknown> : null)
      .then((body) => { if (current) setState(isReviewPage(body, movieId) ? { status: "ready", value: body } : { status: "error" }); })
      .catch(() => { if (current) setState({ status: "error" }); });
    void fetch("/api/v1/auth/me", { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => response.ok ? response.json() as Promise<unknown> : null)
      .then((body) => { if (current) setAccountId(accountIdFrom(body)); })
      .catch(() => { if (current) setAccountId(null); });
    return () => { current = false; };
  }, [generation, movieId]);

  if (state.status === "loading") return <section className="mt-6" aria-label="Community reviews"><StatusMessage status="info">Loading community reviews…</StatusMessage></section>;
  if (state.status === "error") return <section className="mt-6 space-y-3" aria-label="Community reviews"><StatusMessage status="error">Community reviews are temporarily unavailable.</StatusMessage><button className="rounded-md border border-slate-300 px-4 py-2 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2" onClick={() => { setState({ status: "loading" }); setGeneration((value) => value + 1); }} type="button">Try again</button></section>;

  const closeDialog = () => { setSelected(null); returnFocus?.focus(); };
  return <section className="mt-6 space-y-4" aria-labelledby="published-reviews-title"><h3 className="text-lg font-semibold text-slate-950" id="published-reviews-title">Published reviews</h3>{state.value.items.length === 0 ? <p className="text-slate-600" role="status">No published reviews yet. Be the first to submit one.</p> : <div className="space-y-4">{state.value.items.map((review) => <PublicReviewCard accountId={accountId} key={review.id} onReport={(value, trigger) => { setReturnFocus(trigger); setSelected(value); }} review={review} />)}</div>}{selected === null ? null : <ReportDialog review={selected} onCancel={closeDialog} onSubmitted={(value) => { setReceipt(value); closeDialog(); }} />}{receipt === null ? null : <p aria-live="polite" className="rounded-lg border border-green-200 bg-green-50 p-4 text-green-900">Report submitted. {reportCategoryLabel(receipt.category)} · Submitted — awaiting review · <time dateTime={receipt.createdAt}>{formatReportDate(receipt.createdAt)}</time>. <a className="font-semibold underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2" href="/app/reports">View your reports</a></p>}</section>;
}

export function PublicReviewCard({ accountId, onReport, review }: Readonly<{ accountId: string | null; onReport: (review: PublicReview, trigger: HTMLButtonElement) => void; review: PublicReview }>) {
  const edited = review.createdAt !== review.updatedAt;
  return <article className="rounded-lg border border-slate-200 bg-slate-50 p-5" aria-labelledby={`review-${review.id}-author`}><div className="flex flex-wrap items-baseline justify-between gap-2"><h4 className="font-semibold text-slate-950" id={`review-${review.id}-author`}>{review.author.displayName}</h4><span className="font-semibold text-blue-800">{review.rating}/10</span></div><p className="mt-3 whitespace-pre-wrap break-words text-slate-700">{review.body}</p><div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-600"><time dateTime={review.updatedAt}>{formatReportDate(review.updatedAt)}</time>{edited ? <span>Edited</span> : null}{accountId !== null && accountId !== review.author.id ? <button className="font-semibold text-blue-800 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2" onClick={(event) => onReport(review, event.currentTarget)} type="button">Report user</button> : null}</div></article>;
}

export function ReportDialog({ onCancel, onSubmitted, review }: Readonly<{ onCancel: () => void; onSubmitted: (receipt: ReportReceipt) => void; review: PublicReview }>) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [category, setCategory] = useState<ReportCategory>("spam");
  const [explanation, setExplanation] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, readonly string[]>>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { titleRef.current?.focus(); }, []);
  async function submit(): Promise<void> { if (busy) return; setBusy(true); setMessage(null); setFieldErrors({}); const result = await submitReport({ reviewId: review.id, category, explanation }); if (result.ok) onSubmitted(result.value); else { setMessage(result.message); setFieldErrors(result.fieldErrors ?? {}); setBusy(false); } }
  const categoryErrorId = "report-category-error";
  const explanationErrorId = "report-explanation-error";
  return <dialog open aria-labelledby="report-dialog-title" aria-describedby="report-dialog-description" aria-modal="true" className="fixed inset-0 z-20 m-auto w-[min(92vw,36rem)] rounded-xl border border-slate-200 bg-white p-0 shadow-xl" onCancel={(event) => { event.preventDefault(); onCancel(); }} onKeyDown={trapFocus} role="dialog"><form aria-busy={busy} className="space-y-5 p-6" onSubmit={(event) => { event.preventDefault(); void submit(); }}><div><h2 className="text-xl font-semibold text-slate-950 focus:outline-none" id="report-dialog-title" ref={titleRef} tabIndex={-1}>Report {review.author.displayName}</h2><p className="mt-2 text-slate-600" id="report-dialog-description">A report is an allegation for Admin review, not an established violation.</p></div><div className="space-y-2"><label className="font-semibold" htmlFor="report-category">Category</label><select aria-describedby={fieldErrors.category ? categoryErrorId : undefined} aria-invalid={fieldErrors.category ? true : undefined} className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2" id="report-category" name="category" onChange={(event) => setCategory(event.target.value as ReportCategory)} value={category}><option value="profanity">Profanity</option><option value="harassment">Harassment</option><option value="hate">Hate</option><option value="spam">Spam</option><option value="other">Other</option></select>{fieldErrors.category ? <p className="text-sm font-medium text-red-800" id={categoryErrorId}>{fieldErrors.category.join(" ")}</p> : null}</div><div className="space-y-2"><label className="font-semibold" htmlFor="report-explanation">Explanation</label><textarea aria-describedby={fieldErrors.explanation ? `report-explanation-hint ${explanationErrorId}` : "report-explanation-hint"} aria-invalid={fieldErrors.explanation ? true : undefined} className="min-h-32 w-full rounded-md border border-slate-300 bg-white px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2" id="report-explanation" maxLength={1000} minLength={10} name="explanation" onChange={(event) => setExplanation(event.target.value)} required value={explanation} /><p className="text-sm text-slate-600" id="report-explanation-hint">Explain the concern in 10–1,000 characters.</p>{fieldErrors.explanation ? <p className="text-sm font-medium text-red-800" id={explanationErrorId}>{fieldErrors.explanation.join(" ")}</p> : null}</div>{message === null ? null : <p aria-live="polite" className="text-sm font-medium text-red-800" role="alert">{message}</p>}<div className="flex justify-end gap-3"><button className="rounded-md border border-slate-300 px-4 py-2 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2" onClick={onCancel} type="button">Cancel</button><button className="rounded-md bg-blue-700 px-4 py-2 font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 disabled:opacity-60" disabled={busy} type="submit">{busy ? "Submitting…" : "Submit report"}</button></div></form></dialog>;
}

function trapFocus(event: React.KeyboardEvent<HTMLDialogElement>): void {
  if (event.key !== "Tab") return;
  const dialog = event.currentTarget;
  const focusable = Array.from(dialog.querySelectorAll<HTMLElement>("button, select, textarea, a[href], [tabindex]:not([tabindex='-1'])"));
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

function accountIdFrom(value: unknown): string | null { const account = record(value); return account !== null && isUuid(account.id) && account.role === "USER" ? account.id : null; }
function isReview(value: unknown, movieId: string): value is PublicReview { const review = record(value); const author = review === null ? null : record(review.author); return review !== null && isUuid(review.id) && review.movieId === movieId && author !== null && isUuid(author.id) && typeof author.displayName === "string" && typeof review.rating === "number" && Number.isInteger(review.rating) && review.rating >= 1 && review.rating <= 10 && typeof review.body === "string" && isIsoDate(review.createdAt) && isIsoDate(review.updatedAt); }
function isReviewPage(value: unknown, movieId: string): value is ReviewPage { const page = record(value); return page !== null && Array.isArray(page.items) && page.items.every((item) => isReview(item, movieId)) && typeof page.page === "number" && Number.isInteger(page.page) && page.page >= 1 && typeof page.pageSize === "number" && Number.isInteger(page.pageSize) && page.pageSize >= 1 && page.pageSize <= 100 && typeof page.total === "number" && Number.isInteger(page.total) && page.total >= 0; }
function isUuid(value: unknown): value is string { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function isIsoDate(value: unknown): value is string { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && !Number.isNaN(Date.parse(value)); }
function record(value: unknown): Record<string, unknown> | null { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null; }
