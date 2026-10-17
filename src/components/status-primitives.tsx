type Status = "error" | "info" | "success" | "warning";

type StatusBadgeProps = Readonly<{
  label: string;
  tone: "danger" | "neutral" | "success" | "warning";
}>;

export function StatusBadge({ label, tone }: StatusBadgeProps) {
  return <span data-tone={tone} role={tone === "danger" ? "alert" : "status"}>{label}</span>;
}

type StatusMessageProps = Readonly<{
  children?: React.ReactNode;
  status: Status;
}>;

export function StatusMessage({ children, status }: StatusMessageProps) {
  return (
    <p data-status={status} role={status === "error" ? "alert" : "status"}>
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
