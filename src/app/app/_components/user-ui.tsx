import Link from "next/link";

const backLinkClassName = "inline-flex min-h-11 items-center rounded-md border border-slate-300 bg-white px-4 py-2 font-semibold text-slate-800 hover:border-blue-700 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2";
const overviewCardClassName = "block rounded-xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-blue-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2";

export function UserBackLink({ href, label }: Readonly<{ href: string; label: string }>) {
  return <Link className={backLinkClassName} href={href}>← {label}</Link>;
}

type UserOverviewCardProps = Readonly<{
  href: string;
  title: string;
  titleId: string;
  description: string;
}>;

export function UserOverviewCard({ href, title, titleId, description }: UserOverviewCardProps) {
  return (
    <Link className={overviewCardClassName} href={href} aria-labelledby={titleId}>
      <h2 className="text-xl font-semibold text-slate-950" id={titleId}>{title}</h2>
      <p className="mt-2 text-slate-600">{description}</p>
    </Link>
  );
}

export function UserRetryButton({ onClick }: Readonly<{ onClick: () => void }>) {
  return <button className="rounded-md border border-slate-300 px-4 py-2 font-semibold" onClick={onClick} type="button">Try again</button>;
}
