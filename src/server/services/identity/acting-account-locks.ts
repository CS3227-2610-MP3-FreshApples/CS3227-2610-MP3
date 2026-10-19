import "server-only";

import type { AccountRepository } from "../../repositories/identity";
import type { AccountId, AccountShareLock, Result, Tx } from "../../shared";

type ActingAccountLockFailure = { readonly kind: "forbidden" };

export interface ActingAccountLocks {
  lockActiveUserShared(
    tx: Tx,
    accountId: AccountId,
  ): Promise<Result<AccountShareLock, ActingAccountLockFailure>>;
}

export function createActingAccountLocks(deps: {
  readonly accountRepository: Pick<AccountRepository, "lockActiveUserShared">;
}): ActingAccountLocks {
  return {
    async lockActiveUserShared(tx, accountId) {
      const locked = await deps.accountRepository.lockActiveUserShared(tx, accountId);
      return locked === null
        ? { ok: false, error: { kind: "forbidden" } }
        : { ok: true, value: locked };
    },
  };
}
