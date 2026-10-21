type PublicReadUnavailableProps = Readonly<{
  title: string;
  titleId: string;
}>;

export function PublicReadUnavailable({ title, titleId }: PublicReadUnavailableProps) {
  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-amber-950" aria-labelledby={titleId}>
      <h1 className="text-xl font-semibold" id={titleId}>{title}</h1>
      <p className="mt-2" role="alert">The service is temporarily unavailable. Please try again later.</p>
    </section>
  );
}
