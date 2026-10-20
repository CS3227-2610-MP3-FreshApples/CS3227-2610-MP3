import { StatusBadge } from "../../../../components/status-primitives";
import type { AnnouncementState } from "../../_lib/announcement-client";

const BADGES: Record<AnnouncementState, Readonly<{ label: string; tone: "neutral" | "success" | "warning" }>> = {
  draft: { label: "Draft", tone: "neutral" },
  published: { label: "Published", tone: "success" },
  deleted: { label: "Deleted", tone: "warning" },
};

/** The lifecycle state as text; the tone is decorative (K12). */
export function AnnouncementStateBadge({ state }: Readonly<{ state: AnnouncementState }>) {
  const badge = BADGES[state];
  return <StatusBadge label={badge.label} tone={badge.tone} />;
}
