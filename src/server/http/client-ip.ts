import "server-only";

export type ClientIpResolver = (headers: Headers) => string;

/** D-44 hosted resolver: Vercel overwrites x-real-ip; no forwarded header is trusted. */
export function clientIpFromVercelHeaders(headers: Headers): string {
  return headers.get("x-real-ip")?.trim() || "unknown";
}

/** D-44 local/test resolver: keep a stable, non-identifying rate-limit subject. */
export function placeholderClientIp(headers: Headers): string {
  void headers;
  return "unknown";
}
