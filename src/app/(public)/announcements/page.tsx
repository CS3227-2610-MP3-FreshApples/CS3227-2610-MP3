import Link from "next/link";

import { PublicReadUnavailable } from "../../../components/public-read-unavailable";
import { publicAnnouncementReadService } from "../../../server/composition";

const PAGE_SIZE = 20;

export default async function AnnouncementsPage() {
  const result = publicAnnouncementReadService === null ? null : await publicAnnouncementReadService.listAnnouncements({ page: 1, pageSize: PAGE_SIZE });

  return (
    <section className="max-w-3xl space-y-8" aria-labelledby="announcements-title">
      <header className="space-y-3">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-700">From the FreshApples team</p>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl" id="announcements-title">Announcements</h1>
        <p className="text-lg leading-8 text-slate-600">Product news, community updates, and movie-related notices.</p>
      </header>
      {result === null ? <PublicReadUnavailable title="Announcements" titleId="announcements-unavailable-title" /> : result.items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8" role="status">There are no published announcements.</div>
      ) : (
        <ul className="space-y-4">
          {result.items.map((announcement) => (
            <li key={announcement.id}>
              <article className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-xl font-semibold tracking-tight text-slate-950">{announcement.title}</h2>
                <time className="mt-2 block text-sm text-slate-500" dateTime={announcement.publishedAt}>{new Date(announcement.publishedAt).toLocaleDateString("en-SG", { dateStyle: "medium", timeZone: "UTC" })}</time>
                <p className="mt-4 whitespace-pre-wrap break-words leading-7 text-slate-700">{announcement.body}</p>
                {announcement.movie === null ? null : (
                  <p className="mt-5 border-t border-slate-200 pt-4 text-sm text-slate-600">Related movie: <Link className="font-semibold text-blue-700 underline underline-offset-4 hover:text-blue-800" href={`/movies/${announcement.movie.id}`}>{announcement.movie.title}</Link></p>
                )}
              </article>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
