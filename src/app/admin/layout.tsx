import { Suspense } from "react";
import { RouteShell, adminNavigation } from "../../components/route-shell";
import { AdminAccountControl } from "./_components/admin-account-control";
import { AdminDashboardBackLink } from "./_components/admin-dashboard-back-link";

type AdminLayoutProps = Readonly<{
  children: React.ReactNode;
}>;

export default function AdminLayout({ children }: AdminLayoutProps) {
  return (
    <RouteShell authAware headerAction={<AdminAccountControl />} links={adminNavigation} title="Admin dashboard">
      <Suspense fallback={null}><AdminDashboardBackLink /></Suspense>
      {children}
    </RouteShell>
  );
}
