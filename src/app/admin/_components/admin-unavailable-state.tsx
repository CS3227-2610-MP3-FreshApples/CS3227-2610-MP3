import Link from "next/link";

type AdminUnavailableStateProps = Readonly<{
  description: string;
  title: string;
  workspace: string;
}>;

export function AdminUnavailableState({ description, title, workspace }: AdminUnavailableStateProps) {
  return (
    <section className="space-y-6" data-admin-state="unavailable">
      <header className="space-y-2">
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-blue-700">Admin workspace / {workspace}</p>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{title}</h1>
        <p className="max-w-2xl text-base leading-7 text-slate-600">{description}</p>
      </header>

      <div className="max-w-3xl rounded-2xl border border-blue-100 bg-blue-50 p-6 sm:p-8">
        <p className="text-sm font-semibold uppercase tracking-[0.14em] text-blue-800">Not available yet</p>
        <h2 className="mt-2 text-xl font-semibold text-blue-950">No admin data is available yet.</h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-blue-900">This workspace will become interactive when its approved read model is available. Until then, no records, metrics, or decision controls are shown here.</p>
        <Link className="mt-6 inline-flex min-h-11 items-center rounded-md border border-blue-300 bg-white px-4 py-2 text-sm font-semibold text-blue-900 transition-colors hover:border-blue-700 hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2" href="/admin">Return to Admin overview<span aria-hidden="true" className="ml-2">→</span></Link>
      </div>
    </section>
  );
}
