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
      <main>{children}</main>
    </div>
  );
}

export const publicNavigation = [
  { href: "/", label: "Home" },
  { href: "/movies", label: "Movies" },
  { href: "/announcements", label: "Announcements" },
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
