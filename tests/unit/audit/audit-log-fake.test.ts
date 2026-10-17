import { vi } from "vitest";

// `server-only` throws outside the react-server export condition; Vitest runs in plain Node.
vi.mock("server-only", () => ({}));

import type { AccountId, Tx } from "../../../src/server/shared";
import { describeAuditLogContract } from "../../support/contracts/audit-log.contract";
import { createInMemoryAuditLog } from "../../support/fakes/audit-log";

const FAKE_TX = {} as Tx;

describeAuditLogContract("in-memory fake", async () => {
  const auditLog = createInMemoryAuditLog();
  return {
    auditLog,
    actorId: "55555555-5555-4555-8555-555555555555" as AccountId,
    record: (entry) => auditLog.record(FAKE_TX, entry),
    stored: async () => auditLog.entries.map((entry) => ({ ...entry })),
  };
});
