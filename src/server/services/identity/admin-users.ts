import "server-only";

import type { Database } from "../../db";
import type { AdminUserRecord, AdminUserRepository } from "../../repositories/identity/admin-user-repository";
import type { AccountId, DomainError, Result, RowVersion } from "../../shared";
import type { Principal } from "./guards";
import type { AdminUserFilters } from "./account";
import type { AdminUserStatusInput } from "./admin-user-status-input";
import type { AccountStatusService } from "./account-status";
import type { AuditLog } from "../audit";
import type { RequestId } from "../../shared";

export interface AdminUser {
  readonly id: AccountId;
  readonly displayName: string;
  readonly status: "active" | "suspended";
  readonly version: RowVersion;
}

export interface AdminUserPage {
  readonly items: readonly AdminUser[];
  readonly total: number;
}

export interface AdminUserService {
  list(principal: Principal, filters: AdminUserFilters, page: number, pageSize: number): Promise<Result<AdminUserPage, DomainError>>;
  get(principal: Principal, accountId: AccountId): Promise<Result<AdminUser, DomainError>>;
  updateStatus(principal: Principal, accountId: AccountId, expected: RowVersion, input: AdminUserStatusInput, requestId: RequestId): Promise<Result<AdminUser, DomainError>>;
}

function toAdminUser(record: AdminUserRecord): AdminUser {
  return { id: record.id, displayName: record.displayName, status: record.status, version: record.version };
}

export function createAdminUserService(deps: {
  readonly database: Pick<Database, "withTransaction" | "withTransactionResult">;
  readonly users: AdminUserRepository;
  readonly accountStatus?: Pick<AccountStatusService, "lockUserAccountAtVersion" | "suspend" | "reinstate">;
  readonly auditLog?: AuditLog;
}): AdminUserService {
  return {
    async list(principal, filters, page, pageSize) {
      if (principal.role !== "ADMIN") return { ok: false, error: { kind: "forbidden" } };
      return deps.database.withTransaction(async (tx) => {
        const total = await deps.users.count(tx, filters);
        const offset = (page - 1) * pageSize;
        const records = offset >= total ? [] : await deps.users.list(tx, filters, pageSize, offset);
        return { ok: true, value: { items: records.map(toAdminUser), total } };
      });
    },
    async get(principal, accountId) {
      if (principal.role !== "ADMIN") return { ok: false, error: { kind: "forbidden" } };
      return deps.database.withTransaction(async (tx) => {
        const record = await deps.users.findById(tx, accountId);
        return record === null ? { ok: false, error: { kind: "not_found" } } : { ok: true, value: toAdminUser(record) };
      });
    },
    async updateStatus(principal, accountId, expected, input, requestId) {
      if (principal.role !== "ADMIN") return { ok: false, error: { kind: "forbidden" } };
      if (deps.accountStatus === undefined || deps.auditLog === undefined) return { ok: false, error: { kind: "unavailable" } };
      return deps.database.withTransactionResult<AdminUser, DomainError>(async (tx) => {
        const locked = await deps.accountStatus!.lockUserAccountAtVersion(tx, accountId, expected);
        if (!locked.ok) {
          if (locked.error.kind === "not_user_target") return { ok: false, error: { kind: "forbidden" } };
          return { ok: false, error: locked.error };
        }
        const change = input.status === "suspended"
          ? await deps.accountStatus!.suspend(tx, locked.value)
          : await deps.accountStatus!.reinstate(tx, locked.value);
        await deps.auditLog!.record(tx, {
          actorId: principal.accountId,
          action: input.status === "suspended" ? "account.suspend" : "account.reinstate",
          targetType: "account",
          targetId: accountId,
          result: change.changed ? "applied" : "no_op",
          metadata: { reason: input.reason, previousStatus: change.before, newStatus: change.after, previousVersion: expected, newVersion: change.version },
          requestId,
        });
        const updated = await deps.users.findById(tx, accountId);
        return updated === null ? { ok: false, error: { kind: "not_found" } } : { ok: true, value: toAdminUser(updated) };
      });
    },
  };
}
