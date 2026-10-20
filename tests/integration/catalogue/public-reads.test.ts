import type { Client } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// `server-only` throws outside the react-server export condition; Vitest runs in plain Node.
vi.mock("server-only", () => ({}));

import { createDatabase, type Database, type Sql } from "../../../src/server/db";
import { createPublicAnnouncementReadRepository } from "../../../src/server/repositories/announcements";
import { createPublicMovieReadRepository } from "../../../src/server/repositories/catalogue";
import { createPublicAnnouncementReadService } from "../../../src/server/services/announcements";
import { createPublicCatalogueReadService } from "../../../src/server/services/catalogue";
import type { MovieId, Tx } from "../../../src/server/shared";
import { connectAsOwner } from "../database/schema-fixtures";
import { testDatabaseUrl } from "../database/test-database";

const db: Database & Sql = createDatabase({ url: testDatabaseUrl(), caCert: null });
const movies = createPublicMovieReadRepository({ sql: db });
const announcements = createPublicAnnouncementReadRepository({ sql: db });
const catalogueService = createPublicCatalogueReadService({ database: db, movies });
const announcementService = createPublicAnnouncementReadService({ database: db, announcements });

const ACTIVE_ID = "10000000-0000-4000-8000-000000000001" as MovieId;
const SAME_TITLE_ID = "10000000-0000-4000-8000-000000000002" as MovieId;
const NEWEST_ID = "10000000-0000-4000-8000-000000000003" as MovieId;
const UNKNOWN_DATE_ID = "10000000-0000-4000-8000-000000000004" as MovieId;
const ARCHIVED_ID = "10000000-0000-4000-8000-000000000005" as MovieId;

let owner: Client;

beforeAll(async () => {
  owner = await connectAsOwner();
});

afterAll(async () => {
  await owner.end();
});

beforeEach(async () => {
  await owner.query("TRUNCATE app.movie CASCADE");
});

async function inRuntimeTx<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  return db.withTransaction(async (tx) => {
    await db.query(tx, "SET LOCAL ROLE app_runtime", []);
    return work(tx);
  });
}

describe("U-01 PostgreSQL public movie reads (D-79)", () => {
  it("lists active movies and excludes archived movies", async () => {
    await owner.query(
      `INSERT INTO app.movie (title, synopsis, director, archived_at)
       VALUES ('Active Movie', 'Active synopsis.', '', NULL),
              ('Archived Movie', 'Archived synopsis.', '', now())`,
    );

    const page = await inRuntimeTx((tx) =>
      movies.listActive(tx, { titleQuery: null, sort: "title_asc", page: 1, pageSize: 20 }),
    );

    expect(page.total).toBe(1);
    expect(page.items.map((movie) => movie.title)).toEqual(["Active Movie"]);
  });

  it("paginates release ordering stably with unknown dates last", async () => {
    await owner.query(
      `INSERT INTO app.movie (id, title, synopsis, release_date, genres, director, archived_at)
       VALUES ($1, 'Alpha', 'First.', '2025-01-01', ARRAY['Drama'], 'Director A', NULL),
              ($2, 'alpha', 'Second.', '2025-01-01', ARRAY['Comedy'], 'Director B', NULL),
              ($3, 'Newest', 'Third.', '2026-01-01', '{}', '', NULL),
              ($4, 'Unknown', 'Fourth.', NULL, '{}', '', NULL),
              ($5, 'Archived', 'Fifth.', '2027-01-01', '{}', '', now())`,
      [ACTIVE_ID, SAME_TITLE_ID, NEWEST_ID, UNKNOWN_DATE_ID, ARCHIVED_ID],
    );

    const first = await inRuntimeTx((tx) =>
      movies.listActive(tx, { titleQuery: null, sort: "release_desc", page: 1, pageSize: 2 }),
    );
    const second = await inRuntimeTx((tx) =>
      movies.listActive(tx, { titleQuery: null, sort: "release_desc", page: 2, pageSize: 2 }),
    );

    expect(first.total).toBe(4);
    expect(first.items.map(({ id }) => id)).toEqual([NEWEST_ID, ACTIVE_ID]);
    expect(second.total).toBe(4);
    expect(second.items.map(({ id }) => id)).toEqual([SAME_TITLE_ID, UNKNOWN_DATE_ID]);
  });

  it("searches and orders titles case-insensitively with the ID tie-breaker", async () => {
    await owner.query(
      `INSERT INTO app.movie (id, title, synopsis, director)
       VALUES ($1, 'Fresh Apples', 'First.', ''),
              ($2, 'fresh apples', 'Second.', ''),
              ($3, 'Other Film', 'Third.', '')`,
      [ACTIVE_ID, SAME_TITLE_ID, NEWEST_ID],
    );

    const page = await catalogueService.listMovies({ q: "APPLES", sort: "title_asc", page: 1, pageSize: 20 });

    expect(page.total).toBe(2);
    expect(page.items.map(({ id }) => id)).toEqual([ACTIVE_ID, SAME_TITLE_ID]);
  });

  it("returns active detail aggregates from eligible reviews only and hides archived detail", async () => {
    await owner.query(
      `INSERT INTO app.movie (id, title, synopsis, release_date, genres, director, "cast", runtime_minutes, archived_at)
       VALUES ($1, 'Active Detail', 'Plain synopsis.', '2026-02-03', ARRAY['Drama'], 'Director',
               ARRAY['Performer'], 123, NULL),
              ($2, 'Archived Detail', 'Archived synopsis.', NULL, '{}', '', '{}', NULL, now())`,
      [ACTIVE_ID, ARCHIVED_ID],
    );
    const { rows: accounts } = await owner.query<{ id: string }>(
      `INSERT INTO app.account (normalized_email, password_hash, display_name, role, status)
       SELECT 'reader-' || value || '@example.test', 'synthetic-hash', 'Synthetic', 'USER', 'active'
       FROM generate_series(1, 6) AS value
       RETURNING id`,
    );
    await owner.query(
      `INSERT INTO app.review
         (movie_id, author_id, rating, body, moderation_state, deleted_at, hidden_at, clearance_source)
       VALUES ($1, $2, 8, 'Visible one.', 'cleared', NULL, NULL, 'ai'),
              ($1, $3, 10, 'Visible two.', 'cleared', NULL, NULL, 'admin'),
              ($1, $4, 1, 'Pending.', 'pending', NULL, NULL, NULL),
              ($1, $5, 1, 'Hidden.', 'cleared', NULL, now(), 'admin'),
              ($1, $6, 1, 'Deleted.', 'cleared', now(), NULL, 'ai'),
              ($1, $7, 1, 'Flagged.', 'flagged', NULL, NULL, NULL)`,
      [ACTIVE_ID, ...accounts.map(({ id }) => id)],
    );

    const detail = await catalogueService.getMovie(ACTIVE_ID);

    expect(detail).toEqual({
      id: ACTIVE_ID,
      title: "Active Detail",
      synopsis: "Plain synopsis.",
      releaseDate: "2026-02-03",
      genres: ["Drama"],
      director: "Director",
      cast: ["Performer"],
      runtimeMinutes: 123,
      averageRating: 9,
      reviewCount: 2,
    });
    await expect(catalogueService.getMovie(ARCHIVED_ID)).resolves.toBeNull();
  });

  it("returns null and zero aggregates when an active movie has no eligible reviews", async () => {
    await owner.query(
      `INSERT INTO app.movie (id, title, synopsis, director)
       VALUES ($1, 'No Ratings', 'Plain synopsis.', '')`,
      [ACTIVE_ID],
    );

    await expect(catalogueService.getMovie(ACTIVE_ID)).resolves.toMatchObject({
      averageRating: null,
      reviewCount: 0,
    });
  });
});

