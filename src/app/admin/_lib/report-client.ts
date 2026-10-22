import { adminRead, adminWrite, isListPage, isRecord, jsonBody, pageQuery, type AdminResult, type Fetcher, type ListPage } from "./admin-http";

export type ReportStatus = "open" | "accepted" | "dismissed";
export type ReportCategory = "profanity" | "harassment" | "hate" | "spam" | "other";
export type ReportState = "pending" | "flagged" | "cleared" | "hidden" | "deleted";
export type AdminReportListItem = Readonly<{ id: string; status: ReportStatus; category: ReportCategory; createdAt: string; version: number; reporter: { id: string; displayName: string }; target: { id: string; displayName: string; status: "active" | "suspended" }; review: { id: string; movieId: string; movieTitle: string; state: ReportState } }>;
export type AdminReportView = Readonly<AdminReportListItem & { explanation: string; evidence: Readonly<{ reviewId: string; reviewVersion: number; authorId: string; movieId: string; movieTitle: string; body: string; rating: number }>; liveReview: { version: number; moderationState: "pending" | "flagged" | "cleared"; hidden: boolean; deleted: boolean; movieArchived: boolean }; target: AdminReportListItem["target"] & { strikeCount: number; strikeThreshold: number }; projectedEffect: { strikeAdded: boolean; strikeCountAfter: number; wouldSuspend: boolean; accountStatusAfter: "active" | "suspended" }; decision: { id: string; disposition: "accepted" | "dismissed"; actions: readonly string[]; reason: string; createdAt: string } | null }>;
export type ReportFilters = Readonly<{ status: string; category: string }>;
export type ReportDecision = Readonly<{ disposition: "accepted" | "dismissed"; actions: readonly ("hide_review")[]; reason: string }>;
export type ReportDecisionResult = Readonly<{ report: AdminReportView; decision: { id: string; disposition: "accepted" | "dismissed"; actions: readonly string[]; reason: string }; strikeAdded: boolean; accountStatus: "active" | "suspended"; version: number }>;

