import { Suspense } from "react";

import { StatusMessage } from "../../../../components/status-primitives";
import { EditAnnouncement } from "../_components/edit-announcement";

type AdminEditAnnouncementPageProps = Readonly<{
  params: Promise<{ id: string }>;
}>;

// The Announcement loads in the browser through the guarded HTTP API; a malformed id is the API's 404.
// params resolves inside Suspense so the shell still prerenders (cacheComponents).
export default function AdminEditAnnouncementPage({ params }: AdminEditAnnouncementPageProps) {
  return (
    <Suspense fallback={<StatusMessage status="info">Loading announcement…</StatusMessage>}>
      {params.then(({ id }) => <EditAnnouncement announcementId={id} />)}
    </Suspense>
  );
}
