import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { EligibleReviewRecord, SummaryInputSnapshot } from "../../../src/server/repositories/summary";
import {
  buildModerationInput,
  parseModerationOutput,
  REVIEW_SCREENING_SYSTEM_PROMPT,
  type ScreeningSubject,
} from "../../../src/server/services/ai/moderation";
import {
  parseSummaryOutput,
  prepareSummaryInput,
  SUMMARY_SYSTEM_PROMPT,
  type SummaryPreparation,
} from "../../../src/server/services/ai/summary";
import type {
  ContentRevision,
  MovieId,
  ReviewId,
  ReviewsRevision,
  RowVersion,
} from "../../../src/server/shared";
import {
  ADVERSARIAL_REVIEW_TEXTS,
  AI_CONTAINMENT_FIXTURE_VERSION,
  BENIGN_REVIEW_TEXTS,
  INVALID_MODERATION_OUTPUTS,
  INVALID_SUMMARY_OUTPUTS,
  MALICIOUS_REPORT_EXPLANATION,
} from "../../ai-evaluation/containment-v1";

const MOVIE_ID = "20000000-0000-4000-8000-0000000000e1" as MovieId;
const REVIEW_ID = "30000000-0000-4000-8000-0000000000e1" as ReviewId;
const LABELS = ["R1", "R2", "R3"];

function review(index: number, body: string): EligibleReviewRecord {
  return {
    id: `30000000-0000-4000-8000-${String(index).padStart(12, "0")}` as ReviewId,
    version: 1 as RowVersion,
    contentRevision: 1 as ContentRevision,
    rating: 7,
    body,
  };
}

function summaryMessagesFor(text: string) {
  const reviews = [review(1, text), review(2, "A second synthetic review."), review(3, "A third synthetic review.")];
  const snapshot: SummaryInputSnapshot = {
    reviewsRevision: 1 as ReviewsRevision,
    hasCurrentSummary: false,
    reviews,
  };
  const result: SummaryPreparation = prepareSummaryInput(
    MOVIE_ID,
    snapshot,
    { sampleSize: 3, inputTokenLimit: 8_000 },
    Buffer.alloc(32, 0x2a),
  );
  if (result.kind !== "ready") throw new Error(`expected ready, received ${result.kind}`);
  return result.input.messages;
}

function moderationMessagesFor(text: string) {
  const subject: ScreeningSubject & { readonly reportExplanation: string } = {
    reviewId: REVIEW_ID,
    contentRevision: 2 as ContentRevision,
    version: 3 as RowVersion,
    body: text,
    reportExplanation: MALICIOUS_REPORT_EXPLANATION,
  };
  const result = buildModerationInput(subject, 8_000);
  if (result.kind !== "ready") throw new Error("expected ready moderation input");
  return result.input.messages;
}

describe(`${AI_CONTAINMENT_FIXTURE_VERSION}: input separation (AI-04, SEC-08, AT-11)`, () => {
  const cases = [...BENIGN_REVIEW_TEXTS, ...ADVERSARIAL_REVIEW_TEXTS];

  it.each(cases)("keeps summary fixture $id as an exact JSON field", ({ text }) => {
    const messages = summaryMessagesFor(text);
    expect(messages[0]).toEqual({ role: "system", content: SUMMARY_SYSTEM_PROMPT });
    expect(messages[0]!.content).not.toContain(text);

    const payload = JSON.parse(messages[1]!.content) as { reviews: Array<Record<string, unknown>> };
    expect(Object.keys(payload)).toEqual(["reviews"]);
    expect(payload.reviews).toHaveLength(3);
    expect(payload.reviews.some(({ body }) => body === text)).toBe(true);
    for (const sent of payload.reviews) {
      expect(Object.keys(sent)).toEqual(["label", "rating", "truncated", "body"]);
    }
  });

  it.each(cases)("keeps moderation fixture $id as an exact JSON field", ({ text }) => {
    const messages = moderationMessagesFor(text);
    expect(messages[0]).toEqual({ role: "system", content: REVIEW_SCREENING_SYSTEM_PROMPT });
    expect(messages[0]!.content).not.toContain(text);

    const payload = JSON.parse(messages[1]!.content) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(["body", "contentRevision", "reviewId"]);
    expect(payload.body).toBe(text);
    expect(messages[1]!.content).not.toContain(MALICIOUS_REPORT_EXPLANATION);
  });
});

describe(`${AI_CONTAINMENT_FIXTURE_VERSION}: untrusted provider output (AI-04, SEC-08, AT-11)`, () => {
  it.each(INVALID_SUMMARY_OUTPUTS)("rejects summary output $id", ({ content }) => {
    expect(parseSummaryOutput(content, LABELS)).toEqual({ ok: false, error: { kind: "invalid_output" } });
  });

  it.each(INVALID_MODERATION_OUTPUTS)("rejects moderation output $id", ({ content, body }) => {
    expect(parseModerationOutput(content, body)).toEqual({ ok: false, error: { kind: "invalid_output" } });
  });

  it("retains valid deterministic controls so the corpus cannot pass by rejecting everything", () => {
    expect(parseSummaryOutput(
      '{"overall":"Reviewers had mixed opinions.","strengths":[{"text":"The acting was praised.","sources":["R1"]}],"criticisms":[],"mixedOpinions":[]}',
      LABELS,
    )).toMatchObject({ ok: true });
    expect(parseModerationOutput(
      '{"assessment":"suspected_profanity","explanation":"The review contains an obfuscated vulgarity.","matches":[{"quote":"sh!t","reason":"Obfuscated profanity."}],"limitations":[]}',
      "The ending was sh!t.",
    )).toMatchObject({ ok: true });
  });
});
