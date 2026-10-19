import "server-only";

import type { SessionRepository } from "../../repositories/identity";
import type { AccountId, AccountRole, AccountStatus, AccountUpdateLock, Result, RowVersion, Tx } from "../../shared";

export type AccountLockFailure = { readonly kind: "not_found" } | { readonly kind: "not_user_target" };

export interface AccountStatusChange {
  readonly accountId: AccountId;
  readonly before: AccountStatus;
  readonly after: AccountStatus;
  readonly version: RowVersion;
  readonly strikeCycle: number;
  readonly changed: boolean;
}

export interface AccountStatusService {
  lockUserAccount(tx: Tx, accountId: AccountId): Promise<Result<AccountUpdateLock, AccountLockFailure>>;
  lockUserAccountAtVersion(tx: Tx, accountId: AccountId, expected: RowVersion): Promise<Result<AccountUpdateLock, AccountLockFailure | { readonly kind: "stale_version" }>>;
  suspend(tx: Tx, account: AccountUpdateLock): Promise<AccountStatusChange>;
  reinstate(tx: Tx, account: AccountUpdateLock): Promise<AccountStatusChange>;
}

interface AccountStatusRepository {
  lockById(tx: Tx, accountId: AccountId): Promise<(AccountUpdateLock & { readonly role: "USER" | "ADMIN" }) | null>;
  updateStatus(tx: Tx, account: AccountUpdateLock, status: AccountStatus, strikeCycle: number): Promise<{ readonly status: AccountStatus; readonly version: RowVersion; readonly strikeCycle: number }>;
}

export function createAccountStatusService(deps: {
  readonly accountRepository: AccountStatusRepository;
  readonly sessionRepository: Pick<SessionRepository, "deleteByAccountId">;
}): AccountStatusService {
  return {
    async lockUserAccount(tx, accountId) {
      return toUserTarget(await deps.accountRepository.lockById(tx, accountId));
    },
    async lockUserAccountAtVersion(tx, accountId, expected) {
      const locked = toUserTarget(await deps.accountRepository.lockById(tx, accountId));
      if (!locked.ok) return locked;
      return locked.value.version === expected ? locked : { ok: false, error: { kind: "stale_version" } };
    },
    async suspend(tx, account) {
      if (account.status === "suspended") return unchanged(account, "suspended");
      const updated = await deps.accountRepository.updateStatus(tx, account, "suspended", account.strikeCycle);
      await deps.sessionRepository.deleteByAccountId(tx, account.accountId);
      return { accountId: account.accountId, before: account.status, after: updated.status, version: updated.version, strikeCycle: updated.strikeCycle, changed: true };
    },
    async reinstate(tx, account) {
      if (account.status === "active") return unchanged(account, "active");
      const updated = await deps.accountRepository.updateStatus(tx, account, "active", account.strikeCycle + 1);
      return { accountId: account.accountId, before: account.status, after: updated.status, version: updated.version, strikeCycle: updated.strikeCycle, changed: true };
    },
  };
}

function toUserTarget(
  account: (AccountUpdateLock & { readonly role: AccountRole }) | null,
): Result<AccountUpdateLock, AccountLockFailure> {
  if (account === null) return { ok: false, error: { kind: "not_found" } };
  return account.role === "USER"
    ? { ok: true, value: account }
    : { ok: false, error: { kind: "not_user_target" } };
}

function unchanged(account: AccountUpdateLock, status: AccountStatus): AccountStatusChange {
  return { accountId: account.accountId, before: status, after: status, version: account.version, strikeCycle: account.strikeCycle, changed: false };
}
