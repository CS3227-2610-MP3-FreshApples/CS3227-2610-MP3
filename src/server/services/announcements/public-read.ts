import "server-only";

import type { Database } from "../../db";
import type {
  PublicAnnouncementReadRepository,
  PublishedAnnouncementRecord,
} from "../../repositories/announcements";
import type { MovieId } from "../../shared";

export interface PublicAnnouncementMovie {
  readonly id: MovieId;
  readonly title: string;
}

export interface PublicAnnouncement {
  readonly id: string;
  readonly publishedAt: string;
  readonly title: string;
  readonly body: string;
  readonly movie: PublicAnnouncementMovie | null;
}

export interface PublicAnnouncementList {
  readonly items: readonly PublicAnnouncement[];
  readonly total: number;
}

/** Server-side U-01 read boundary shared by public pages and Route Handlers. */
export interface PublicAnnouncementReadService {
  listAnnouncements(page: { readonly page: number; readonly pageSize: number }): Promise<PublicAnnouncementList>;
}

export function createPublicAnnouncementReadService(deps: {
  readonly database: Database;
  readonly announcements: PublicAnnouncementReadRepository;
}): PublicAnnouncementReadService {
  return {
    async listAnnouncements(page) {
      const records = await deps.database.withTransaction((tx) => deps.announcements.listPublished(tx, page));
      return { items: records.items.map(projectPublicAnnouncement), total: records.total };
    },
  };
}

export function projectPublicAnnouncement(record: PublishedAnnouncementRecord): PublicAnnouncement {
  return {
    id: record.id,
    publishedAt: record.publishedAt.toISOString(),
    title: record.title,
    body: record.body,
    movie: record.movie === null ? null : { id: record.movie.id, title: record.movie.title },
  };
}
