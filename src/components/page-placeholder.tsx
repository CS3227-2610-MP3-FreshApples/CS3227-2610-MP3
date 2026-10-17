type PagePlaceholderProps = Readonly<{
  description: string;
  title: string;
}>;

export function PagePlaceholder({ description, title }: PagePlaceholderProps) {
  return (
    <section>
      <h1>{title}</h1>
      <p>{description}</p>
    </section>
  );
}
