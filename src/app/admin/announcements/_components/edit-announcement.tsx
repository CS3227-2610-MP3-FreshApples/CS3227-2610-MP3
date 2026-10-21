"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import { LiveRegion, StatusMessage } from "../../../../components/status-primitives";
import { LoadFailure, linkClass, secondaryButtonClass } from "../../_components/admin-feedback";
import { formatUtc, type AdminFailure } from "../../_lib/admin-http";
import {
  getAnnouncement,
  updateAnnouncement,
  type AdminAnnouncementView,
  type AnnouncementPatch,
} from "../../_lib/announcement-client";
import { useAdminResource } from "../../_lib/use-admin-resource";
import { AnnouncementForm, type AnnouncementFormAction } from "./announcement-form";
import { AnnouncementStateBadge } from "./announcement-state";

type EditAnnouncementProps = Readonly<{ announcementId: string }>;

/**
 * FR-07 edit, publish and unpublish with If-Match. Content and a state change go in one PATCH (D-79).
 * Deleted announcements are read-only.
 */
export function EditAnnouncement({ announcementId }: EditAnnouncementProps) {
  const load = useCallback(() => getAnnouncement(announcementId), [announcementId]);
  const { state, reload, replace } = useAdminResource(load);
  const [saved, setSaved] = useState("");
  const [stale, setStale] = useState(false);

  function loadLatest() {
    setStale(false);
    setSaved("");
    reload();
  }

  function action(current: AdminAnnouncementView, label: string, submittingLabel: string, extra: AnnouncementPatch, done: string): AnnouncementFormAction {
    return {
      label,
      submittingLabel,
      run: async (content): Promise<AdminFailure | null> => {
        setSaved("");
        const result = await updateAnnouncement(announcementId, current.version, { ...content, ...extra });
        if (!result.ok) {
          setStale(result.kind === "stale");
          return result;
        }
        setStale(false);
        replace(result.value);
        setSaved(done);
        return null;
      },
    };
  }

  function actionsFor(current: AdminAnnouncementView): readonly AnnouncementFormAction[] {
    return current.state === "draft"
      ? [
          action(current, "Save draft", "Saving…", {}, "Draft saved."),
          action(current, "Save and publish", "Publishing…", { state: "published" }, "Saved and published."),
        ]
      : [
          action(current, "Save", "Saving…", {}, "Saved. The published announcement is updated."),
          action(current, "Save and unpublish", "Unpublishing…", { state: "draft" }, "Saved and unpublished. It is now a draft."),
        ];
  }

  return (
    <section className="space-y-6">
      <p><Link className={linkClass} href="/admin/announcements">Back to announcements</Link></p>
      <LiveRegion message={saved} />
      {state.status === "loading" ? <StatusMessage status="info">Loading announcement…</StatusMessage> : null}
      {state.status === "error" ? (
        <>
          <h1 className="text-2xl font-semibold">Edit announcement</h1>
          <LoadFailure failure={state.failure} onRetry={reload} />
        </>
      ) : null}
      {state.status === "ready" ? (
        <>
          <header className="space-y-2">
            <h1 className="text-2xl font-semibold">Announcement “{state.value.title}”</h1>
            <p>
              <AnnouncementStateBadge state={state.value.state} />
              {" "}Last updated <time dateTime={state.value.updatedAt}>{formatUtc(state.value.updatedAt)}</time>.
              {state.value.publishedAt !== null ? (
                <> Last published <time dateTime={state.value.publishedAt}>{formatUtc(state.value.publishedAt)}</time>.</>
              ) : null}
            </p>
            {state.value.state === "published" ? <p>Saved changes are public immediately.</p> : null}
          </header>
          {state.value.state === "deleted" ? (
            <div className="space-y-3">
              <StatusMessage status="info">Deleted announcements can be read but not edited or published.</StatusMessage>
              <h2 className="text-lg font-semibold">Body</h2>
              <p className="whitespace-pre-wrap">{state.value.body}</p>
              <p>Related movie ID: {state.value.movieId ?? "none"}</p>
            </div>
          ) : (
            <>
              {stale ? (
                <div className="space-y-2">
                  <StatusMessage status="warning">
                    Your text is still in the form. Copy anything you want to keep before loading the latest version.
                  </StatusMessage>
                  <button className={secondaryButtonClass} onClick={loadLatest} type="button">Load latest version</button>
                </div>
              ) : null}
              <AnnouncementForm
                actions={actionsFor(state.value)}
                initialValues={{ title: state.value.title, body: state.value.body, movieId: state.value.movieId ?? "" }}
                // A saved change has a new version; remounting shows the stored, trimmed values.
                key={state.value.version}
              />
            </>
          )}
        </>
      ) : null}
    </section>
  );
}
