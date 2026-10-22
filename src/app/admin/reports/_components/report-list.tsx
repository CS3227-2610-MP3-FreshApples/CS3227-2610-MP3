"use client";

import Link from "next/link";
import { useCallback } from "react";
import { FormField } from "../../../../components/form-primitives";
import { Pagination } from "../../../../components/pagination";
import { LiveRegion, StatusMessage } from "../../../../components/status-primitives";
import { DataTable } from "../../../../components/table-state";
import { linkClass, primaryButtonClass } from "../../_components/admin-feedback";
import { formatUtc } from "../../_lib/admin-http";
import { listReports, reportQueueHref, REPORT_CATEGORY_OPTIONS, REPORT_STATUS_OPTIONS, type ReportFilters } from "../../_lib/report-client";
import { useAdminResource } from "../../_lib/use-admin-resource";

export function ReportList({ page, status, category }: ReportFilters & Readonly<{ page: number }>) {
  const load = useCallback(() => listReports(page, { status, category }), [page, status, category]);
  const { state } = useAdminResource(load);
  return <section className="space-y-6">
    <header className="space-y-2"><h1 className="text-2xl font-semibold">Report moderation</h1><p>Review submitted reports and apply a human decision.</p></header>
    <form action="/admin/reports" method="get" className="grid items-end gap-4 md:grid-cols-3">
      <FormField label="Report status" name="status"><select defaultValue={status}>{REPORT_STATUS_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FormField>
      <FormField label="Category" name="category"><select defaultValue={category}>{REPORT_CATEGORY_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></FormField>
      <div className="flex flex-wrap items-center gap-4"><button className={primaryButtonClass} type="submit">Apply filters</button><Link className={linkClass} href="/admin/reports">Open reports</Link></div>
    </form>
    <LiveRegion message={state.status === "ready" ? `${state.value.total} reports found. Page ${state.value.page}.` : ""} />
    {state.status === "loading" ? <StatusMessage status="info">Loading reports…</StatusMessage> : null}
    {state.status === "error" ? <StatusMessage status="error">{state.failure.message}</StatusMessage> : null}
    {state.status === "ready" ? <>
      <DataTable caption="Reports, newest first" rows={state.value.items} rowKey={(report) => report.id} emptyMessage="No reports match these filters. Choose Open reports to reset the queue."
        columns={[{ header: "Report", cell: (report) => <Link className={linkClass} href={`/admin/reports/${encodeURIComponent(report.id)}`}>{report.category} report</Link> }, { header: "Target", cell: (report) => <span>{report.target.displayName}</span> }, { header: "Review", cell: (report) => <span>{report.review.movieTitle} ({report.review.state})</span> }, { header: "Status", cell: (report) => <span>{report.status}</span> }, { header: "Created", cell: (report) => <time dateTime={report.createdAt}>{formatUtc(report.createdAt)}</time> }]} />
      <Pagination page={state.value.page} pageSize={state.value.pageSize} total={state.value.total} hrefForPage={(target) => reportQueueHref(target, { status, category })} />
    </> : null}
  </section>;
}
