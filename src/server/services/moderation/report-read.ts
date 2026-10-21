import "server-only";

import type { Database } from "../../db";
import type { ReportRecord, ReportRepository } from "../../repositories/moderation/report-repository";
import type { AccountId, ReportId } from "../../shared";
import type { ReportReceipt } from "./report-evidence";

export interface ReportPage {
  readonly items: readonly ReportReceipt[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
}

export interface ReportReadService {
  list(reporterId: AccountId, page: number, pageSize: number): Promise<ReportPage>;
  get(reporterId: AccountId, reportId: ReportId): Promise<ReportReceipt | null>;
}

export function createReportReadService(deps: {
  readonly database: Pick<Database, "withTransaction">;
  readonly reports: Pick<ReportRepository, "listByReporter" | "findByReporter">;
}): ReportReadService {
  return {
    async list(reporterId, page, pageSize) {
      const result = await deps.database.withTransaction((tx) => deps.reports.listByReporter(tx, reporterId, pageSize, (page - 1) * pageSize));
      return { items: result.items.map(toReceipt), page, pageSize, total: result.total };
    },
    async get(reporterId, reportId) {
      return deps.database.withTransaction(async (tx) => {
        const report = await deps.reports.findByReporter(tx, reporterId, reportId);
        return report === null ? null : toReceipt(report);
      });
    },
  };
}

function toReceipt(record: ReportRecord): ReportReceipt {
  return {
    id: record.id,
    reviewId: record.reviewId,
    category: record.category,
    status: record.status,
    createdAt: record.createdAt,
    ...(record.disposition === undefined ? {} : { disposition: record.disposition }),
  };
}
