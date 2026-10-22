import { StatusBadge } from "../../../../components/status-primitives";
import type { AdminReviewView } from "../../_lib/review-client";

export function ReviewState({ review }: Readonly<{ review: Pick<AdminReviewView, "moderationState" | "hidden" | "deleted" | "movieArchived"> }>) {
  return <div className="flex flex-wrap gap-2">
    <StatusBadge label={{ pending: "Pending", flagged: "Flagged", cleared: "Cleared" }[review.moderationState]}
      tone={review.moderationState === "cleared" ? "success" : "warning"} />
    {review.hidden ? <StatusBadge label="Hidden by Admin" tone="neutral" /> : null}
    {review.deleted ? <StatusBadge label="Deleted by author" tone="neutral" /> : null}
    {review.movieArchived ? <StatusBadge label="Movie archived" tone="neutral" /> : null}
  </div>;
}

export function visibilityMessage(review: Pick<AdminReviewView, "moderationState" | "hidden" | "deleted" | "movieArchived">): string {
  if (review.deleted) return "Not public: deleted by the author. Admin actions do not undo author deletion.";
  if (review.movieArchived) return "Not public: the Movie is archived.";
  if (review.hidden) return "Not public: hidden by an Admin.";
  if (review.moderationState === "pending") return "Not public: awaiting automatic assessment or human approval.";
  if (review.moderationState === "flagged") return "Not public: held for human review.";
  return "Public: cleared and visible on an active Movie.";
}
