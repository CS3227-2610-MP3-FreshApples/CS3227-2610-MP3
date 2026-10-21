type PublicReadUnavailableProps = Readonly<{
  title: string;
  titleId: string;
}>;

export function PublicReadUnavailable({ title, titleId }: PublicReadUnavailableProps) {
  return (
    <section aria-labelledby={titleId}>
      <h1 id={titleId}>{title}</h1>
      <p role="alert">The service is temporarily unavailable. Please try again later.</p>
    </section>
  );
}
