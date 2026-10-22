import "server-only";

import type { Database } from "../../../db";
import type { ModerationJobReadRepository, ModerationJobRecord } from "../../../repositories/ai";
import type { AiJobId, ReviewId } from "../../../shared";
import { MODERATION_ASSESSMENTS, type ModerationAssessment } from "./output-schema";

/** The D-102 response of `GET /ai/jobs/:id`. Safe fields only; timestamps are ISO 8601 UTC. */
export interface ModerationJobStatus {
  readonly id: AiJobId;
  readonly reviewId: ReviewId;
  readonly state: ModerationJobRecord["status"];
  readonly retryAfterSeconds: number | null;
  readonly result: { readonly assessment: ModerationAssessment } | null;
  readonly errorCode: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ModerationJobReadService {
  /** `null` for an unknown or non-moderation job (D-102: both are 404). Reads only; never dispatches work. */
  read(jobId: AiJobId): Promise<ModerationJobStatus | null>;
}

function isAssessment(value: string | null): value is ModerationAssessment {
  return (MODERATION_ASSESSMENTS as readonly (string | null)[]).includes(value);
}

/** Projects a stored job onto the D-102 fields. A stored assessment outside the AI-02 enum is never exposed. */
export function projectModerationJob(record: ModerationJobRecord): ModerationJobStatus {
  return {
    id: record.id,
    reviewId: record.reviewId,
    state: record.status,
    retryAfterSeconds: record.retryAfterSeconds,
    result: isAssessment(record.assessment) ? { assessment: record.assessment } : null,
    errorCode: record.errorCode,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function createModerationJobReadService(deps: {
  readonly database: Database;
  readonly jobs: ModerationJobReadRepository;
}): ModerationJobReadService {
  return {
    async read(jobId) {
      const record = await deps.database.withTransaction((tx) => deps.jobs.read(tx, jobId));
      return record === null ? null : projectModerationJob(record);
    },
  };
}
