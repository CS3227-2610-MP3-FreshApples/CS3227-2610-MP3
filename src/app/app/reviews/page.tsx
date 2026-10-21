import Link from "next/link";

export default function UserReviewsPage() {
  return (
    <section className="space-y-8" aria-labelledby="user-reviews-title">
      <header className="max-w-3xl space-y-3">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-700">Your account</p>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl" id="user-reviews-title">My reviews</h1>
        <p className="text-lg leading-8 text-slate-600">Published reviews will appear here when they are available.</p>
      </header>
      <section className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm" aria-labelledby="user-reviews-empty-title">
        <h2 className="text-xl font-semibold text-slate-950" id="user-reviews-empty-title">No published reviews yet</h2>
        <p className="mx-auto mt-2 max-w-xl text-slate-600">Browse the catalogue when you are ready to share a thoughtful perspective.</p>
        <Link className="mt-5 inline-flex min-h-11 items-center justify-center rounded-lg bg-blue-700 px-5 py-2.5 font-semibold text-white hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2" href="/movies">Browse movies</Link>
      </section>
    </section>
  );
}
