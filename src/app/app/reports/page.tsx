import { Suspense } from "react";

import { StatusMessage } from "../../../components/status-primitives";
import { UserBackLink } from "../_components/user-ui";
import { pageFromSearchParam } from "./_lib/report-client";
import { ReportList } from "./_components/report-list";

type UserReportsPageProps = Readonly<{ searchParams?: Promise<Record<string, string | string[] | undefined>> }>;

export default function UserReportsPage({ searchParams = Promise.resolve({}) }: UserReportsPageProps) {
  return (
    <section className="space-y-8" aria-labelledby="user-reports-title">
      <UserBackLink href="/app" label="Go back to overview" />
      <header className="max-w-3xl space-y-3">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-700">Your account</p>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl" id="user-reports-title">My reports</h1>
        <p className="text-lg leading-8 text-slate-600">No submitted reports yet? Reports you submit about published content remain visible only in your private account.</p>
      </header>
      <section className="rounded-xl border border-slate-200 bg-white p-6" aria-label="Report status">
        <Suspense fallback={<StatusMessage status="info">Loading submitted reports…</StatusMessage>}>
          {searchParams.then((query) => <ReportList page={pageFromSearchParam(query.page)} />)}
        </Suspense>
      </section>
    </section>
  );
}
