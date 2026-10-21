import Link from "next/link";

import { StatusMessage } from "../../../components/status-primitives";
import type { AdminFailure } from "../_lib/admin-http";

export const primaryButtonClass =
  "rounded-md bg-blue-700 px-4 py-2 font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:opacity-60";
export const secondaryButtonClass =
  "rounded-md border border-slate-400 px-3 py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:opacity-60";
export const linkClass = "text-blue-700 underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700";

type LoadFailureProps = Readonly<{
  failure: AdminFailure;
  onRetry: () => void;
}>;

/** The error state of a page whose data did not load. */
export function LoadFailure({ failure, onRetry }: LoadFailureProps) {
  return (
    <div className="space-y-3">
      <StatusMessage status="error">{failure.message}</StatusMessage>
      {failure.kind === "unauthenticated" ? (
        <p><Link className={linkClass} href="/sign-in">Sign in</Link></p>
      ) : failure.kind === "forbidden" || failure.kind === "not_found" ? null : (
        <button className={secondaryButtonClass} onClick={onRetry} type="button">Try again</button>
      )}
    </div>
  );
}

type FormFailureProps = Readonly<{
  message: string;
  details: readonly string[];
}>;

/** The summary of a failed submission; field-specific errors are shown beside their fields. */
export function FormFailure({ details, message }: FormFailureProps) {
  if (message === "") return null;
  return (
    <StatusMessage status="error">
      {message}
      {details.length > 0 ? ` ${details.join(" ")}` : null}
    </StatusMessage>
  );
}
