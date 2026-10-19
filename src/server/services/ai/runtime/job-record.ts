import "server-only";

import { createHash } from "node:crypto";

import type { LlmMessage } from "../../../adapters/soc-llm";
import type { NewAiJob } from "../../../repositories/ai";
import type { AiJobDescriptor } from "./types";

/**
 * The D-64 columns of a new running AIJob. Throws when the snapshot cannot be serialized; step 1 then rolls
 * back and defers (D-75).
 */
export function newAiJob(
  job: AiJobDescriptor,
  messages: readonly LlmMessage[],
  snapshot: Readonly<Record<string, unknown>>,
  modelId: string,
  leaseUntil: Date,
): NewAiJob {
  const common = {
    leaseUntil,
    modelId,
    promptVersion: job.promptVersion,
    inputHash: inputHash(messages),
    snapshotJson: serializeSnapshot(snapshot),
  };
  switch (job.type) {
    case "summary":
      return {
        ...common,
        type: "summary",
        trigger: "scheduler",
        requesterId: null,
        subjectId: job.movieId,
        inputRevision: job.reviewsRevision,
        policyVersion: null,
        dedupKey: JSON.stringify(["summary", job.movieId, job.reviewsRevision, modelId, job.promptVersion]),
      };
    case "review_moderation":
      return {
        ...common,
        type: "review_moderation",
        trigger: job.requesterId === null ? "scheduler" : "review_write",
        requesterId: job.requesterId,
        subjectId: job.reviewId,
        inputRevision: job.captured.contentRevision,
        policyVersion: job.policyVersion,
        dedupKey: JSON.stringify([
          "review_moderation",
          job.reviewId,
          job.captured.contentRevision,
          modelId,
          job.promptVersion,
          job.policyVersion,
        ]),
      };
  }
}

/** Lowercase hex SHA-256 of the messages as `{role, content}` objects in order (D-64). */
function inputHash(messages: readonly LlmMessage[]): string {
  const canonical = JSON.stringify(messages.map(({ role, content }) => ({ role, content })));
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** The caller's snapshot exactly as given (D-64). */
function serializeSnapshot(snapshot: Readonly<Record<string, unknown>>): string {
  const json = JSON.stringify(snapshot);
  if (typeof json !== "string") {
    throw new Error("bounded input snapshot is not serializable");
  }
  return json;
}
