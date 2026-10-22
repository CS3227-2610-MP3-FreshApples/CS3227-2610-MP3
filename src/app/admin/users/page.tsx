import { Suspense } from "react";
import { StatusMessage } from "../../../components/status-primitives";
import { pageFromSearchParam } from "../_lib/admin-http";
import { UserList } from "./_components/user-list";

export default function AdminUsersPage({ searchParams = Promise.resolve({}) }: Readonly<{ searchParams?: Promise<Record<string, string | string[] | undefined>> }>) {
  return <Suspense fallback={<StatusMessage status="info">Loading users…</StatusMessage>}>
    {searchParams.then((query) => {
      const rawStatus = typeof query.status === "string" ? query.status : "";
      const status = rawStatus === "active" || rawStatus === "suspended" ? rawStatus : "";
      const q = typeof query.q === "string" ? query.q : "";
      const page = pageFromSearchParam(query.page);
      return <UserList key={`${page}:${status}:${q}`} page={page} status={status} q={q} />;
    })}
  </Suspense>;
}
