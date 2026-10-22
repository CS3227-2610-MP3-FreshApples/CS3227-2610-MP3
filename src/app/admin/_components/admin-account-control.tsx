"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { adminLogout, getAdminAccount, type AdminAccount } from "../_lib/admin-http";

export const logoutAdmin = adminLogout;

export function AdminAccountControl() {
  const router = useRouter();
  const [account, setAccount] = useState<AdminAccount | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getAdminAccount(fetch)
      .then((result) => {
        if (!active) return;
        if (!result.ok) {
          router.replace("/sign-in");
          return;
        }
        setAccount(result.value);
      })
      .catch(() => {
        if (active) router.replace("/sign-in");
      });
    return () => { active = false; };
  }, [router]);

  async function signOut(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const result = await logoutAdmin(fetch, router.replace);
    if (result.ok) return;
    setBusy(false);
    setMessage(result.message);
  }

  return (
    <div aria-label="Admin account controls" className="flex flex-wrap items-center justify-end gap-3" data-account-control="admin">
      <span aria-live="polite" className="text-sm font-medium text-slate-700">{account?.displayName ?? "Loading account…"}</span>
      <button
        className="inline-flex min-h-11 items-center rounded-md border border-red-700 bg-red-700 px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:border-red-800 hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={busy}
        onClick={() => { void signOut(); }}
        type="button"
      >
        {busy ? "Signing out…" : "Sign out"}
      </button>
      {message === null ? null : <p aria-live="polite" className="basis-full text-right text-sm text-red-700" role="alert">{message}</p>}
    </div>
  );
}
