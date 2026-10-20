import "server-only";

/** Covers connection acquisition and the query (D-36). K1 `probe()` applies the same limit itself. */
export const READINESS_PROBE_TIMEOUT_MS = 2_000;

/**
 * What readiness is decided from (D-38): either the names of the invalid core variables, or the probe of a
 * database built from valid core configuration. One of two values, never a validity flag beside both.
 */
export type ReadinessInput =
  | { readonly invalidCoreVariables: readonly string[] }
  | {
      readonly probe: () => Promise<void>;
      readonly adminProvisioned?: () => Promise<boolean>;
    };

export type ReadinessFailure =
  | { readonly ready: false; readonly reason: "core_config_invalid"; readonly variables: readonly string[] }
  | { readonly ready: false; readonly reason: "database_unavailable" | "admin_bootstrap_required" | "unexpected_error" };

export type Readiness = { readonly ready: true } | ReadinessFailure;

const READY: Readiness = { ready: true };
const DATABASE_UNAVAILABLE: ReadinessFailure = { ready: false, reason: "database_unavailable" };

class DatabaseProbeFailure extends Error {}
class ReadinessProbeTimeout extends Error {}
class AdminBootstrapRequired extends Error {}

async function probeWithin(probe: () => Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ReadinessProbeTimeout()), ms);
  });
  try {
    await Promise.race([probe(), expired]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Decides readiness (D-38). Invalid core configuration is unavailable without probing. Otherwise the probe
 * runs once, and a rejection or a probe still unsettled after 2 seconds is unavailable. Never throws, and
 * the result carries no error text.
 */
export async function assessReadiness(input: ReadinessInput): Promise<Readiness> {
  if ("invalidCoreVariables" in input) {
    return { ready: false, reason: "core_config_invalid", variables: [...new Set(input.invalidCoreVariables)] };
  }
  try {
    await probeWithin(async () => {
      try {
        await input.probe();
      } catch {
        throw new DatabaseProbeFailure();
      }
      if (input.adminProvisioned !== undefined) {
        let provisioned: boolean;
        try {
          provisioned = await input.adminProvisioned();
        } catch {
          throw new DatabaseProbeFailure();
        }
        if (!provisioned) throw new AdminBootstrapRequired();
      }
    }, READINESS_PROBE_TIMEOUT_MS);
    return READY;
  } catch (error) {
    if (error instanceof DatabaseProbeFailure || error instanceof ReadinessProbeTimeout) return DATABASE_UNAVAILABLE;
    if (error instanceof AdminBootstrapRequired) return { ready: false, reason: "admin_bootstrap_required" };
    return { ready: false, reason: "unexpected_error" };
  }
}

/** The single D-39 line for a 503 readiness response. Variable names only; no messages, hosts or stacks. */
export function readinessUnavailableLogLine(requestId: string, failure: ReadinessFailure): string {
  const variables = failure.reason === "core_config_invalid" ? { variables: failure.variables } : {};
  return JSON.stringify({ event: "health.ready.unavailable", requestId, reason: failure.reason, ...variables });
}
