import Link from "next/link";

import { RouteShell, publicNavigation } from "../components/route-shell";
import { publicNavigationBase } from "../components/navigation-data";
import { PublicUserAccountControl } from "../components/user-account-control";

export default function Home() {
  return (
    <RouteShell authAware authLoadingLinks={publicNavigationBase} headerAction={<PublicUserAccountControl />} links={publicNavigation} title="FreshApples">
      <section className="grid gap-8 py-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)] lg:items-center lg:py-16" aria-labelledby="home-title">
        <div className="space-y-6">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-700">FreshApples Movie Reviews</p>
          <div className="space-y-4">
            <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl" id="home-title">Find your next movie through community reviews.</h1>
            <p className="max-w-2xl text-lg leading-8 text-slate-600">Browse thoughtful movie opinions, compare ratings, and share your own perspective. Reviews are moderated before publication to keep the community useful.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link className="inline-flex min-h-11 items-center justify-center rounded-md bg-blue-700 px-5 py-2.5 font-semibold text-white transition-colors hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2" href="/movies">Browse movies</Link>
            <Link className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-5 py-2.5 font-semibold text-slate-800 transition-colors hover:border-blue-700 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2" href="/announcements">Read announcements</Link>
          </div>
        </div>
        <ul className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1" aria-label="Community features">
          {[
            ["Ratings out of 10", "Make quick comparisons without losing nuance."],
            ["Text-first reviews", "Read the reasoning behind every rating."],
            ["Moderated before publication", "Keep public conversations thoughtful."],
          ].map(([title, description]) => (
            <li className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" key={title}>
              <h2 className="font-semibold text-slate-950">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
            </li>
          ))}
        </ul>
      </section>
    </RouteShell>
  );
}
