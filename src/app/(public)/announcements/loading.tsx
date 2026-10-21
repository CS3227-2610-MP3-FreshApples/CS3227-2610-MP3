export default function AnnouncementsLoading() {
  return (
    <section className="space-y-4 py-8" aria-labelledby="announcements-loading-title">
      <h1 id="announcements-loading-title" className="text-3xl font-semibold tracking-tight">Announcements</h1>
      <p className="rounded-lg border border-slate-200 bg-white p-4 text-slate-600 shadow-sm" role="status">Loading announcements…</p>
    </section>
  );
}
