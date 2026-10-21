export default function MovieDetailsLoading() {
  return (
    <section className="space-y-4 py-8" aria-labelledby="movie-details-loading-title">
      <h1 id="movie-details-loading-title" className="text-3xl font-semibold tracking-tight">Movie details</h1>
      <p className="rounded-lg border border-slate-200 bg-white p-4 text-slate-600 shadow-sm" role="status">Loading movie details…</p>
    </section>
  );
}
