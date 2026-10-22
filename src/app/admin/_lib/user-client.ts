import { adminRead, adminWrite, isListPage, isRecord, jsonBody, pageQuery, type AdminResult, type Fetcher, type ListPage } from "./admin-http";

export type AdminUserStatus = "active" | "suspended";
export type AdminUser = Readonly<{ id: string; displayName: string; status: AdminUserStatus; version: number }>;
export type UserFilters = Readonly<{ status: "" | AdminUserStatus; q: string }>;
export type UserStatusInput = Readonly<{ status: AdminUserStatus; reason: string }>;

const BASE = "/api/v1/admin/users";
const positive = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;

export function isAdminUser(value: unknown): value is AdminUser {
  if (!isRecord(value) || Object.keys(value).some((key) => !["id", "displayName", "status", "version"].includes(key))) return false;
  return typeof value.id === "string" && typeof value.displayName === "string" && (value.status === "active" || value.status === "suspended") && positive(value.version);
}

function filtersQuery(filters: UserFilters): URLSearchParams {
  const query = new URLSearchParams();
  if (filters.status !== "") query.set("status", filters.status);
  const q = filters.q.trim();
  if (q !== "") query.set("q", q);
  return query;
}

export function userQueueHref(page: number, filters: UserFilters): string {
  const query = filtersQuery(filters);
  query.set("page", String(page));
  return `/admin/users?${query}`;
}

export function listUsers(page: number, filters: UserFilters, fetcher: Fetcher = fetch): Promise<AdminResult<ListPage<AdminUser>>> {
  return adminRead(`${BASE}?${pageQuery(page)}&${filtersQuery(filters)}`, (body): body is ListPage<AdminUser> => isListPage(body, isAdminUser), fetcher);
}

export async function updateUserStatus(id: string, version: number, input: UserStatusInput, fetcher: Fetcher = fetch): Promise<AdminResult<AdminUser>> {
  const result = await adminWrite({ path: `${BASE}/${encodeURIComponent(id)}/status`, method: "PATCH", version, body: { status: input.status, reason: input.reason.trim() } }, jsonBody(isAdminUser), fetcher);
  if (result.ok || result.kind !== "unavailable") return result;

  // A lost or malformed response does not undo a committed status change. Read back the safe
  // projection before suggesting a retry; never replay the mutation or accept stale/other-user data.
  const current = await adminRead(`${BASE}/${encodeURIComponent(id)}`, isAdminUser, fetcher);
  return current.ok && current.value.id === id && current.value.status === input.status && current.value.version > version
    ? current
    : result;
}

export function validateUserReason(reason: string): string {
  const length = Array.from(reason.trim()).length;
  return length >= 10 && length <= 1_000 ? "" : "Enter a reason of 10–1,000 characters.";
}
