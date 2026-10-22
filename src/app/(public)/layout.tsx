import { RouteShell, publicNavigation } from "../../components/route-shell";
import { publicNavigationBase } from "../../components/navigation-data";
import { PublicUserAccountControl } from "../../components/user-account-control";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <RouteShell authAware authLoadingLinks={publicNavigationBase} headerAction={<PublicUserAccountControl />} links={publicNavigation} title="FreshApples">
      {children}
    </RouteShell>
  );
}
