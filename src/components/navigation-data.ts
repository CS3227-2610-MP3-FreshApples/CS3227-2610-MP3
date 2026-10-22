export type NavigationLink = Readonly<{
  href: string;
  label: string;
}>;

export type PublicAccountIdentity = Readonly<{
  displayName: string;
  role: "USER" | "ADMIN";
}>;

export const publicNavigationBase: readonly NavigationLink[] = [
  { href: "/", label: "Home" },
  { href: "/movies", label: "Movies" },
  { href: "/announcements", label: "Announcements" },
];

export function publicNavigationForAccount(account: PublicAccountIdentity | null): readonly NavigationLink[] {
  if (account === null) return [...publicNavigationBase, { href: "/sign-in", label: "Sign in" }, { href: "/register", label: "Register" }];
  return account.role === "ADMIN"
    ? [...publicNavigationBase, { href: "/admin", label: "Admin Dashboard" }]
    : [...publicNavigationBase];
}
