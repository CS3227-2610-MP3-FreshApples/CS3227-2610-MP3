import { Suspense } from "react";
import { StatusMessage } from "../../../../components/status-primitives";
import { ReportDetail } from "../_components/report-detail";

export default function AdminReportDetailPage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  return <Suspense fallback={<StatusMessage status="info">Loading report…</StatusMessage>}>
    {params.then(({ id }) => <ReportDetail key={id} reportId={id} />)}
  </Suspense>;
}
