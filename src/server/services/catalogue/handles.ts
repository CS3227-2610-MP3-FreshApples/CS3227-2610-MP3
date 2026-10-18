import "server-only";

import type { MovieId, MovieShareLock, MovieUpdateLock, ReviewsRevision } from "../../shared";

// The only constructors of Movie lock handles (contracts §2.3). Not exported from the module index: callers
// obtain handles from MovieLocks. The K7 fake in tests/support/fakes/ imports this file directly.

export function movieUpdateLock(movieId: MovieId, archived: boolean, reviewsRevision: number): MovieUpdateLock {
  return { movieId, archived, reviewsRevision: reviewsRevision as ReviewsRevision } as MovieUpdateLock;
}

export function movieShareLock(movieId: MovieId): MovieShareLock {
  return { movieId } as MovieShareLock;
}
