"use client";

import Link from "next/link";
import { useState } from "react";

import { LiveRegion } from "../../../../components/status-primitives";
import { linkClass } from "../../_components/admin-feedback";
import { createAnnouncement, type AdminAnnouncementView } from "../../_lib/announcement-client";
import { AnnouncementForm } from "./announcement-form";

const EMPTY = { title: "", body: "", movieId: "" } as const;

/** FR-07 create. New announcements are always drafts (D-79); publishing happens from the editor or list. */
export function CreateAnnouncement() {
  const [created, setCreated] = useState<AdminAnnouncementView | null>(null);

  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-semibold">Create announcement</h1>
      <p>The announcement is saved as a draft. Drafts are visible only to Admins.</p>
      <LiveRegion message={created === null ? "" : `Saved draft “${created.title}”.`} />
      {created === null ? (
        <AnnouncementForm
          actions={[{
            label: "Save draft",
            submittingLabel: "Saving…",
            run: async (content) => {
              const result = await createAnnouncement(content);
              if (!result.ok) return result;
              setCreated(result.value);
              return null;
            },
          }]}
          initialValues={EMPTY}
        />
      ) : (
        <p>
          <Link className={linkClass} href={`/admin/announcements/${created.id}`}>Edit or publish “{created.title}”</Link>
          {" or "}<Link className={linkClass} href="/admin/announcements">return to the announcement list</Link>.
        </p>
      )}
    </section>
  );
}
