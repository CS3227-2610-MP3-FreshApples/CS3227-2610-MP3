import { PagePlaceholder } from "../components/page-placeholder";
import { RouteShell, publicNavigation } from "../components/route-shell";

export default function Home() {
  return (
    <RouteShell links={publicNavigation} title="Movie Reviews">
      <PagePlaceholder title="FreshApples Movie Reviews" description="Browse movies and community reviews." />
    </RouteShell>
  );
}
