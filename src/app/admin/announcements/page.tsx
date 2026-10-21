import { Suspense } from "react";

import { StatusMessage } from "../../../components/status-primitives";
import { pageFromSearchParam } from "../_lib/admin-http";
import { AnnouncementList } from "./_components/announcement-list";

type AdminAnnouncementsPageProps = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

// Data loads in the browser through the guarded HTTP API; this Server Component reads no Admin data.
// searchParams resolves inside Suspense so the shell still prerenders (cacheComponents).
export default function AdminAnnouncementsPage({ searchParams }: AdminAnnouncementsPageProps) {
  return (
    <Suspense fallback={<StatusMessage status="info">Loading announcements…</StatusMessage>}>
      {searchParams.then((query) => <AnnouncementList page={pageFromSearchParam(query.page)} />)}
    </Suspense>
  );
}
