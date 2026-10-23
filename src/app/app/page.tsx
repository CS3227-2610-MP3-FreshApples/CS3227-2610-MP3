import { UserBackLink, UserOverviewCard } from "./_components/user-ui";

export default function UserOverviewPage() {
  return (
    <section className="space-y-8" aria-labelledby="user-overview-title">
      <UserBackLink href="/movies" label="Go back to movies" />
      <header className="max-w-3xl space-y-3">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-700">Your account</p>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl" id="user-overview-title">Your overview</h1>
        <p className="text-lg leading-8 text-slate-600">Keep track of your published reviews and submitted reports from one private space.</p>
      </header>
      <div className="grid gap-5 md:grid-cols-2">
        <UserOverviewCard href="/app/reviews" title="Your reviews" titleId="user-reviews-card-title" description="No published reviews yet." />
        <UserOverviewCard href="/app/reports" title="Your reports" titleId="user-reports-card-title" description="No submitted reports yet." />
      </div>
    </section>
  );
}
