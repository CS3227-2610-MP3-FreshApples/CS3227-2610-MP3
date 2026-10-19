import "server-only";

import type { AiExecutionController, AiExecutionOutcome } from "./types";

// Contract stub (D-52, contracts §22 AM-15). B#5 (S-06) added the real controller; the composition root still
// wires this stub, and constructs no LLM provider, when AI is disabled, there is no database or the provider
// factory refuses the configuration (D-71, D-78).

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
