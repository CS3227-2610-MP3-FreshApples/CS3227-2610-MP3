export default function UserReportsPage() {
  return (
    <section className="space-y-8" aria-labelledby="user-reports-title">
      <header className="max-w-3xl space-y-3">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-700">Your account</p>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl" id="user-reports-title">My reports</h1>
        <p className="text-lg leading-8 text-slate-600">Your submitted reports are private and will appear here when available.</p>
      </header>
      <section className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm" aria-labelledby="user-reports-empty-title">
        <h2 className="text-xl font-semibold text-slate-950" id="user-reports-empty-title">No submitted reports yet</h2>
        <p className="mx-auto mt-2 max-w-xl text-slate-600">Reports you submit about published content will remain visible only in your account.</p>
      </section>
    </section>
  );
}
