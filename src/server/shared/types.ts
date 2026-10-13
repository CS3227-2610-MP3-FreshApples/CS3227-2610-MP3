import "server-only";

// Shared types for contracts K1–K12 (workflow/contracts.md §2). No credentials or ORM-private fields (architecture 6.6).

declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

// Opaque UUIDs (data-model §7). Parse untrusted input only through K2.
export type AccountId = Brand<string, "AccountId">;
export type SessionId = Brand<string, "SessionId">;
export type MovieId = Brand<string, "MovieId">;
export type ReviewId = Brand<string, "ReviewId">;
export type ReportId = Brand<string, "ReportId">;
export type AiJobId = Brand<string, "AiJobId">;
export type RequestId = Brand<string, "RequestId">;

export type RowVersion = Brand<number, "RowVersion">; // integer `version`
export type ContentRevision = Brand<number, "ContentRevision">; // Review.content_revision
export type ReviewsRevision = Brand<number, "ReviewsRevision">; // Movie.reviews_revision

export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export type AccountRole = "USER" | "ADMIN";
export type AccountStatus = "active" | "suspended";
export type ModerationState = "pending" | "flagged" | "cleared";
export type ReportCategory = "profanity" | "harassment" | "hate" | "spam" | "other";
export type ReportStatus = "open" | "dismissed" | "accepted";

export type FieldErrors = Readonly<Record<string, readonly string[]>>;

/** Expected domain outcomes; K2 maps each kind to its api.md §8.1 status. */
export type DomainError =
  | { readonly kind: "malformed" } // 400
  | { readonly kind: "payload_too_large" } // 413
  | { readonly kind: "unsupported_media_type" } // 415
  | { readonly kind: "unauthenticated" } // 401
  | { readonly kind: "forbidden" } // 403
  | { readonly kind: "csrf_failed" } // 403
  | { readonly kind: "not_found" } // 404 (missing or ownership-protected)
  | { readonly kind: "conflict" } // 409
  | { readonly kind: "stale_version" } // 409
  | { readonly kind: "invalid_fields"; readonly fieldErrors: FieldErrors } // 422
  | { readonly kind: "precondition_required" } // 428 (If-Match absent)
  | { readonly kind: "rate_limited"; readonly retryAfterSeconds: number } // 429 + Retry-After
  | { readonly kind: "unavailable" }; // 503

/** An open transaction. Opaque; produced only by K1 and valid only until it commits or rolls back. */
export type Tx = { readonly [brand]: "Tx" };

// Lock handles (§2.3, P-09). Only the owning module constructs one, and only inside the Tx that holds the lock.
declare const held: unique symbol;
export interface AccountShareLock {
  readonly accountId: AccountId;
  readonly [held]: "AccountShare";
}
export interface AccountUpdateLock {
  readonly accountId: AccountId;
  readonly status: AccountStatus;
  readonly version: RowVersion;
  readonly strikeCycle: number;
  readonly [held]: "AccountUpdate";
}
export interface MovieShareLock {
  readonly movieId: MovieId;
  readonly [held]: "MovieShare";
}
export interface MovieUpdateLock {
  readonly movieId: MovieId;
  readonly archived: boolean;
  readonly reviewsRevision: ReviewsRevision;
  readonly [held]: "MovieUpdate";
}
export interface ReviewUpdateLock {
  readonly reviewId: ReviewId;
  readonly movie: MovieUpdateLock;
  readonly version: RowVersion;
  readonly contentRevision: ContentRevision;
  readonly moderationState: ModerationState;
  readonly hidden: boolean;
  readonly deleted: boolean;
  readonly [held]: "ReviewUpdate";
}
