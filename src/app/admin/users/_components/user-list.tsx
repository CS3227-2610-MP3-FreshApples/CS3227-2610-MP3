"use client";

import { useCallback, useState } from "react";

import { activateModal, containModalFocus } from "../../../../components/confirmation-dialog";
import { FormField } from "../../../../components/form-primitives";
import { Pagination } from "../../../../components/pagination";
import { LiveRegion, StatusBadge, StatusMessage } from "../../../../components/status-primitives";
import { DataTable } from "../../../../components/table-state";
import { LoadFailure, primaryButtonClass, secondaryButtonClass } from "../../_components/admin-feedback";
import { listUsers, updateUserStatus, userQueueHref, validateUserReason, type AdminUser, type UserFilters } from "../../_lib/user-client";
import { useAdminResource } from "../../_lib/use-admin-resource";

type UserListProps = Readonly<{ page: number; status: "" | "active" | "suspended"; q: string }>;

export function UserList({ page, status, q }: UserListProps) {
  const filters: UserFilters = { status, q };
  const load = useCallback(() => listUsers(page, { status, q }), [page, status, q]);
  const { state, reload } = useAdminResource(load);
  const [target, setTarget] = useState<AdminUser | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function begin(user: AdminUser) {
    setTarget(user);
    setReason("");
    setReasonError("");
    setMessage("");
    setError("");
  }

  async function submit() {
    if (target === null || busyId !== null) return;
    const validation = validateUserReason(reason);
    if (validation !== "") {
      setReasonError(validation);
      return;
    }
    const action = target.status === "active" ? "suspended" : "active";
    setBusyId(target.id);
    setError("");
    const result = await updateUserStatus(target.id, target.version, { status: action, reason });
    setBusyId(null);
    setTarget(null);
    if (result.ok) {
      setMessage(`${action === "suspended" ? "Suspended" : "Reinstated"} “${result.value.displayName}”.`);
      reload();
    } else {
      setError(result.message);
      if (result.kind === "stale" || result.kind === "not_found" || result.kind === "unavailable") reload();
    }
  }

  return <section className="space-y-6">
    <header className="space-y-2"><p className="text-sm font-semibold uppercase tracking-[0.16em] text-blue-700">Admin workspace / Accounts</p><h1 className="text-3xl font-semibold tracking-tight text-slate-950">Manage users</h1><p className="max-w-2xl text-sm leading-6 text-slate-600">Review account status and suspend or reinstate USER accounts. Private account and report details are not shown.</p></header>
    <form action="/admin/users" method="get" className="grid items-end gap-4 md:grid-cols-[minmax(0,1fr)_14rem_auto]">
      <FormField label="Search users" name="q"><input defaultValue={q} placeholder="Display name" type="search" /></FormField>
      <FormField label="Status" name="status"><select defaultValue={status}><option value="">All users</option><option value="active">Active</option><option value="suspended">Suspended</option></select></FormField>
      <button className={`${primaryButtonClass} min-h-11`} type="submit">Apply filters</button>
    </form>
    <LiveRegion message={message} />
    {error !== "" ? <StatusMessage status="error">{error}</StatusMessage> : null}
    {state.status === "loading" ? <StatusMessage status="info">Loading users…</StatusMessage> : null}
    {state.status === "error" ? <LoadFailure failure={state.failure} onRetry={reload} /> : null}
    {state.status === "ready" ? <>
      <DataTable caption="Users, ordered by display name" rows={state.value.items} rowKey={(user) => user.id} emptyMessage={state.value.total === 0 ? "No users match these filters." : "No users on this page."}
        columns={[{ header: "Display name", cell: (user) => <span>{user.displayName}</span> }, { header: "Status", cell: (user) => user.status === "active" ? <StatusBadge label="Active" tone="success" /> : <StatusBadge label="Suspended" tone="danger" /> }, { header: "Version", cell: (user) => <span>{user.version}</span> }, { header: "Actions", cell: (user) => <button aria-label={`${user.status === "active" ? "Suspend" : "Reinstate"} ${user.displayName}`} className={secondaryButtonClass} disabled={busyId !== null} onClick={() => begin(user)} type="button">{user.status === "active" ? "Suspend" : "Reinstate"}</button> }]} />
      <Pagination hrefForPage={(targetPage) => userQueueHref(targetPage, filters)} page={state.value.page} pageSize={state.value.pageSize} total={state.value.total} />
    </> : null}
    {target !== null ? <dialog ref={activateModal} onKeyDown={containModalFocus} aria-describedby="user-status-dialog-description" aria-labelledby="user-status-dialog-title" aria-modal="true" className="fixed inset-0 z-20 m-auto max-h-[85dvh] w-[min(92vw,36rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 shadow-xl backdrop:bg-slate-950/50" onCancel={(event) => { event.preventDefault(); if (busyId === null) setTarget(null); }} open role="dialog"><form className="space-y-5" onSubmit={(event) => { event.preventDefault(); void submit(); }}><h2 className="text-xl font-semibold" id="user-status-dialog-title">{target.status === "active" ? "Suspend" : "Reinstate"} {target.displayName}?</h2><p id="user-status-dialog-description" className="text-slate-600">{target.status === "active" ? "This revokes the user’s existing sessions." : "This permits a fresh login without restoring old sessions."}</p><FormField label="Reason" name="user-status-reason" hint="10–1,000 characters after trimming." error={reasonError}><textarea disabled={busyId !== null} maxLength={1000} minLength={10} onChange={(event) => setReason(event.target.value)} required rows={4} value={reason} /></FormField><div className="flex justify-end gap-3"><button className={secondaryButtonClass} disabled={busyId !== null} onClick={() => setTarget(null)} type="button">Cancel</button><button className={primaryButtonClass} disabled={busyId !== null} type="submit">{busyId === target.id ? "Saving…" : "Confirm"}</button></div></form></dialog> : null}
  </section>;
}
