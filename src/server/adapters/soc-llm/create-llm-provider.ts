import "server-only";

import type { AiSettings, AppEnv } from "../../config";
import type { Result } from "../../shared";
import { createMarkerFakeLlmProvider } from "./marker-fake-provider";
import { createSocLlmProvider, type FetchFunction } from "./soc-llm-provider";
import type { LlmProvider } from "./types";

/**
 * The APP_ENV values that may run the marker fake (D-16, D-37). The AI configuration already refuses `fake`
 * elsewhere; this repeats the check so a wiring mistake cannot select it in production.
 */
const FAKE_PROVIDER_APP_ENVS: ReadonlySet<AppEnv> = new Set<AppEnv>(["local", "test", "development"]);

export type LlmProviderRefusal = { readonly kind: "fake_not_permitted" };

/**
 * Builds the running server's provider from validated AI settings (D-57, D-71): `soc_llm` gives the SoC
 * adapter and `fake` the marker fake, never the scripted test fake. `fake` is refused unless APP_ENV is
 * local, test or development.
 */
export function createLlmProvider(deps: {
  readonly settings: AiSettings;
  readonly appEnv: AppEnv;
  readonly fetch: FetchFunction;
}): Result<LlmProvider, LlmProviderRefusal> {
  const { soc } = deps.settings;
  switch (deps.settings.provider) {
    case "soc_llm":
      return {
        ok: true,
        value: createSocLlmProvider({ baseUrl: soc.baseUrl, apiKey: soc.apiKey, model: soc.model, fetch: deps.fetch }),
      };
    case "fake":
      if (!FAKE_PROVIDER_APP_ENVS.has(deps.appEnv)) {
        return { ok: false, error: { kind: "fake_not_permitted" } };
      }
      return { ok: true, value: createMarkerFakeLlmProvider({ modelId: soc.model }) };
  }
}
