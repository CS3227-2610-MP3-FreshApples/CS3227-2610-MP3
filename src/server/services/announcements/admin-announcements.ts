import "server-only";

import type { Database } from "../../db";
import type { AnnouncementRecord, AnnouncementRepository, AnnouncementState } from "../../repositories/announcements";
import type { AccountId, Brand, FieldErrors, RequestId, Result, RowVersion, Tx } from "../../shared";
import type { AuditLog } from "../audit";
import { planAnnouncementPatch } from "./announcement-change";
import type { AnnouncementCreateInput, AnnouncementPatchInput } from "./announcement-input";

export type AnnouncementId = Brand<string, "AnnouncementId">;

/** The Admin Announcement resource (api.md 8.1 "full Announcement and version"). */
export interface AdminAnnouncement {
  readonly id: AnnouncementId;
  readonly title: string;
  readonly body: string;
  readonly movieId: string | null;
  readonly state: AnnouncementState;
  readonly publishedAt: string | null;
  readonly authorId: AccountId;
  readonly version: RowVersion;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Who performs an Admin mutation, for the K5 entry. Both are server-derived (D-81). */
export interface AnnouncementActor {
  readonly actorId: AccountId;
  readonly requestId: RequestId;
}

export type AnnouncementNotFound = { readonly kind: "not_found" };
/** A movieId that names no Movie (D-80). */
export type AnnouncementInvalidReference = { readonly kind: "invalid_fields"; readonly fieldErrors: FieldErrors };
export type AnnouncementDeleteRejection = AnnouncementNotFound | { readonly kind: "stale_version" };
/** `conflict` is a PATCH of a deleted Announcement, which is terminal (D-79). */
export type AnnouncementUpdateRejection =
  | AnnouncementDeleteRejection
  | AnnouncementInvalidReference
  | { readonly kind: "conflict" };

export interface AdminAnnouncementPage {
  readonly items: readonly AdminAnnouncement[];
  readonly total: number;
}

/** FR-07 Admin Announcement reads and writes. */
export interface AdminAnnouncementService {
  list(page: number, pageSize: number): Promise<AdminAnnouncementPage>;
  get(announcementId: AnnouncementId): Promise<Result<AdminAnnouncement, AnnouncementNotFound>>;
  create(input: AnnouncementCreateInput, actor: AnnouncementActor): Promise<Result<AdminAnnouncement, AnnouncementInvalidReference>>;
  update(announcementId: AnnouncementId, expected: RowVersion, changes: AnnouncementPatchInput, actor: AnnouncementActor):
    Promise<Result<AdminAnnouncement, AnnouncementUpdateRejection>>;
  /** Soft delete; returns the resulting version. Repeating it on a deleted Announcement is a no-op (D-79). */
  delete(announcementId: AnnouncementId, expected: RowVersion, actor: AnnouncementActor):
    Promise<Result<RowVersion, AnnouncementDeleteRejection>>;
}

export interface AdminAnnouncementDependencies {
  readonly database: Pick<Database, "withTransaction" | "withTransactionResult">;
  readonly announcements: AnnouncementRepository;
  readonly auditLog: AuditLog;
}

const UNKNOWN_MOVIE: AnnouncementInvalidReference = {
  kind: "invalid_fields",
  fieldErrors: { movieId: ["must reference an existing Movie"] },
};

export function toAdminAnnouncement(record: AnnouncementRecord): AdminAnnouncement {
  return {
    id: record.id as AnnouncementId,
    title: record.title,
    body: record.body,
    movieId: record.movieId,
    state: record.state,
    publishedAt: record.publishedAt === null ? null : record.publishedAt.toISOString(),
    authorId: record.authorId as AccountId,
    version: record.version as RowVersion,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function createAdminAnnouncementService(deps: AdminAnnouncementDependencies): AdminAnnouncementService {
  const { database, announcements, auditLog } = deps;

  /** A null or omitted reference is always valid; an archived Movie is valid (D-80). */
  async function referenceExists(tx: Tx, movieId: string | null | undefined): Promise<boolean> {
    return movieId === null || movieId === undefined || announcements.movieExists(tx, movieId);
  }

  return {
    list(page, pageSize) {
      return database.withTransaction(async (tx) => {
        const total = await announcements.count(tx);
        const offset = (page - 1) * pageSize;
        // An out-of-range page returns no items and the actual total (D-80); skip the query entirely.
        const records = offset >= total ? [] : await announcements.list(tx, pageSize, offset);
        return { items: records.map(toAdminAnnouncement), total };
      });
    },

    get(announcementId) {
      return database.withTransactionResult(async (tx) => {
        const record = await announcements.findById(tx, announcementId);
        return record === null
          ? { ok: false, error: { kind: "not_found" } }
          : { ok: true, value: toAdminAnnouncement(record) };
      });
    },

    create(input, actor) {
      return database.withTransactionResult<AdminAnnouncement, AnnouncementInvalidReference>(async (tx) => {
        if (!(await referenceExists(tx, input.movieId))) {
          return { ok: false, error: UNKNOWN_MOVIE };
        }
        const record = await announcements.insertDraft(tx, input, actor.actorId);
        await auditLog.record(tx, {
          actorId: actor.actorId,
          action: "announcement.create",
          targetType: "announcement",
          targetId: record.id,
          result: "applied",
          metadata: { newVersion: record.version, newState: record.state },
          requestId: actor.requestId,
        });
        return { ok: true, value: toAdminAnnouncement(record) };
      });
    },

    update(announcementId, expected, changes, actor) {
      return database.withTransactionResult<AdminAnnouncement, AnnouncementUpdateRejection>(async (tx) => {
        const current = await announcements.lockById(tx, announcementId);
        if (current === null) {
          return { ok: false, error: { kind: "not_found" } };
        }
        // The version check precedes every lifecycle and no-op decision (D-79, D-81).
        if (current.version !== expected) {
          return { ok: false, error: { kind: "stale_version" } };
        }
        if (!(await referenceExists(tx, changes.movieId))) {
          return { ok: false, error: UNKNOWN_MOVIE };
        }
        if (current.state === "deleted") {
          return { ok: false, error: { kind: "conflict" } };
        }
        const plan = planAnnouncementPatch(
          { title: current.title, body: current.body, movieId: current.movieId, state: current.state },
          changes,
        );
        const saved =
          plan.write === "none"
            ? current
            : plan.write === "publish"
              ? await announcements.publish(tx, announcementId, plan.next)
              : await announcements.update(tx, announcementId, plan.next, plan.next.state);
        await auditLog.record(tx, {
          actorId: actor.actorId,
          action: plan.action,
          targetType: "announcement",
          targetId: announcementId,
          result: plan.write === "none" ? "no_op" : "applied",
          // Changed-field markers only, never the text itself (D-81, D-46).
          metadata: {
            previousVersion: current.version,
            newVersion: saved.version,
            previousState: current.state,
            newState: saved.state,
            ...Object.fromEntries(plan.changedFields.map((field) => [`${field}Changed`, true])),
          },
          requestId: actor.requestId,
        });
        return { ok: true, value: toAdminAnnouncement(saved) };
      });
    },

    delete(announcementId, expected, actor) {
      return database.withTransactionResult<RowVersion, AnnouncementDeleteRejection>(async (tx) => {
        const current = await announcements.lockById(tx, announcementId);
        if (current === null) {
          return { ok: false, error: { kind: "not_found" } };
        }
        if (current.version !== expected) {
          return { ok: false, error: { kind: "stale_version" } };
        }
        const alreadyDeleted = current.state === "deleted";
        const saved = alreadyDeleted ? current : await announcements.markDeleted(tx, announcementId);
        await auditLog.record(tx, {
          actorId: actor.actorId,
          action: "announcement.delete",
          targetType: "announcement",
          targetId: announcementId,
          result: alreadyDeleted ? "no_op" : "applied",
          metadata: {
            previousVersion: current.version,
            newVersion: saved.version,
            previousState: current.state,
            newState: saved.state,
          },
          requestId: actor.requestId,
        });
        return { ok: true, value: saved.version as RowVersion };
      });
    },
  };
}
