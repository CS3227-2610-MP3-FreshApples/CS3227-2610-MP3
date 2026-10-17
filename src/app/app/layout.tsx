import { RouteShell, userNavigation } from "../../components/route-shell";

type UserLayoutProps = Readonly<{
  children: React.ReactNode;
}>;

export default function UserLayout({ children }: UserLayoutProps) {
  return (
    <RouteShell links={userNavigation} title="Your account">
      {children}
    </RouteShell>
  );
}
