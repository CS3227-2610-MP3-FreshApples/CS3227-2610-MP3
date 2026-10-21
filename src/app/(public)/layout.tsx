import { RouteShell, publicNavigation } from "../../components/route-shell";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <RouteShell authAware links={publicNavigation} title="Movie Reviews">
      {children}
    </RouteShell>
  );
}
