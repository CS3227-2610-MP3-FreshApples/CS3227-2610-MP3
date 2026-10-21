"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import { Pagination } from "../../../../components/pagination";
import { LiveRegion, StatusMessage } from "../../../../components/status-primitives";
import { DataTable } from "../../../../components/table-state";
import { LoadFailure, linkClass, primaryButtonClass, secondaryButtonClass } from "../../_components/admin-feedback";
import { formatUtc } from "../../_lib/admin-http";
import { listAnnouncements, updateAnnouncement, type AdminAnnouncementView } from "../../_lib/announcement-client";
import { useAdminResource } from "../../_lib/use-admin-resource";
import { AnnouncementStateBadge } from "./announcement-state";

type AnnouncementListProps = Readonly<{ page: number }>;

/** FR-07 Announcement list: drafts, published and deleted, with publish and unpublish. */
export function AnnouncementList({ page }: AnnouncementListProps) {
  const load = useCallback(() => listAnnouncements(page), [page]);
  const { state, reload } = useAdminResource(load);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [actionError, setActionError] = useState("");

  async function changeState(item: AdminAnnouncementView, next: "draft" | "published", done: string) {
    setBusyId(item.id);
    setActionError("");
    setAnnouncement("");
    try {
      const result = await updateAnnouncement(item.id, item.version, { state: next });
      if (result.ok) {
        setAnnouncement(done);
      } else {
        setActionError(result.message);
      }
      // Success changes the order; any rejection means the row may be out of date.
      reload();
    } finally {
      setBusyId(null);
    }
  }

  function stateAction(item: AdminAnnouncementView) {
    if (item.state === "deleted") return <span>None (deleted)</span>;
    const publish = item.state === "draft";
    const verb = publish ? "Publish" : "Unpublish";
    return (
      <button
        aria-label={`${verb} ${item.title}`}
        className={secondaryButtonClass}
        disabled={busyId !== null}
        onClick={() => void changeState(
          item,
          publish ? "published" : "draft",
          publish ? `Published “${item.title}”.` : `Unpublished “${item.title}”. It is now a draft.`,
        )}
        type="button"
      >
        {busyId === item.id ? `${verb}ing…` : verb}
      </button>
    );
  }

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Manage announcements</h1>
        <p>Drafts are visible only to Admins. Publishing makes an announcement public immediately.</p>
        <Link className={primaryButtonClass} href="/admin/announcements/new">Create announcement</Link>
      </header>

      <LiveRegion message={announcement} />
      {actionError !== "" ? <StatusMessage status="error">{actionError}</StatusMessage> : null}

      {state.status === "loading" ? <StatusMessage status="info">Loading announcements…</StatusMessage> : null}
      {state.status === "error" ? <LoadFailure failure={state.failure} onRetry={reload} /> : null}
      {state.status === "ready" ? (
        <>
          <DataTable
            caption="Announcements, most recently updated first"
            columns={[
              {
                header: "Title",
                cell: (item) => <Link className={linkClass} href={`/admin/announcements/${item.id}`}>{item.title}</Link>,
              },
              { header: "State", cell: (item) => <AnnouncementStateBadge state={item.state} /> },
              {
                header: "Last published",
                cell: (item) => item.publishedAt === null
                  ? "Never"
                  : <time dateTime={item.publishedAt}>{formatUtc(item.publishedAt)}</time>,
              },
              { header: "Last updated", cell: (item) => <time dateTime={item.updatedAt}>{formatUtc(item.updatedAt)}</time> },
              { header: "Actions", cell: stateAction },
            ]}
            emptyMessage={state.value.total === 0 ? "No announcements yet. Create the first one." : "No announcements on this page."}
            rowKey={(item) => item.id}
            rows={state.value.items}
          />
          <Pagination
            hrefForPage={(target) => `/admin/announcements?page=${target}`}
            page={state.value.page}
            pageSize={state.value.pageSize}
            total={state.value.total}
          />
        </>
      ) : null}
    </section>
  );
}
