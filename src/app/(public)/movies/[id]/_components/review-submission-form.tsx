"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { StatusMessage } from "../../../../../components/status-primitives";
import { submitReview } from "../_lib/review-submit-client";

type AccountState = "loading" | "signed_out" | "ready";
type FieldErrors = { body?: string; rating?: string };

export function ReviewSubmissionForm({ movieId }: Readonly<{ movieId: string }>) {
  const [accountState, setAccountState] = useState<AccountState>("loading");
  const [rating, setRating] = useState("");
  const [body, setBody] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch("/api/v1/auth/me", { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => response.ok ? response.json() as Promise<unknown> : null)
      .then((value) => { if (active) setAccountState(isNormalUser(value) ? "ready" : "signed_out"); })
      .catch(() => { if (active) setAccountState("signed_out"); });
    return () => { active = false; };
  }, []);

  if (accountState === "loading") {
    return <section aria-label="Submit a review" className="space-y-3 rounded-xl border border-slate-200 bg-white p-6"><h2 className="text-xl font-semibold text-slate-950">Share your perspective</h2><StatusMessage status="info">Checking your sign-in…</StatusMessage></section>;
  }
  if (accountState === "signed_out") {
    return <section aria-label="Submit a review" className="space-y-3 rounded-xl border border-slate-200 bg-white p-6"><h2 className="text-xl font-semibold text-slate-950">Share your perspective</h2><p className="text-slate-600">Sign in to rate this movie and submit a review.</p><Link className="inline-flex min-h-11 items-center rounded-md bg-blue-700 px-4 py-2 font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2" href="/sign-in">Sign in to submit a review</Link></section>;
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const nextErrors: FieldErrors = {};
    const numericRating = Number(rating);
    const trimmedBody = body.trim();
    if (!Number.isInteger(numericRating) || numericRating < 1 || numericRating > 10) nextErrors.rating = "Choose a rating from 1 to 10.";
    if (trimmedBody.length < 10) nextErrors.body = "Write at least 10 characters.";
    else if (trimmedBody.length > 2000) nextErrors.body = "Keep your review to 2,000 characters or fewer.";
    setErrors(nextErrors);
    setMessage(null);
    if (Object.keys(nextErrors).length > 0) return;
    setBusy(true);
    const result = await submitReview(movieId, { rating: numericRating, body: trimmedBody });
    setBusy(false);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setRating("");
    setBody("");
    setMessage(result.value.message);
  }

  return <section aria-label="Submit a review" className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"><div className="space-y-2"><h2 className="text-xl font-semibold text-slate-950">Share your perspective</h2><p className="text-slate-600">Your review is plain text and will be checked before it becomes public.</p></div><form className="mt-6 space-y-5" onSubmit={(event) => { void submit(event); }}><div className="space-y-2"><label className="font-semibold text-slate-950" htmlFor="review-rating">Rating</label><select aria-describedby={errors.rating ? "review-rating-error" : "review-rating-hint"} aria-invalid={errors.rating ? true : undefined} className="min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2" disabled={busy} id="review-rating" onChange={(event) => setRating(event.target.value)} value={rating}><option value="">Choose a rating</option>{Array.from({ length: 10 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}/10</option>)}</select><p className="text-sm text-slate-600" id="review-rating-hint">Choose a whole-number rating from 1 to 10.</p>{errors.rating ? <p className="text-sm font-medium text-red-800" id="review-rating-error" role="alert">{errors.rating}</p> : null}</div><div className="space-y-2"><label className="font-semibold text-slate-950" htmlFor="review-body">Review</label><textarea aria-describedby={errors.body ? "review-body-hint review-body-error" : "review-body-hint"} aria-invalid={errors.body ? true : undefined} className="min-h-36 w-full rounded-md border border-slate-300 bg-white px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2" disabled={busy} id="review-body" maxLength={2000} minLength={10} onChange={(event) => setBody(event.target.value)} value={body} /><p className="text-sm text-slate-600" id="review-body-hint">Write 10–2,000 characters. Plain text only.</p>{errors.body ? <p className="text-sm font-medium text-red-800" id="review-body-error" role="alert">{errors.body}</p> : null}</div>{message === null ? null : <p aria-live="polite" className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950" role="status">{message}</p>}<button className="inline-flex min-h-11 items-center rounded-md bg-blue-700 px-4 py-2 font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60" disabled={busy} type="submit">{busy ? "Submitting review…" : "Submit review"}</button></form></section>;
}

function isNormalUser(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const account = value as Record<string, unknown>;
  return account.role === "USER" && account.status === "active";
}
