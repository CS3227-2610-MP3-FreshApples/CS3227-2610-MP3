"use client";

import { PublicReadError } from "../../../components/public-read-error";

export default function AnnouncementsError({
  error,
  reset,
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  return <PublicReadError error={error} reset={reset} />;
}
