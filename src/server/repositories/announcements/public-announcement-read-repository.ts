import "server-only";

import type { Sql } from "../../db";
import type { MovieId, Tx } from "../../shared";

export interface ActiveMovieReferenceRecord {
  readonly id: MovieId;
  readonly title: string;
}

export interface PublishedAnnouncementRecord {
  readonly id: string;
  readonly publishedAt: Date;
  readonly title: string;
  readonly body: string;
  /** Null when no Movie is linked or when the linked Movie is archived (D-79). */
  readonly movie: ActiveMovieReferenceRecord | null;
}

export interface PublishedAnnouncementPage {
  readonly items: readonly PublishedAnnouncementRecord[];
  readonly total: number;
}

/** Read-only storage boundary for U-01 public announcement data. */
export interface PublicAnnouncementReadRepository {
  /** Returns published, non-deleted Announcements only. */
  listPublished(tx: Tx, page: { readonly page: number; readonly pageSize: number }): Promise<PublishedAnnouncementPage>;
}

interface PublishedAnnouncementRow {
  readonly id: string;
  readonly published_at: Date;
  readonly title: string;
  readonly body: string;
  readonly movie_id: MovieId | null;
  readonly movie_title: string | null;
}

const COUNT_PUBLISHED = `
  SELECT count(*)::integer AS total
  FROM app.announcement
  WHERE state = 'published' AND published_at IS NOT NULL`;

const LIST_PUBLISHED = `
  SELECT a.id, a.published_at, a.title, a.body, m.id AS movie_id, m.title AS movie_title
  FROM app.announcement a
  LEFT JOIN app.movie m ON m.id = a.movie_id AND m.archived_at IS NULL
  WHERE a.state = 'published' AND a.published_at IS NOT NULL
  ORDER BY a.published_at DESC, a.id ASC
  LIMIT $1 OFFSET $2`;

export function createPublicAnnouncementReadRepository(deps: {
  readonly sql: Sql;
}): PublicAnnouncementReadRepository {
  return {
    async listPublished(tx, page) {
      const countRows = await deps.sql.query<{ total: number }>(tx, COUNT_PUBLISHED, []);
      const rows = await deps.sql.query<PublishedAnnouncementRow>(tx, LIST_PUBLISHED, [
        page.pageSize,
        (page.page - 1) * page.pageSize,
      ]);
      return {
        items: rows.map((row) => ({
          id: row.id,
          publishedAt: row.published_at,
          title: row.title,
          body: row.body,
          movie:
            row.movie_id === null || row.movie_title === null
              ? null
              : { id: row.movie_id, title: row.movie_title },
        })),
        total: countRows[0]?.total ?? 0,
      };
    },
  };
}
