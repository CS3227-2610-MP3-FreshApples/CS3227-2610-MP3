import "server-only";

import type { AiExecutionController, AiExecutionOutcome } from "./types";

// Contract stub (D-52, contracts §22 AM-15). B#5 (S-06) replaces it with the real controller. Until then the
// composition root wires this stub and constructs no LLM provider.

const DISABLED: AiExecutionOutcome = { kind: "disabled" };

/**
 * K10 controller stub. `run` always returns `disabled`, so work stays pending. It takes no dependencies:
 * it opens no Tx, writes nothing, calls no provider and never invokes `validate` or `publish`.
 */
export function createDisabledAiExecutionController(): AiExecutionController {
  return {
    run() {
      return Promise.resolve(DISABLED);
    },
  };
}