export const REPORT_STATUS_OPTIONS = [["open", "Open"], ["accepted", "Accepted"], ["dismissed", "Dismissed"], ["all", "All reports"]] as const;
export const REPORT_CATEGORY_OPTIONS = [["all", "All categories"], ["profanity", "Profanity"], ["harassment", "Harassment"], ["hate", "Hate"], ["spam", "Spam"], ["other", "Other"]] as const;
const BASE = "/api/v1/admin/reports";
const positive = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const timestamp = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));
const status = (value: unknown): value is ReportStatus => value === "open" || value === "accepted" || value === "dismissed";
const category = (value: unknown): value is ReportCategory => ["profanity", "harassment", "hate", "spam", "other"].includes(value as string);
const state = (value: unknown): value is ReportState => ["pending", "flagged", "cleared", "hidden", "deleted"].includes(value as string);
function identity(value: unknown): value is { id: string; displayName: string } { return isRecord(value) && typeof value.id === "string" && typeof value.displayName === "string"; }
function targetIdentity(value: unknown): value is { id: string; displayName: string; status: "active" | "suspended" } { const record = isRecord(value) ? value : null; return record !== null && typeof record.id === "string" && typeof record.displayName === "string" && (record.status === "active" || record.status === "suspended"); }
function isListItem(value: unknown): value is AdminReportListItem { return isRecord(value) && typeof value.id === "string" && status(value.status) && category(value.category) && timestamp(value.createdAt) && positive(value.version) && identity(value.reporter) && targetIdentity(value.target) && isRecord(value.review) && typeof value.review.id === "string" && typeof value.review.movieId === "string" && typeof value.review.movieTitle === "string" && state(value.review.state); }
export function isAdminReport(value: unknown): value is AdminReportView {
  if (!isListItem(value)) return false;
  const candidate = value as unknown as Record<string, unknown>;
  const evidence = candidate.evidence;
  const liveReview = candidate.liveReview;
  const projectedEffect = candidate.projectedEffect;
  if (typeof candidate.explanation !== "string" || !isRecord(evidence) || !isRecord(liveReview) || !isRecord(projectedEffect)) return false;
  const target = candidate.target;
  if (!isRecord(target)) return false;
  const decision = candidate.decision;
  const validDecision = decision === null || (isRecord(decision) && typeof decision.id === "string" && (decision.disposition === "accepted" || decision.disposition === "dismissed") && Array.isArray(decision.actions) && decision.actions.every((action) => typeof action === "string") && typeof decision.reason === "string" && timestamp(decision.createdAt));
  return typeof evidence.reviewId === "string" && positive(evidence.reviewVersion) && typeof evidence.authorId === "string" && typeof evidence.movieId === "string" && typeof evidence.movieTitle === "string" && typeof evidence.body === "string" && positive(evidence.rating) && evidence.rating <= 10
    && positive(liveReview.version) && ["pending", "flagged", "cleared"].includes(liveReview.moderationState as string) && typeof liveReview.hidden === "boolean" && typeof liveReview.deleted === "boolean" && typeof liveReview.movieArchived === "boolean"
    && typeof target.strikeCount === "number" && Number.isInteger(target.strikeCount) && target.strikeCount >= 0 && positive(target.strikeThreshold)
    && evidence.reviewId === value.review.id && evidence.movieId === value.review.movieId && evidence.authorId === target.id
    && typeof projectedEffect.strikeAdded === "boolean" && typeof projectedEffect.strikeCountAfter === "number" && Number.isInteger(projectedEffect.strikeCountAfter) && projectedEffect.strikeCountAfter >= 0 && typeof projectedEffect.wouldSuspend === "boolean" && ["active", "suspended"].includes(projectedEffect.accountStatusAfter as string) && validDecision;
}
function filtersQuery(filters: ReportFilters): URLSearchParams { const query = new URLSearchParams(); if (filters.status !== "open") query.set("status", filters.status); if (filters.category !== "all") query.set("category", filters.category); return query; }
export function reportQueueHref(page: number, filters: ReportFilters): string { const query = filtersQuery(filters); query.set("page", String(page)); return `/admin/reports?${query}`; }
export function listReports(page: number, filters: ReportFilters, fetcher: Fetcher = fetch): Promise<AdminResult<ListPage<AdminReportListItem>>> { return adminRead(`${BASE}?${pageQuery(page)}&${filtersQuery(filters)}`, (body): body is ListPage<AdminReportListItem> => isListPage(body, isListItem), fetcher); }
export function getReport(id: string, fetcher: Fetcher = fetch): Promise<AdminResult<AdminReportView>> { return adminRead(`${BASE}/${encodeURIComponent(id)}`, isAdminReport, fetcher); }
function isDecisionResult(value: unknown): value is ReportDecisionResult { return isRecord(value) && isAdminReport(value.report) && isRecord(value.decision) && typeof value.decision.id === "string" && (value.decision.disposition === "accepted" || value.decision.disposition === "dismissed") && Array.isArray(value.decision.actions) && value.decision.actions.every((action) => typeof action === "string") && typeof value.decision.reason === "string" && typeof value.strikeAdded === "boolean" && (value.accountStatus === "active" || value.accountStatus === "suspended") && positive(value.version); }
export function validateReportReason(reason: string): string { const length = Array.from(reason.trim()).length; return length >= 10 && length <= 1000 ? "" : "Enter a reason of 10–1,000 characters."; }
export function decideReport(id: string, version: number, input: ReportDecision, fetcher: Fetcher = fetch): Promise<AdminResult<ReportDecisionResult>> { return adminWrite({ path: `${BASE}/${encodeURIComponent(id)}/decision`, method: "POST", version, body: { disposition: input.disposition, actions: input.actions, reason: input.reason.trim() } }, jsonBody(isDecisionResult), fetcher); }
