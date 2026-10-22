"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { submitLogout } from "./auth-client";

/** Shared Admin presentation; the caller owns session lookup and route authorization. */
export function AdminHeaderAccountControl({ displayName, onSignedOut }: Readonly<{ displayName: string; onSignedOut?: () => void }>) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function signOut() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const result = await submitLogout();
    if (result.ok) {
      onSignedOut?.();
      router.replace("/sign-in");
      router.refresh();
      return;
    }
    setBusy(false);
    setMessage(result.message);
  }

  return (
    <div aria-label="Admin account controls" className="flex flex-wrap items-center justify-end gap-3" data-account-control="admin">
      <span aria-live="polite" className="break-words text-sm font-medium text-slate-700">{displayName}</span>
      <button className="inline-flex min-h-11 items-center rounded-md border border-red-700 bg-red-700 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:border-red-800 hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60" disabled={busy} onClick={() => { void signOut(); }} type="button">
        {busy ? "Signing out…" : "Sign out"}
      </button>
      {message === null ? null : <p aria-live="polite" className="basis-full text-right text-sm text-red-700" role="alert">{message}</p>}
    </div>
  );
}
