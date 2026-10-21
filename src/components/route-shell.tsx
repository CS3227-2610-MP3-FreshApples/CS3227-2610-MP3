import Link from "next/link";

import { publicNavigationForAccount } from "./navigation-data";
import { RouteNavigation } from "./route-navigation";

type ShellLink = {
  href: string;
  label: string;
};

type RouteShellProps = Readonly<{
  authAware?: boolean;
  children: React.ReactNode;
  links: readonly ShellLink[];
  title: string;
}>;

export function RouteShell({ authAware = false, children, links, title }: RouteShellProps) {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <a
        className="absolute left-4 top-4 z-50 -translate-y-20 rounded-md bg-white px-4 py-3 font-medium text-blue-800 shadow-sm ring-1 ring-slate-200 transition-transform focus-visible:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2"
        href="#main-content"
      >
        Skip to main content
      </a>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-4 sm:px-6 sm:py-5 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <Link
            className="inline-flex w-fit items-center rounded-md text-lg font-semibold tracking-tight text-slate-950 underline-offset-4 hover:text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2"
            href={links.some((link) => link.href === "/") ? "/" : links[0]?.href ?? "/"}
          >
            {title}
          </Link>
          <RouteNavigation authAware={authAware} label={`${title} navigation`} links={links} />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8" id="main-content">{children}</main>
    </div>
  );
}

export const publicNavigation = publicNavigationForAccount(null);

export const userNavigation = [
  { href: "/app", label: "Overview" },
  { href: "/app/reviews", label: "My reviews" },
  { href: "/app/reports", label: "My reports" },
] as const;

export const adminNavigation = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/movies", label: "Movies" },
  { href: "/admin/reviews", label: "Reviews" },
  { href: "/admin/reports", label: "Reports" },
  { href: "/admin/announcements", label: "Announcements" },
  { href: "/admin/users", label: "Users" },
] as const;
