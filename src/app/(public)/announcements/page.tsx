import Link from "next/link";

import { PublicReadUnavailable } from "../../../components/public-read-unavailable";
import { publicAnnouncementReadService } from "../../../server/composition";

const PAGE_SIZE = 20;

export default async function AnnouncementsPage() {
  if (publicAnnouncementReadService === null) {
    return <PublicReadUnavailable title="Announcements" titleId="announcements-title" />;
  }

  const result = await publicAnnouncementReadService.listAnnouncements({ page: 1, pageSize: PAGE_SIZE });

  return (
    <section aria-labelledby="announcements-title">
      <h1 id="announcements-title">Announcements</h1>
      {result.items.length === 0 ? (
        <p role="status">There are no published announcements.</p>
      ) : (
        <ul>
          {result.items.map((announcement) => (
            <li key={announcement.id}>
              <article>
                <h2>{announcement.title}</h2>
                <time dateTime={announcement.publishedAt}>{announcement.publishedAt}</time>
                <p>{announcement.body}</p>
                {announcement.movie === null ? null : (
                  <p>Related movie: <Link href={`/movies/${announcement.movie.id}`}>{announcement.movie.title}</Link></p>
                )}
              </article>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
