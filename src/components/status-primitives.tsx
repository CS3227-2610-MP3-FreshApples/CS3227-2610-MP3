type Status = "error" | "info" | "success" | "warning";

type StatusBadgeProps = Readonly<{
  label: string;
  tone: "danger" | "neutral" | "success" | "warning";
}>;

export function StatusBadge({ label, tone }: StatusBadgeProps) {
  const toneClass = {
    danger: "border-red-200 bg-red-50 text-red-800",
    neutral: "border-slate-200 bg-slate-100 text-slate-800",
    success: "border-green-200 bg-green-50 text-green-800",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
  }[tone];

  return <span className={`inline-flex min-h-7 items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${toneClass}`} data-tone={tone} role={tone === "danger" ? "alert" : "status"}>{label}</span>;
}

type StatusMessageProps = Readonly<{
  children?: React.ReactNode;
  status: Status;
}>;

export function StatusMessage({ children, status }: StatusMessageProps) {
  const toneClass = {
    error: "border-red-200 bg-red-50 text-red-800",
    info: "border-blue-200 bg-blue-50 text-blue-900",
    success: "border-green-200 bg-green-50 text-green-800",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
  }[status];

  return (
    <p className={`rounded-md border px-4 py-3 text-sm ${toneClass}`} data-status={status} role={status === "error" ? "alert" : "status"}>
      {children}
    </p>
  );
}

type LiveRegionProps = Readonly<{
  message: string;
}>;

export function LiveRegion({ message }: LiveRegionProps) {
  return (
    <p aria-atomic="true" aria-live="polite" role="status">
      {message}
    </p>
  );
}
