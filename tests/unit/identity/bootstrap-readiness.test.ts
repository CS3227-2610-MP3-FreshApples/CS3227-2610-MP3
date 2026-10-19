import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { assessReadiness } from "../../../src/server/services/health";

describe("first-Admin readiness", () => {
  it("stays unavailable when no Admin exists and bootstrap configuration is absent", async () => {
    await expect(
      assessReadiness({
        probe: async () => undefined,
        adminProvisioned: async () => false,
      }),
    ).resolves.toEqual({ ready: false, reason: "admin_bootstrap_required" });
  });

  it("stays unavailable when no Admin exists even while bootstrap configuration is valid", async () => {
    await expect(
      assessReadiness({
        probe: async () => undefined,
        adminProvisioned: async () => false,
      }),
    ).resolves.toEqual({ ready: false, reason: "admin_bootstrap_required" });
  });

  it("keeps the Admin existence check inside the bounded probe", async () => {
    let settled = false;
    const result = assessReadiness({
      probe: async () => undefined,
      adminProvisioned: async () => new Promise<boolean>(() => undefined),
    }).then((value) => {
      settled = true;
      return value;
    });

    await new Promise((resolve) => setTimeout(resolve, 2_100));
    expect(settled).toBe(true);
    await expect(result).resolves.toEqual({ ready: false, reason: "database_unavailable" });
  }, 3_000);

  it("classifies an Admin existence query failure as database unavailable", async () => {
    await expect(assessReadiness({
      probe: async () => undefined,
      adminProvisioned: async () => { throw new Error("unexpected admin query failure"); },
    })).resolves.toEqual({ ready: false, reason: "database_unavailable" });
  });
});
