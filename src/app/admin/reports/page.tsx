import { Suspense } from "react";
import { StatusMessage } from "../../../components/status-primitives";
import { pageFromSearchParam } from "../_lib/admin-http";
import { ReportList } from "./_components/report-list";

export default function AdminReportsPage({ searchParams }: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  return <Suspense fallback={<StatusMessage status="info">Loading reports…</StatusMessage>}>
    {searchParams.then((query) => <ReportList key={`${query.page}:${query.status}:${query.category}`} page={pageFromSearchParam(query.page)} status={typeof query.status === "string" ? query.status : "open"} category={typeof query.category === "string" ? query.category : "all"} />)}
  </Suspense>;
}
