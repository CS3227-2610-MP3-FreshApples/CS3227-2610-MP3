"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function AdminDashboardBackLink() {
  const pathname = usePathname();
  if (!pathname?.startsWith("/admin/")) return null;

  return (
    <Link className="mb-6 inline-flex min-h-11 items-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:border-blue-700 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2" href="/admin">
      Back to admin dashboard
    </Link>
  );
}
