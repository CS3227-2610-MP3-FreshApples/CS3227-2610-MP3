import { RouteShell, adminNavigation } from "../../components/route-shell";
import { AdminAccountControl } from "./_components/admin-account-control";

type AdminLayoutProps = Readonly<{
  children: React.ReactNode;
}>;

export default function AdminLayout({ children }: AdminLayoutProps) {
  return (
    <RouteShell authAware headerAction={<AdminAccountControl />} links={adminNavigation} title="Admin dashboard">
      {children}
    </RouteShell>
  );
}
