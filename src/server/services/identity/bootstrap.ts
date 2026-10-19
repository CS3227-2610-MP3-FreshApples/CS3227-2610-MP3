import "server-only";

import type { Database } from "../../db";
import type { AccountCreateFailure, AccountRecord, NewAccount } from "../../repositories/identity";
import type { Tx } from "../../shared";
import type { AuditLog } from "../audit";
import type { RequestId } from "../../shared";
import { ServiceUnavailableError } from "../../shared";
import { hashPassword, normalizeEmail } from "./account";

export type BootstrapResult =
  | { readonly ok: true; readonly status: "created" | "already_provisioned" }
  | { readonly ok: false; readonly error: "invalid_fields" | "conflict" };

export interface FirstAdminBootstrapService {
  bootstrap(input: { readonly email: string; readonly password: string; readonly requestId: RequestId }): Promise<BootstrapResult>;
}

export interface BootstrapAccountRepository {
  lockAccountTableForFirstAdmin(tx: Tx): Promise<void>;
  countAdmins(tx: Tx): Promise<number>;
  createAdmin(tx: Tx, account: NewAccount): Promise<{ readonly ok: true; readonly value: AccountRecord } | { readonly ok: false; readonly error: AccountCreateFailure }>;
}

export function createFirstAdminBootstrapService(deps: {
  readonly database: Pick<Database, "withTransaction">;
  readonly accountRepository: BootstrapAccountRepository;
  readonly auditLog: AuditLog;
}): FirstAdminBootstrapService {
  return {
    async bootstrap(input) {
      const normalizedEmail = normalizeEmail(input.email);
      if (normalizedEmail === null) return { ok: false, error: "invalid_fields" };
      let passwordHash: string;
      try {
        passwordHash = await hashPassword(input.password);
      } catch {
        return { ok: false, error: "invalid_fields" };
      }

      try {
        return await deps.database.withTransaction(async (tx) => {
          await deps.accountRepository.lockAccountTableForFirstAdmin(tx);
          const adminCount = await deps.accountRepository.countAdmins(tx);
          if (adminCount > 0) {
            return { ok: true, status: "already_provisioned" } as const;
          }

          const created = await deps.accountRepository.createAdmin(tx, {
            normalizedEmail,
            passwordHash,
            displayName: "Admin",
          });
          if (!created.ok) return { ok: false, error: "conflict" } as const;
          await deps.auditLog.record(tx, {
            actorId: null,
            action: "account.admin_provisioned",
            targetType: "account",
            targetId: created.value.id,
            result: "applied",
            metadata: { role: "ADMIN", status: "active" },
            requestId: input.requestId,
          });
          return { ok: true, status: "created" } as const;
        });
      } catch {
        throw new ServiceUnavailableError();
      }
    },
  };
}
