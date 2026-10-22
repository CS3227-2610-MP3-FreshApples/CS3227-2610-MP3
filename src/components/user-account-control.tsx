"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { useAuth } from "./auth-context";
import { submitLogout } from "./auth-client";
import { AdminHeaderAccountControl } from "./admin-header-account-control";

export function UserAccountControl() {
  const router = useRouter();
  const pathname = usePathname();
  const { account, status, clearAccount } = useAuth();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/sign-in");
  }, [router, status]);

  async function signOut(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const result = await submitLogout();
    if (result.ok) {
      clearAccount();
      router.push("/");
      return;
    }
    setBusy(false);
    setMessage(result.message);
  }

  if (account?.role === "ADMIN") return <AdminHeaderAccountControl displayName={account.displayName} />;

  const accountOverviewActive = pathname === "/app" || pathname === "/app/reviews" || pathname === "/app/reports";

  return (
    <div className="flex flex-wrap items-center justify-end gap-3" data-account-control="user">
      <details className="relative" data-account-menu>
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold text-slate-800 transition-colors hover:border-blue-700 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">{account?.displayName ?? "Your account"}</summary>
        <div className="absolute right-0 z-10 mt-2 min-w-52 rounded-md border border-slate-200 bg-white p-2 shadow-lg">
          {accountOverviewActive ? (
            <button className="block min-h-11 w-full cursor-not-allowed rounded-md px-3 py-2 text-left text-sm font-medium text-slate-400" disabled type="button">Manage my account</button>
          ) : (
            <Link className="block rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2" href="/app">Manage my account</Link>
          )}
          <button
            className="block min-h-11 w-full rounded-md px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={busy}
            onClick={() => { void signOut(); }}
            type="button"
          >
            {busy ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </details>
      {message === null ? null : <p aria-live="polite" className="basis-full text-right text-sm text-red-700">{message}</p>}
    </div>
  );
}

export function PublicUserAccountControl() {
  const { account, status } = useAuth();
  if (status !== "authenticated" || account === null) return null;
  return <UserAccountControl />;
}
