import { Suspense } from "react";
import { StatusMessage } from "../../../../components/status-primitives";
import { ReviewDetail } from "../_components/review-detail";

export default function AdminReviewDetailPage({ params }: Readonly<{ params: Promise<{ id: string }> }>) {
  return <Suspense fallback={<StatusMessage status="info">Loading review…</StatusMessage>}>
    {params.then(({ id }) => <ReviewDetail key={id} reviewId={id} />)}
  </Suspense>;
}
