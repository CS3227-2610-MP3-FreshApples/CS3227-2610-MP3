import "server-only";

import { z } from "zod";

import type { FieldErrors, ReportCategory, Result } from "../../shared";

export const ADMIN_REPORT_STATUSES = ["open", "accepted", "dismissed", "all"] as const;
export type AdminReportStatusFilter = (typeof ADMIN_REPORT_STATUSES)[number];

export const ADMIN_REPORT_CATEGORIES = ["profanity", "harassment", "hate", "spam", "other"] as const satisfies readonly ReportCategory[];
export type AdminReportCategoryFilter = (typeof ADMIN_REPORT_CATEGORIES)[number];

export interface AdminReportFilters {
  readonly status: AdminReportStatusFilter;
  readonly category: AdminReportCategoryFilter | null;
}

const statusSchema = z.enum(ADMIN_REPORT_STATUSES);
const categorySchema = z.enum(ADMIN_REPORT_CATEGORIES);

export function parseAdminReportFilters(query: URLSearchParams): Result<AdminReportFilters, FieldErrors> {
  const rawStatus = query.get("status") ?? "open";
  const rawCategory = query.get("category");
  const errors: Record<string, readonly string[]> = {};
  const status = statusSchema.safeParse(rawStatus);
  const category = rawCategory === null ? null : categorySchema.safeParse(rawCategory);

  if (!status.success) errors.status = ["invalid status filter"];
  if (rawCategory !== null && (category === null || !category.success)) errors.category = ["invalid category filter"];
  if (Object.keys(errors).length > 0 || !status.success) return { ok: false, error: errors };
  if (rawCategory === null) return { ok: true, value: { status: status.data, category: null } };
  if (category === null || !category.success) return { ok: false, error: errors };
  return { ok: true, value: { status: status.data, category: category.data } };
}
