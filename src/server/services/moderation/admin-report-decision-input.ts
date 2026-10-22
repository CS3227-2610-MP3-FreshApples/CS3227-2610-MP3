import "server-only";

import { trimmedCodePointLength } from "../../http";
import type { FieldErrors, Result } from "../../shared";

export type AdminReportDecisionDisposition = "accepted" | "dismissed";
export type AdminReportDecisionAction = "hide_review";
export interface AdminReportDecisionInput { readonly disposition: AdminReportDecisionDisposition; readonly actions: readonly AdminReportDecisionAction[]; readonly reason: string }

const DISPOSITIONS = new Set<AdminReportDecisionDisposition>(["accepted", "dismissed"]);
const ACTIONS = new Set<AdminReportDecisionAction>(["hide_review"]);

export function parseAdminReportDecisionInput(input: unknown): Result<AdminReportDecisionInput, FieldErrors> {
  const errors: Record<string, readonly string[]> = {};
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, error: { body: ["must be an object"] } };
  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) if (key !== "disposition" && key !== "actions" && key !== "reason") errors[key] = ["is not permitted"];
  const disposition = record.disposition;
  if (typeof disposition !== "string" || !DISPOSITIONS.has(disposition as AdminReportDecisionDisposition)) errors.disposition = ["must be accepted or dismissed"];
  const actions = record.actions;
  if (!Array.isArray(actions) || actions.some((action) => typeof action !== "string" || !ACTIONS.has(action as AdminReportDecisionAction)) || new Set(actions).size !== actions.length) errors.actions = ["must contain only the permitted actions"];
  const reason = record.reason;
  if (typeof reason !== "string" || trimmedCodePointLength(reason) < 10 || trimmedCodePointLength(reason) > 1000) errors.reason = ["must contain 10 to 1,000 Unicode code points after trimming"];
  if (typeof disposition === "string" && disposition === "dismissed" && Array.isArray(actions) && actions.length > 0) errors.actions = ["dismissed decisions cannot hide a review"];
  if (Object.keys(errors).length > 0) return { ok: false, error: errors };
  return { ok: true, value: { disposition: disposition as AdminReportDecisionDisposition, actions: actions as AdminReportDecisionAction[], reason: (reason as string).trim() } };
}
