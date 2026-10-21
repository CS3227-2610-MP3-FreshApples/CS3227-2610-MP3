"use client";

type PublicReadErrorProps = Readonly<{
  error: Error & { digest?: string };
  reset: () => void;
}>;

export function PublicReadError({ reset }: PublicReadErrorProps) {
  return (
    <section className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-950" aria-labelledby="public-read-error-title">
      <h1 className="text-xl font-semibold" id="public-read-error-title">We could not load this page. Please try again.</h1>
      <button className="mt-4 min-h-11 rounded-lg bg-red-700 px-4 py-2 font-medium text-white hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700" type="button" onClick={reset}>
        Try again
      </button>
    </section>
  );
}
