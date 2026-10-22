export type NavigationLink = Readonly<{
  href: string;
  label: string;
}>;

export type PublicAccountIdentity = Readonly<{
  displayName: string;
  role: "USER" | "ADMIN";
}>;

export function publicNavigationForAccount(account: PublicAccountIdentity | null): readonly NavigationLink[] {
  const baseLinks: readonly NavigationLink[] = [
    { href: "/", label: "Home" },
    { href: "/movies", label: "Movies" },
    { href: "/announcements", label: "Announcements" },
  ];
  if (account === null) return [...baseLinks, { href: "/sign-in", label: "Sign in" }, { href: "/register", label: "Register" }];
  return [...baseLinks, { href: account.role === "ADMIN" ? "/admin" : "/app", label: account.role === "ADMIN" ? "Admin Dashboard" : account.displayName }];
}
