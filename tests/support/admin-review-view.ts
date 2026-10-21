/** Synthetic Admin Review API fixture; no production data. */
export const adminReviewView = {
  id: "10000000-0000-4000-8000-000000000001",
  movieId: "20000000-0000-4000-8000-000000000001",
  authorId: "30000000-0000-4000-8000-000000000001",
  authorDisplayName: "Synthetic Author",
  movieTitle: "Synthetic Movie",
  rating: 7,
  body: "A thoughtful story with a memorable ending.",
  version: 1,
  contentRevision: 1,
  moderationState: "pending" as const,
  hidden: false,
  deleted: false,
  movieArchived: false,
  createdAt: "2026-10-22T00:00:00.000Z",
  updatedAt: "2026-10-22T00:00:00.000Z",
  latestAssessment: null,
};
