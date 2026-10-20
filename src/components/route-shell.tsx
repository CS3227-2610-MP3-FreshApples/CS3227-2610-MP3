import Link from "next/link";

type ShellLink = {
  href: string;
  label: string;
};

type RouteShellProps = Readonly<{
  children: React.ReactNode;
  links: readonly ShellLink[];
  title: string;
}>;

export function RouteShell({ children, links, title }: RouteShellProps) {
  return (
    <div>
      <a
        className="absolute left-4 top-4 -translate-y-20 bg-white px-3 py-2 text-blue-700 focus-visible:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
        href="#main-content"
      >
        Skip to main content
      </a>
      <header>
        <p>{title}</p>
        <nav aria-label={`${title} navigation`}>
          <ul>
            {links.map((link) => (
              <li key={link.href}>
                <Link
                  className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
                  href={link.href}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      <main id="main-content">{children}</main>
    </div>
  );
}

export const publicNavigation = [
  { href: "/", label: "Home" },
  { href: "/movies", label: "Movies" },
  { href: "/announcements", label: "Announcements" },
  { href: "/sign-in", label: "Sign in" },
  { href: "/register", label: "Register" },
] as const;

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
