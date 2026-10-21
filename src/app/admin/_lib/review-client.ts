import {
  adminRead, adminWrite, isListPage, isRecord, jsonBody, pageQuery,
  type AdminResult, type Fetcher, type ListPage,
} from "./admin-http";

export type ReviewAssessment = Readonly<{
  contentRevision: number;
  capturedReviewVersion: number;
  modelId: string;
  promptVersion: string;
  policyVersion: string;
  generatedAt: string;
  result: Readonly<{
    assessment: "suspected_profanity" | "no_profanity_detected" | "uncertain";
    explanation: string;
    matches: readonly Readonly<{ quote: string; reason: string }>[];
    limitations: readonly string[];
  }>;
}>;
export type ReviewTransition = Readonly<{
  reviewId: string;
  version: number;
  moderationState: "pending" | "flagged" | "cleared";
  hidden: boolean;
  deleted: boolean;
  eligibilityChanged: boolean;
}>;
export type AdminReviewView = Readonly<{
  id: string;
  movieId: string;
  authorId: string;
  authorDisplayName: string;
  movieTitle: string;
  rating: number;
  body: string;
  version: number;
  contentRevision: number;
  moderationState: ReviewTransition["moderationState"];
  hidden: boolean;
  deleted: boolean;
  movieArchived: boolean;
  createdAt: string;
  updatedAt: string;
  latestAssessment: ReviewAssessment | null;
}>;
export type ReviewFilters = Readonly<{ movieId: string; assessment: string }>;

export const REVIEW_FILTER_OPTIONS = [
  ["all", "All assessments and states"], ["pending", "Pending"], ["flagged", "Flagged"],
  ["needs_manual_review", "Needs manual review"], ["failed", "Failed automatic assessment"],
  ["hidden", "Hidden"], ["deleted", "Deleted"], ["cleared", "Cleared"],
  ["suspected_profanity", "Suspected profanity"], ["uncertain", "Uncertain"],
  ["no_profanity_detected", "No profanity detected"],
] as const;

const BASE = "/api/v1/admin/reviews";
const positiveInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const isState = (value: unknown): value is ReviewTransition["moderationState"] => value === "pending" || value === "flagged" || value === "cleared";
const isTimestamp = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));

function isAssessment(value: unknown): value is ReviewAssessment {
  if (!isRecord(value) || !isRecord(value.result)) return false;
  const result = value.result;
  return positiveInteger(value.contentRevision) && positiveInteger(value.capturedReviewVersion)
    && typeof value.modelId === "string" && typeof value.promptVersion === "string" && typeof value.policyVersion === "string"
    && isTimestamp(value.generatedAt)
    && typeof result.assessment === "string" && ["suspected_profanity", "no_profanity_detected", "uncertain"].includes(result.assessment)
    && typeof result.explanation === "string"
    && Array.isArray(result.matches) && result.matches.every((match) => isRecord(match) && typeof match.quote === "string" && typeof match.reason === "string")
    && Array.isArray(result.limitations) && result.limitations.every((entry) => typeof entry === "string");
}
export function isAdminReview(value: unknown): value is AdminReviewView {
  return isRecord(value) && typeof value.id === "string" && typeof value.movieId === "string"
    && typeof value.authorId === "string" && typeof value.authorDisplayName === "string" && typeof value.movieTitle === "string"
    && positiveInteger(value.rating) && value.rating <= 10 && typeof value.body === "string"
    && positiveInteger(value.version) && positiveInteger(value.contentRevision) && isState(value.moderationState)
    && typeof value.hidden === "boolean" && typeof value.deleted === "boolean" && typeof value.movieArchived === "boolean"
    && isTimestamp(value.createdAt) && isTimestamp(value.updatedAt)
    && (value.latestAssessment === null || isAssessment(value.latestAssessment));
}
function isTransition(value: unknown): value is ReviewTransition {
  return isRecord(value) && typeof value.reviewId === "string" && positiveInteger(value.version)
    && isState(value.moderationState) && typeof value.hidden === "boolean" && typeof value.deleted === "boolean"
    && typeof value.eligibilityChanged === "boolean";
}
function filtersQuery(filters: ReviewFilters): URLSearchParams {
  const query = new URLSearchParams();
  if (filters.movieId.trim() !== "") query.set("movieId", filters.movieId.trim());
  if (filters.assessment !== "all") query.set("assessment", filters.assessment);
  return query;
}
export function reviewQueueHref(page: number, filters: ReviewFilters): string {
  const query = filtersQuery(filters);
  query.set("page", String(page));
  return `/admin/reviews?${query}`;
}
export function listReviews(page: number, filters: ReviewFilters, fetcher: Fetcher = fetch): Promise<AdminResult<ListPage<AdminReviewView>>> {
  return adminRead(`${BASE}?${pageQuery(page)}&${filtersQuery(filters)}`, (body): body is ListPage<AdminReviewView> => isListPage(body, isAdminReview), fetcher);
}
export function getReview(id: string, fetcher: Fetcher = fetch): Promise<AdminResult<AdminReviewView>> {
  return adminRead(`${BASE}/${encodeURIComponent(id)}`, isAdminReview, fetcher);
}
export function validateReviewReason(reason: string): string {
  const length = Array.from(reason.trim()).length;
  return length >= 10 && length <= 1000 ? "" : "Enter a reason of 10–1,000 characters.";
}
export function approveReview(id: string, version: number, reason: string, fetcher: Fetcher = fetch): Promise<AdminResult<ReviewTransition>> {
  return adminWrite({ path: `${BASE}/${encodeURIComponent(id)}/approve`, method: "POST", version, body: { reason: reason.trim() } }, jsonBody(isTransition), fetcher);
}
export function hideReview(id: string, version: number, reason: string, fetcher: Fetcher = fetch): Promise<AdminResult<ReviewTransition>> {
  return adminWrite({ path: `${BASE}/${encodeURIComponent(id)}/hide`, method: "POST", version, body: { reason: reason.trim() } }, jsonBody(isTransition), fetcher);
}
export function restoreReview(id: string, version: number, reason: string, fetcher: Fetcher = fetch): Promise<AdminResult<ReviewTransition>> {
  return adminWrite({ path: `${BASE}/${encodeURIComponent(id)}/restore`, method: "POST", version, body: { reason: reason.trim() } }, jsonBody(isTransition), fetcher);
}
