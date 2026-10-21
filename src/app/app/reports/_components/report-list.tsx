"use client";

import { useCallback, useEffect, useState } from "react";

import { Pagination } from "../../../../components/pagination";
import { StatusMessage } from "../../../../components/status-primitives";
import { DataTable } from "../../../../components/table-state";
import { formatReportDate, listOwnReports, reportCategoryLabel, type ReportFailure, type ReportPage } from "../_lib/report-client";

type ReportListState = Readonly<{ status: "loading" }> | Readonly<{ status: "error"; failure: ReportFailure }> | Readonly<{ status: "ready"; value: ReportPage }>;

export function ReportList({ page }: Readonly<{ page: number }>) {
  const [state, setState] = useState<ReportListState>({ status: "loading" });
  const [generation, setGeneration] = useState(0);
  const reload = useCallback(() => { setState({ status: "loading" }); setGeneration((value) => value + 1); }, []);
  useEffect(() => { let current = true; void listOwnReports(page).then((result) => { if (!current) return; setState(result.ok ? { status: "ready", value: result.value } : { status: "error", failure: result }); }); return () => { current = false; }; }, [generation, page]);
  if (state.status === "loading") return <StatusMessage status="info">Loading submitted reports…</StatusMessage>;
  if (state.status === "error") return <section className="space-y-4" aria-label="Report status"><StatusMessage status="error">{state.failure.message}</StatusMessage><button className="rounded-md border border-slate-300 px-4 py-2 font-semibold" onClick={reload} type="button">Try again</button></section>;
  return <section className="space-y-6" aria-label="Report status"><DataTable caption="Your submitted reports" columns={[{ header: "Category", cell: (report) => reportCategoryLabel(report.category) }, { header: "Status", cell: (report) => report.status === "open" ? "Submitted — awaiting review" : report.disposition === "accepted" ? "Accepted" : "Dismissed" }, { header: "Submitted", cell: (report) => <time dateTime={report.createdAt}>{formatReportDate(report.createdAt)}</time> }]} emptyMessage="No submitted reports yet. Use Report user on a published review when you need to raise an allegation for Admin review." rowKey={(report) => report.id} rows={state.value.items} /><Pagination hrefForPage={(target) => `/app/reports?page=${target}`} page={state.value.page} pageSize={state.value.pageSize} total={state.value.total} /></section>;
}
