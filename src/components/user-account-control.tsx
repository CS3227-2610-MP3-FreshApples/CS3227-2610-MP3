"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { submitLogout } from "./auth-client";
import { AdminHeaderAccountControl } from "./admin-header-account-control";

type AccountProjection = Readonly<{
  displayName: string;
  role: "USER" | "ADMIN";
  status: "active" | "suspended";
}>;

export function UserAccountControl() {
  const router = useRouter();
  const [account, setAccount] = useState<AccountProjection | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/v1/auth/me", { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => response.ok ? response.json() as Promise<unknown> : null)
      .then((value) => {
        if (!active) return;
        if (!isAccountProjection(value)) {
          router.replace("/sign-in");
          return;
        }
        setAccount(value);
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
    const result = await submitLogout();
    if (result.ok) {
      router.push("/");
      return;
    }
    setBusy(false);
    setMessage(result.message);
  }

  if (account?.role === "ADMIN") return <AdminHeaderAccountControl displayName={account.displayName} />;

  return (
    <div className="flex flex-wrap items-center justify-end gap-3" data-account-control="user">
      <span className="text-sm font-medium text-slate-700">{account?.displayName ?? "Your account"}</span>
      <button
        className="inline-flex min-h-11 items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800 transition-colors hover:border-blue-700 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={busy}
        onClick={() => { void signOut(); }}
        type="button"
      >
        {busy ? "Signing out…" : "Sign out"}
      </button>
      {message === null ? null : <p aria-live="polite" className="basis-full text-right text-sm text-red-700">{message}</p>}
    </div>
  );
}

function isAccountProjection(value: unknown): value is AccountProjection {
  if (typeof value !== "object" || value === null) return false;
  const account = value as Record<string, unknown>;
  return typeof account.displayName === "string"
    && (account.role === "USER" || account.role === "ADMIN")
    && (account.status === "active" || account.status === "suspended");
}
