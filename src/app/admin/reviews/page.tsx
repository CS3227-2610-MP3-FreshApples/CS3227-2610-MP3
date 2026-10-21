import { AdminUnavailableState } from "../_components/admin-unavailable-state";

export default function AdminReviewsPage() {
  return <AdminUnavailableState description="The moderation workspace is reserved for approved review read models and human-only decisions." title="Review moderation" workspace="Moderation" />;
}
