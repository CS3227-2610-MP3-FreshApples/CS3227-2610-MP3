import Link from "next/link";

export default function UserOverviewPage() {
  return (
    <section className="space-y-8" aria-labelledby="user-overview-title">
      <Link className="inline-flex min-h-11 items-center rounded-md border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-800 hover:border-blue-700 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2" href="/">← Back to main page</Link>
      <header className="max-w-3xl space-y-3">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-700">Your account</p>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl" id="user-overview-title">Your overview</h1>
        <p className="text-lg leading-8 text-slate-600">Keep track of your published reviews and submitted reports from one private space.</p>
      </header>
      <div className="grid gap-5 md:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm" aria-labelledby="user-reviews-card-title">
          <h2 className="text-xl font-semibold text-slate-950" id="user-reviews-card-title">Your reviews</h2>
          <p className="mt-2 text-slate-600">No published reviews yet.</p>
          <Link className="mt-5 inline-flex min-h-11 items-center font-semibold text-blue-700 underline underline-offset-4 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2" href="/app/reviews">View your reviews</Link>
        </section>
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm" aria-labelledby="user-reports-card-title">
          <h2 className="text-xl font-semibold text-slate-950" id="user-reports-card-title">Your reports</h2>
          <p className="mt-2 text-slate-600">No submitted reports yet.</p>
          <Link className="mt-5 inline-flex min-h-11 items-center font-semibold text-blue-700 underline underline-offset-4 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2" href="/app/reports">View your reports</Link>
        </section>
      </div>
    </section>
  );
}
