"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";

import { useAuth } from "./auth-context";
import { publicNavigationForAccount, type NavigationLink } from "./navigation-data";
import { AdminHeaderAccountControl } from "./admin-header-account-control";

type RouteNavigationProps = Readonly<{
  authAware?: boolean;
  authLoadingLinks?: readonly NavigationLink[];
  links: readonly NavigationLink[];
  label: string;
  headerAction?: React.ReactNode;
}>;

export function RouteNavigation(props: RouteNavigationProps) {
  return (
    <Suspense fallback={<><RouteNavigationFallback label={props.label} links={props.authLoadingLinks ?? props.links} />{props.headerAction}</>}>
      <RouteNavigationContent {...props} />
    </Suspense>
  );
}

function RouteNavigationContent({ authAware = false, authLoadingLinks, links, label, headerAction }: RouteNavigationProps) {
  const pathname = usePathname();
  const { account, status, clearAccount } = useAuth();

  const visibleLinks = authAware && status === "loading" ? authLoadingLinks ?? links : authAware && account !== null ? publicNavigationForAccount(account) : links;
  const activeHref = pathname === null ? null : findActiveHref(pathname, visibleLinks);

  return (
    <><nav aria-label={label}>
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
    {headerAction ?? (authAware && account?.role === "ADMIN" ? <AdminHeaderAccountControl displayName={account.displayName} onSignedOut={clearAccount} /> : null)}
    </>
  );
}

function RouteNavigationFallback({ links, label }: Pick<RouteNavigationProps, "links" | "label">) {
  return (
    <nav aria-label={label}>
      <ul className="flex flex-wrap items-center gap-x-5 gap-y-2" data-navigation="primary">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              className="inline-flex min-h-11 items-center rounded-md px-2 py-1.5 text-sm font-medium text-slate-700 underline-offset-4"
              href={link.href}
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function findActiveHref(pathname: string, links: readonly NavigationLink[]): string | null {
  return links
    .filter((link) => pathname === link.href || (link.href !== "/" && pathname.startsWith(`${link.href}/`)))
    .sort((left, right) => right.href.length - left.href.length)[0]?.href ?? null;
}
