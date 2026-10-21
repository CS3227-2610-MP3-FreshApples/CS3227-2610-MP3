import "server-only";

import type { AnnouncementContent } from "../../repositories/announcements";
import type { AuditAction } from "../audit";
import type { AnnouncementPatchInput } from "./announcement-input";

/** The writable state of a non-deleted Announcement. */
export interface AnnouncementSnapshot extends AnnouncementContent {
  readonly state: "draft" | "published";
}

export type AnnouncementField = keyof AnnouncementSnapshot;

/**
 * How a PATCH is applied (D-79): `none` for a no-op, `publish` for draft→published (a new published_at),
 * otherwise `keep_published_at`.
 */
export type AnnouncementWrite = "none" | "publish" | "keep_published_at";

export interface AnnouncementPatchPlan {
  readonly changedFields: readonly AnnouncementField[];
  readonly next: AnnouncementSnapshot;
  readonly write: AnnouncementWrite;
  /** D-81: publish/unpublish for an actual state change, even with content changes; otherwise update. */
  readonly action: AuditAction;
}

const FIELDS: readonly AnnouncementField[] = ["title", "body", "movieId", "state"];

/** Plans a PATCH of a non-deleted Announcement by comparing normalized values (D-79, D-80, D-81). */
export function planAnnouncementPatch(current: AnnouncementSnapshot, changes: AnnouncementPatchInput): AnnouncementPatchPlan {
  const next: AnnouncementSnapshot = { ...current, ...changes };
  const changedFields = FIELDS.filter((field) => current[field] !== next[field]);
  if (changedFields.length === 0) {
    return { changedFields, next, write: "none", action: "announcement.update" };
  }
  if (current.state === next.state) {
    return { changedFields, next, write: "keep_published_at", action: "announcement.update" };
  }
  return next.state === "published"
    ? { changedFields, next, write: "publish", action: "announcement.publish" }
    : { changedFields, next, write: "keep_published_at", action: "announcement.unpublish" };
}
