"use client";

type PublicReadErrorProps = Readonly<{
  error: Error & { digest?: string };
  reset: () => void;
}>;

export function PublicReadError({ reset }: PublicReadErrorProps) {
  return (
    <section aria-labelledby="public-read-error-title">
      <h1 id="public-read-error-title">We could not load this page. Please try again.</h1>
      <button type="button" onClick={reset}>
        Try again
      </button>
    </section>
  );
}
