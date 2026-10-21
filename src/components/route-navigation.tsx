"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { publicNavigationForAccount, type NavigationLink, type PublicAccountIdentity } from "./navigation-data";

type RouteNavigationProps = Readonly<{
  authAware?: boolean;
  links: readonly NavigationLink[];
  label: string;
}>;

export function RouteNavigation({ authAware = false, links, label }: RouteNavigationProps) {
  const pathname = usePathname();
  const [account, setAccount] = useState<PublicAccountIdentity | null>(null);
  useEffect(() => {
    if (!authAware) return;
    let active = true;
    void fetch("/api/v1/auth/me", { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => response.ok ? response.json() as Promise<unknown> : null)
      .then((value) => {
        if (!active || typeof value !== "object" || value === null) return;
        const candidate = value as Record<string, unknown>;
        if (typeof candidate.displayName !== "string" || (candidate.role !== "USER" && candidate.role !== "ADMIN")) return;
        setAccount({ displayName: candidate.displayName, role: candidate.role });
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [authAware]);

  const visibleLinks = authAware && account !== null ? publicNavigationForAccount(account) : links;
  const activeHref = pathname === null ? null : findActiveHref(pathname, visibleLinks);

  return (
    <nav aria-label={label}>
      <ul className="flex flex-wrap items-center gap-x-5 gap-y-2" data-navigation="primary">
        {visibleLinks.map((link) => {
          const active = link.href === activeHref;

          return (
            <li key={link.href}>
              <Link
                aria-current={active ? "page" : undefined}
                className={[
                  "inline-flex min-h-11 items-center rounded-md px-2 py-1.5 text-sm font-medium text-slate-700 underline-offset-4 transition-colors hover:bg-slate-100 hover:text-blue-700 hover:underline",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2",
                  active ? "bg-blue-50 text-blue-800 underline" : "",
                ].join(" ")}
                href={link.href}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function findActiveHref(pathname: string, links: readonly NavigationLink[]): string | null {
  return links
    .filter((link) => pathname === link.href || (link.href !== "/" && pathname.startsWith(`${link.href}/`)))
    .sort((left, right) => right.href.length - left.href.length)[0]?.href ?? null;
}
