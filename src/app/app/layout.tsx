import { RouteShell, userNavigation } from "../../components/route-shell";
import { UserAccountControl } from "../../components/user-account-control";

type UserLayoutProps = Readonly<{
  children: React.ReactNode;
}>;

export default function UserLayout({ children }: UserLayoutProps) {
  return (
    <RouteShell headerAction={<UserAccountControl />} links={userNavigation} title="Your account">
      {children}
    </RouteShell>
  );
}
