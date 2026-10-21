import {
  adminRead,
  adminWrite,
  isListPage,
  isRecord,
  jsonBody,
  pageQuery,
  type AdminResult,
  type Fetcher,
  type ListPage,
} from "./admin-http";

export type AnnouncementState = "draft" | "published" | "deleted";

/** The Admin Announcement projection (api.md 8.1), declared here because Client Components never import src/server. */
export type AdminAnnouncementView = Readonly<{
  id: string;
  title: string;
  body: string;
  movieId: string | null;
  state: AnnouncementState;
  publishedAt: string | null;
  authorId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}>;

export type AnnouncementContentWrite = Readonly<{
  title: string;
  body: string;
  movieId: string | null;
}>;

/** A PATCH body: content, a publication state, or both in one atomic request (D-79). */
export type AnnouncementPatch = Partial<AnnouncementContentWrite> & Readonly<{ state?: "draft" | "published" }>;

const BASE = "/api/v1/admin/announcements";

export function isAdminAnnouncement(value: unknown): value is AdminAnnouncementView {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.title === "string"
    && typeof value.body === "string"
    && (value.movieId === null || typeof value.movieId === "string")
    && (value.state === "draft" || value.state === "published" || value.state === "deleted")
    && (value.publishedAt === null || typeof value.publishedAt === "string")
    && typeof value.authorId === "string"
    && Number.isInteger(value.version)
    && typeof value.createdAt === "string"
    && typeof value.updatedAt === "string";
}

function isAnnouncementPage(value: unknown): value is ListPage<AdminAnnouncementView> {
  return isListPage(value, isAdminAnnouncement);
}

function announcementPath(announcementId: string): string {
  return `${BASE}/${encodeURIComponent(announcementId)}`;
}

export function listAnnouncements(page: number, fetcher: Fetcher = fetch): Promise<AdminResult<ListPage<AdminAnnouncementView>>> {
  return adminRead(`${BASE}?${pageQuery(page)}`, isAnnouncementPage, fetcher);
}

export function getAnnouncement(announcementId: string, fetcher: Fetcher = fetch): Promise<AdminResult<AdminAnnouncementView>> {
  return adminRead(announcementPath(announcementId), isAdminAnnouncement, fetcher);
}

/** Always creates a draft (D-79). */
export function createAnnouncement(input: AnnouncementContentWrite, fetcher: Fetcher = fetch): Promise<AdminResult<AdminAnnouncementView>> {
  return adminWrite({ path: BASE, method: "POST", body: input }, jsonBody(isAdminAnnouncement), fetcher);
}

export function updateAnnouncement(
  announcementId: string,
  version: number,
  changes: AnnouncementPatch,
  fetcher: Fetcher = fetch,
): Promise<AdminResult<AdminAnnouncementView>> {
  return adminWrite(
    { path: announcementPath(announcementId), method: "PATCH", body: changes, version },
    jsonBody(isAdminAnnouncement),
    fetcher,
  );
}

/** Converts the form's text to content; an empty Movie ID means no reference. */
export function announcementWriteFromForm(values: Readonly<{ title: string; body: string; movieId: string }>): AnnouncementContentWrite {
  const movieId = values.movieId.trim();
  return { title: values.title, body: values.body, movieId: movieId === "" ? null : movieId };
}
