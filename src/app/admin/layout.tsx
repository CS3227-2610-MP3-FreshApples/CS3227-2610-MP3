import { RouteShell, adminNavigation } from "../../components/route-shell";

type AdminLayoutProps = Readonly<{
  children: React.ReactNode;
}>;

export default function AdminLayout({ children }: AdminLayoutProps) {
  return (
    <RouteShell links={adminNavigation} title="Admin dashboard">
      {children}
    </RouteShell>
  );
}