describe("U-01 PostgreSQL public announcement reads (D-79)", () => {
  it("paginates published announcements and nulls absent or archived movie references", async () => {
    const { rows: authors } = await owner.query<{ id: string }>(
      `INSERT INTO app.account (normalized_email, password_hash, display_name, role, status)
       VALUES ('announcer@example.test', 'synthetic-hash', 'Announcer', 'ADMIN', 'active')
       RETURNING id`,
    );
    await owner.query(
      `INSERT INTO app.movie (id, title, synopsis, director, archived_at)
       VALUES ($1, 'Active Link', 'Active.', '', NULL),
              ($2, 'Archived Link', 'Archived.', '', now())`,
      [ACTIVE_ID, ARCHIVED_ID],
    );
    await owner.query(
      `INSERT INTO app.announcement (id, title, body, movie_id, state, published_at, author_id)
       VALUES ('20000000-0000-4000-8000-000000000001', 'Newest active', 'Body one.', $1, 'published',
               '2026-10-20T03:00:00Z', $3),
              ('20000000-0000-4000-8000-000000000002', 'Same-time archived', 'Body two.', $2, 'published',
               '2026-10-20T02:00:00Z', $3),
              ('20000000-0000-4000-8000-000000000003', 'Same-time absent', 'Body three.', NULL, 'published',
               '2026-10-20T02:00:00Z', $3),
              ('20000000-0000-4000-8000-000000000004', 'Draft', 'Never public.', NULL, 'draft', NULL, $3),
              ('20000000-0000-4000-8000-000000000005', 'Deleted', 'Never public.', NULL, 'deleted',
               '2026-10-20T04:00:00Z', $3)`,
      [ACTIVE_ID, ARCHIVED_ID, authors[0]!.id],
    );

    const first = await announcementService.listAnnouncements({ page: 1, pageSize: 2 });
    const second = await announcementService.listAnnouncements({ page: 2, pageSize: 2 });

    expect(first.total).toBe(3);
    expect(first.items).toEqual([
      {
        id: "20000000-0000-4000-8000-000000000001",
        publishedAt: "2026-10-20T03:00:00.000Z",
        title: "Newest active",
        body: "Body one.",
        movie: { id: ACTIVE_ID, title: "Active Link" },
      },
      {
        id: "20000000-0000-4000-8000-000000000002",
        publishedAt: "2026-10-20T02:00:00.000Z",
        title: "Same-time archived",
        body: "Body two.",
        movie: null,
      },
    ]);
    expect(second.total).toBe(3);
    expect(second.items).toEqual([
      {
        id: "20000000-0000-4000-8000-000000000003",
        publishedAt: "2026-10-20T02:00:00.000Z",
        title: "Same-time absent",
        body: "Body three.",
        movie: null,
      },
    ]);
  });
});
