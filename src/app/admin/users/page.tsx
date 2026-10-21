import { AdminUnavailableState } from "../_components/admin-unavailable-state";

export default function AdminUsersPage() {
  return <AdminUnavailableState description="Account status information will remain protected until the approved Admin user read model is available." title="Manage users" workspace="Accounts" />;
}
