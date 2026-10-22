import Link from "next/link";

const adminDestinations = [
  {
    href: "/admin/movies",
    eyebrow: "Catalogue",
    title: "Manage catalogue",
    description: "Create, update, and archive the movies available to members.",
    action: "Open movies",
  },
  {
    href: "/admin/announcements",
    eyebrow: "Editorial",
    title: "Publish announcements",
    description: "Keep members informed with clear, reviewable announcements.",
    action: "Open announcements",
  },
  {
    href: "/admin/reviews",
    eyebrow: "Moderation",
    title: "Moderation workspace",
    description: "Review moderation work when the approved read model is available.",
    action: "Open reviews",
  },
] as const;

export default function AdminOverviewPage() {
  return (
    <div className="space-y-8">
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="grid gap-8 px-6 py-8 sm:px-8 sm:py-10 lg:grid-cols-[1.3fr_0.7fr] lg:items-end">
          <div className="space-y-4">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-blue-700">Admin workspace</p>
            <div className="space-y-3">
              <h1 className="max-w-2xl text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">Keep the movie experience clear, current, and cared for.</h1>
              <p className="max-w-2xl text-base leading-7 text-slate-600">Use the workspace to maintain the catalogue and prepare member-facing updates. Each area keeps its work and feedback close at hand.</p>
            </div>
          </div>
          <div className="rounded-xl border border-blue-100 bg-blue-50 p-5">
            <p className="text-sm font-semibold text-blue-950">Operations at a glance</p>
            <p className="mt-2 text-sm leading-6 text-blue-900">Start with the area that needs attention. Changes remain explicit and reviewable before they reach members.</p>
          </div>
        </div>
      </section>

      <section aria-labelledby="admin-destinations-heading" className="space-y-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-500">Workspace areas</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950" id="admin-destinations-heading">Choose where to work</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {adminDestinations.map((destination) => (
            <article className="flex min-h-56 flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md" key={destination.href}>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{destination.eyebrow}</p>
              <h3 className="mt-3 text-xl font-semibold text-slate-950">{destination.title}</h3>
              <p className="mt-2 flex-1 text-sm leading-6 text-slate-600">{destination.description}</p>
              <Link className="mt-5 inline-flex min-h-11 w-fit items-center rounded-md bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2" href={destination.href}>{destination.action}<span aria-hidden="true" className="ml-2">→</span></Link>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
