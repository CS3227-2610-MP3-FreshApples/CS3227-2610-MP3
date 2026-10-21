import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Client } from "pg";

vi.mock("server-only", () => ({}));
import { testDatabaseUrl } from "../../database/test-database";
process.env.APP_ENV = "test";
process.env.PUBLIC_APP_URL = "http://localhost:3000";
process.env.DATABASE_URL = testDatabaseUrl();
process.env.SESSION_SECRET = "synthetic-session-secret-012345678901234567890123456789";
process.env.RATE_LIMIT_KEY_SECRET = "synthetic-rate-limit-secret-012345678901234567890123456789";
delete process.env.DATABASE_CA_CERT;

const { GET: getReviews } = await import("../../../../src/app/api/v1/movies/[id]/reviews/route");
const { connectAsOwner, insertAccount, insertMovie } = await import("../../database/schema-fixtures");

describe("GET /api/v1/movies/:id/reviews", () => {
  let owner: Client;
  beforeAll(async () => { owner = await connectAsOwner(); });

  it("lists only visible Reviews with stable newest-first ordering and pagination", async () => {
    const movieId = await insertMovie(owner);
    const authorId = await insertAccount(owner);
    const secondAuthorId = await insertAccount(owner);
    await owner.query(
      `INSERT INTO app.review (movie_id, author_id, rating, body, moderation_state, hidden_at, created_at, updated_at)
       VALUES ($1, $2, 8, 'Visible review body.', 'cleared', NULL, now() - interval '2 minutes', now() - interval '2 minutes'),
              ($1, $3, 9, 'Hidden review body.', 'cleared', now(), now() - interval '1 minute', now() - interval '1 minute')`,
      [movieId, authorId, secondAuthorId],
    );
    const response = await getReviews(new Request(`http://localhost:3000/api/v1/movies/${movieId}/reviews?page=1&pageSize=10`), { params: Promise.resolve({ id: movieId }) });
    expect(response.status).toBe(200);
    const page = await response.json();
    expect(page.total).toBe(1);
    expect(page.items).toHaveLength(1);
    expect(page.items[0].body).toBe("Visible review body.");
    expect(page.items[0]).not.toHaveProperty("moderationState");
  });
});
