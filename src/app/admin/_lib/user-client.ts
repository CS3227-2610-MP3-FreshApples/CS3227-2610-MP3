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

export function updateUserStatus(id: string, version: number, input: UserStatusInput, fetcher: Fetcher = fetch): Promise<AdminResult<AdminUser>> {
  return adminWrite({ path: `${BASE}/${encodeURIComponent(id)}/status`, method: "PATCH", version, body: { status: input.status, reason: input.reason.trim() } }, jsonBody(isAdminUser), fetcher);
}

export function validateUserReason(reason: string): string {
  const length = Array.from(reason.trim()).length;
  return length >= 10 && length <= 1_000 ? "" : "Enter a reason of 10–1,000 characters.";
}
