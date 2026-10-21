import "server-only";

import type { Database } from "../../db";
import type { AccountId, MovieId } from "../../shared";
import type { ReviewRepository } from "../../repositories/reviews";
import { projectOwnReview, projectPublicReview, type OwnReview, type PublicReview } from "./review-read";

export interface ReviewPage<T> { readonly items: readonly T[]; readonly page: number; readonly pageSize: number; readonly total: number; }
export interface ReviewReadService {
  listPublic(movieId: MovieId, page: number, pageSize: number): Promise<ReviewPage<PublicReview> | null>;
  listOwn(authorId: AccountId, page: number, pageSize: number): Promise<ReviewPage<OwnReview>>;
}

export function createReviewReadService(deps: { readonly database: Pick<Database, "withTransaction">; readonly reviews: Pick<ReviewRepository, "listPublic" | "listOwn"> }): ReviewReadService {
  return {
    async listPublic(movieId, page, pageSize) {
      const result = await deps.database.withTransaction((tx) => deps.reviews.listPublic(tx, movieId, page, pageSize));
      if (result === null) return null;
      return { items: result.items.map(projectPublicReview), page, pageSize, total: result.total };
    },
    async listOwn(authorId, page, pageSize) {
      const result = await deps.database.withTransaction((tx) => deps.reviews.listOwn(tx, authorId, page, pageSize));
      return { items: result.items.map(projectOwnReview), page, pageSize, total: result.total };
    },
  };
}
