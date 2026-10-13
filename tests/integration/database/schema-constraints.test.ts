import { randomBytes, randomUUID } from "node:crypto";

import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  connectAsOwner,
  expectViolation,
  insertAccount,
  insertAiJob,
  insertMovie,
  insertReport,
  insertReview,
  uniqueBudgetDay,
} from "./schema-fixtures";

const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
const NOT_NULL_VIOLATION = "23502";

type Row = Record<string, unknown>;

interface Fixture {
  readonly author: string;
  readonly reporter: string;
  readonly admin: string;
  readonly movie: string;
  readonly review: string;
  readonly budgetDay: string;
}

let db: Client;
let f: Fixture;
let sequence = 0;

/** A value no other row in this file uses, for columns under a unique or primary key. */
function next(): number {
  sequence += 1;
  return sequence;
}

function insertRow(table: string, row: Row): Promise<unknown> {
  const columns = Object.keys(row);
  const placeholders = columns.map((_, index) => `$${index + 1}`);
  return db.query(
    `INSERT INTO app.${table} (${columns.map((column) => `"${column}"`).join(", ")}) VALUES (${placeholders.join(", ")})`,
    Object.values(row),
  );
}

// One valid row per table. Each call yields fresh values for unique columns, so cases do not collide.
const VALID_ROWS: Readonly<Record<string, () => Promise<Row>>> = {
  account: async () => ({
    normalized_email: `${randomUUID()}@example.test`,
    password_hash: "synthetic-hash",
    display_name: "Synthetic",
    role: "USER",
    status: "active",
  }),
  session: async () => ({
    hashed_token: randomBytes(32),
    account_id: f.author,
    expires_at: new Date(Date.now() + 3_600_000),
  }),
  movie: async () => ({ title: "Synthetic", synopsis: "Synthetic synopsis.", director: "" }),
  review: async () => ({
    movie_id: f.movie,
    author_id: await insertAccount(db),
    rating: 7,
    body: "Synthetic review body.",
    moderation_state: "pending",
  }),
  report: async () => ({
    reporter_id: f.reporter,
    target_user_id: f.author,
    review_id: f.review,
    category: "spam",
    explanation: "Synthetic explanation.",
    evidence_snapshot: {},
    status: "dismissed",
  }),
  moderation_decision: async () => ({
    report_id: await insertReport(db, {
      reporterId: f.reporter,
      targetUserId: f.author,
      reviewId: f.review,
      status: "dismissed",
    }),
    admin_id: f.admin,
    disposition: "accepted",
    actions: [],
    reason: "Synthetic reason.",
  }),
  announcement: async () => ({ title: "Synthetic", body: "Synthetic body.", state: "draft", author_id: f.admin }),
  ai_job: async () => ({
    type: "summary",
    trigger: "scheduler",
    subject_id: randomUUID(),
    input_revision: 0,
    dedup_key: randomUUID(),
    status: "succeeded",
    lease_until: new Date(),
    expires_at: new Date(),
    model_id: "synthetic-model",
    prompt_version: "p1",
    input_hash: "synthetic-hash",
  }),
  review_summary: async () => ({
    job_id: await insertAiJob(db, { dedupKey: randomUUID(), status: "succeeded" }),
    movie_id: f.movie,
    reviews_revision: 0,
    sampled_review_ids_and_versions: "[]",
    eligible_count: 0,
    output_json: {},
    generated_at: new Date(),
  }),
  review_moderation: async () => ({
    job_id: await insertAiJob(db, { dedupKey: randomUUID(), status: "succeeded" }),
    review_id: f.review,
    content_revision: 1,
    captured_review_version: 1,
    model_id: "synthetic-model",
    prompt_version: "p1",
    policy_version: "v1",
    output_json: {},
    generated_at: new Date(),
  }),
  moderation_work: async () => ({
    review_id: f.review,
    content_revision: next(),
    model_id: "synthetic-model",
    prompt_version: "p1",
    policy_version: "v1",
    status: "pending",
  }),
  moderation_strike: async () => ({
    target_user_id: f.author,
    review_id: await insertReview(db, f.movie, await insertAccount(db)),
    accepted_report_id: await insertReport(db, {
      reporterId: f.reporter,
      targetUserId: f.author,
      reviewId: f.review,
      status: "accepted",
    }),
    strike_cycle: 0,
  }),
  scheduler_lease: async () => ({ name: randomUUID(), lease_token: randomUUID(), lease_until: new Date() }),
  rate_limit_window: async () => ({ bucket_key: randomUUID(), window_start: new Date(), count: 1 }),
  ai_budget_day: async () => ({ budget_day: uniqueBudgetDay(next()), budget_microdollars: 100 }),
  ai_budget_reservation: async () => ({
    ai_job_id: await insertAiJob(db, { dedupKey: randomUUID(), status: "succeeded" }),
    budget_day: f.budgetDay,
    reserved_microdollars: 10,
    status: "reserved",
  }),
  audit_entry: async () => ({
    action: "movie.create",
    target_type: "movie",
    target_id: randomUUID(),
    result: "applied",
    request_id: "synthetic-request",
  }),
};

async function validRow(table: string, overrides: Row = {}): Promise<Row> {
  const build = VALID_ROWS[table];
  if (build === undefined) {
    throw new Error(`no valid row for ${table}`);
  }
  return { ...(await build()), ...overrides };
}

beforeAll(async () => {
  db = await connectAsOwner();
  const author = await insertAccount(db);
  const movie = await insertMovie(db);
  const budgetDay = uniqueBudgetDay(0);
  await db.query("INSERT INTO app.ai_budget_day (budget_day, budget_microdollars) VALUES ($1, 1000000)", [
    budgetDay,
  ]);
  f = {
    author,
    reporter: await insertAccount(db),
    admin: await insertAccount(db, "ADMIN"),
    movie,
    review: await insertReview(db, movie, author),
    budgetDay,
  };
});

afterAll(async () => {
  await db.end();
});

describe("valid rows (baseline for every violation case)", () => {
  it.each(Object.keys(VALID_ROWS))("accepts a valid app.%s row", async (table) => {
    await insertRow(table, await validRow(table));
  });

  it("applies the D-33 defaults", async () => {
    const { rows } = await db.query<Row>(
      `SELECT a.strike_cycle, a.version AS account_version, m.genres, m."cast", m.reviews_revision,
              m.version AS movie_version, r.content_revision, r.version AS review_version
       FROM app.account a, app.movie m, app.review r
       WHERE a.id = $1 AND m.id = $2 AND r.id = $3`,
      [f.author, f.movie, f.review],
    );
    expect(rows[0]).toEqual({
      strike_cycle: 0,
      account_version: 1,
      genres: [],
      cast: [],
      reviews_revision: 0,
      movie_version: 1,
      content_revision: 1,
      review_version: 1,
    });
  });
});

interface CheckCase {
  readonly table: string;
  readonly overrides: Row;
  readonly constraint: string;
}

const tooMany = (count: number) => Array.from({ length: count }, (_, index) => `item-${index}`);

// Closed vocabularies, numeric ranges and array cardinality (D-33). Text lengths are service-enforced.
const CHECK_CASES: readonly CheckCase[] = [
  { table: "account", overrides: { role: "MODERATOR" }, constraint: "account_role_check" },
  { table: "account", overrides: { status: "banned" }, constraint: "account_status_check" },
  { table: "account", overrides: { strike_cycle: -1 }, constraint: "account_strike_cycle_check" },
  { table: "account", overrides: { version: 0 }, constraint: "account_version_check" },
  { table: "movie", overrides: { genres: tooMany(11) }, constraint: "movie_genres_check" },
  { table: "movie", overrides: { cast: tooMany(31) }, constraint: "movie_cast_check" },
  { table: "movie", overrides: { runtime_minutes: 0 }, constraint: "movie_runtime_minutes_check" },
  { table: "movie", overrides: { runtime_minutes: 1001 }, constraint: "movie_runtime_minutes_check" },
  { table: "movie", overrides: { reviews_revision: -1 }, constraint: "movie_reviews_revision_check" },
  { table: "movie", overrides: { version: 0 }, constraint: "movie_version_check" },
  { table: "review", overrides: { rating: 0 }, constraint: "review_rating_check" },
  { table: "review", overrides: { rating: 11 }, constraint: "review_rating_check" },
  { table: "review", overrides: { moderation_state: "approved" }, constraint: "review_moderation_state_check" },
  { table: "review", overrides: { clearance_source: "model" }, constraint: "review_clearance_source_check" },
  { table: "review", overrides: { content_revision: 0 }, constraint: "review_content_revision_check" },
  { table: "review", overrides: { version: 0 }, constraint: "review_version_check" },
  { table: "report", overrides: { category: "rude" }, constraint: "report_category_check" },
  { table: "report", overrides: { status: "closed" }, constraint: "report_status_check" },
  { table: "report", overrides: { evidence_version: 0 }, constraint: "report_evidence_version_check" },
  { table: "report", overrides: { version: 0 }, constraint: "report_version_check" },
  { table: "moderation_decision", overrides: { disposition: "pending" }, constraint: "moderation_decision_disposition_check" },
  { table: "moderation_decision", overrides: { actions: ["suspend_user"] }, constraint: "moderation_decision_actions_check" },
  {
    table: "moderation_decision",
    overrides: { disposition: "dismissed", actions: ["hide_review"] },
    constraint: "moderation_decision_dismissed_actions_check",
  },
  { table: "announcement", overrides: { state: "archived" }, constraint: "announcement_state_check" },
  { table: "announcement", overrides: { version: 0 }, constraint: "announcement_version_check" },
  { table: "ai_job", overrides: { type: "translation" }, constraint: "ai_job_type_check" },
  { table: "ai_job", overrides: { trigger: "admin" }, constraint: "ai_job_trigger_check" },
  { table: "ai_job", overrides: { status: "queued" }, constraint: "ai_job_status_check" },
  { table: "ai_job", overrides: { attempt_count: -1 }, constraint: "ai_job_attempt_count_check" },
  { table: "ai_job", overrides: { input_revision: -1 }, constraint: "ai_job_input_revision_check" },
  { table: "review_summary", overrides: { reviews_revision: -1 }, constraint: "review_summary_reviews_revision_check" },
  { table: "review_summary", overrides: { eligible_count: -1 }, constraint: "review_summary_eligible_count_check" },
  { table: "review_moderation", overrides: { content_revision: 0 }, constraint: "review_moderation_content_revision_check" },
  {
    table: "review_moderation",
    overrides: { captured_review_version: 0 },
    constraint: "review_moderation_captured_review_version_check",
  },
  { table: "moderation_work", overrides: { status: "failed" }, constraint: "moderation_work_status_check" },
  { table: "moderation_work", overrides: { execution_count: -1 }, constraint: "moderation_work_execution_count_check" },
  { table: "moderation_work", overrides: { content_revision: 0 }, constraint: "moderation_work_content_revision_check" },
  { table: "moderation_strike", overrides: { strike_cycle: -1 }, constraint: "moderation_strike_strike_cycle_check" },
  { table: "rate_limit_window", overrides: { count: -1 }, constraint: "rate_limit_window_count_check" },
  { table: "ai_budget_day", overrides: { budget_microdollars: 0 }, constraint: "ai_budget_day_budget_microdollars_check" },
  { table: "ai_budget_day", overrides: { reserved_microdollars: -1 }, constraint: "ai_budget_day_reserved_microdollars_check" },
  { table: "ai_budget_day", overrides: { consumed_microdollars: -1 }, constraint: "ai_budget_day_consumed_microdollars_check" },
  { table: "ai_budget_day", overrides: { version: 0 }, constraint: "ai_budget_day_version_check" },
  {
    table: "ai_budget_reservation",
    overrides: { reserved_microdollars: 0 },
    constraint: "ai_budget_reservation_reserved_microdollars_check",
  },
  { table: "ai_budget_reservation", overrides: { status: "pending" }, constraint: "ai_budget_reservation_status_check" },
  { table: "ai_budget_reservation", overrides: { input_tokens: -1 }, constraint: "ai_budget_reservation_input_tokens_check" },
  { table: "ai_budget_reservation", overrides: { output_tokens: -1 }, constraint: "ai_budget_reservation_output_tokens_check" },
  {
    table: "ai_budget_reservation",
    overrides: { actual_microdollars: -1 },
    constraint: "ai_budget_reservation_actual_microdollars_check",
  },
  { table: "audit_entry", overrides: { result: "denied" }, constraint: "audit_entry_result_check" },
];

describe("CHECK constraints", () => {
  it.each(CHECK_CASES)("$constraint rejects $table with $overrides", async ({ table, overrides, constraint }) => {
    await expectViolation(insertRow(table, await validRow(table, overrides)), CHECK_VIOLATION, constraint);
  });

  it("accepts boundary values", async () => {
    await insertRow("movie", await validRow("movie", { genres: tooMany(10), cast: tooMany(30), runtime_minutes: 1 }));
    await insertRow("movie", await validRow("movie", { runtime_minutes: 1000 }));
    await insertRow("review", await validRow("review", { rating: 1 }));
    await insertRow("review", await validRow("review", { rating: 10, clearance_source: "admin" }));
    await insertRow("moderation_decision", await validRow("moderation_decision", { actions: ["hide_review"] }));
    await insertRow("moderation_decision", await validRow("moderation_decision", { disposition: "dismissed" }));
    await insertRow("moderation_work", await validRow("moderation_work", { status: "cancelled" }));
    await insertRow("rate_limit_window", await validRow("rate_limit_window", { count: 0 }));
    await insertRow("audit_entry", await validRow("audit_entry", { result: "no_op", actor_id: null }));
  });

  it("enforces NOT NULL on required columns", async () => {
    await expectViolation(insertRow("review", await validRow("review", { body: null })), NOT_NULL_VIOLATION);
    await expectViolation(insertRow("report", await validRow("report", { evidence_snapshot: null })), NOT_NULL_VIOLATION);
  });
});

describe("AIBudgetDay spend limit (D-13, D-25)", () => {
  const constraint = "ai_budget_day_within_budget_check";

  it("accepts reserved + consumed equal to the budget", async () => {
    await insertRow(
      "ai_budget_day",
      await validRow("ai_budget_day", { budget_microdollars: 100, reserved_microdollars: 60, consumed_microdollars: 40 }),
    );
  });

  it("rejects an insert over the budget", async () => {
    const row = await validRow("ai_budget_day", {
      budget_microdollars: 100,
      reserved_microdollars: 60,
      consumed_microdollars: 41,
    });
    await expectViolation(insertRow("ai_budget_day", row), CHECK_VIOLATION, constraint);
  });

  it("rejects a reservation increment that overspends", async () => {
    const day = uniqueBudgetDay(next());
    await db.query(
      "INSERT INTO app.ai_budget_day (budget_day, budget_microdollars, consumed_microdollars) VALUES ($1, 100, 90)",
      [day],
    );
    await expectViolation(
      db.query("UPDATE app.ai_budget_day SET reserved_microdollars = reserved_microdollars + 11 WHERE budget_day = $1", [
        day,
      ]),
      CHECK_VIOLATION,
      constraint,
    );
  });

  it("stores microdollar amounts as bigint", async () => {
    const big = "9000000000000"; // beyond integer range
    const day = uniqueBudgetDay(next());
    await db.query("INSERT INTO app.ai_budget_day (budget_day, budget_microdollars) VALUES ($1, $2)", [day, big]);
    const { rows } = await db.query<{ budget: string }>(
      "SELECT budget_microdollars::text AS budget FROM app.ai_budget_day WHERE budget_day = $1",
      [day],
    );
    expect(rows[0]?.budget).toBe(big);
  });
});

describe("unique and primary keys", () => {
  async function expectDuplicateRejected(table: string, row: Row, constraint: string): Promise<void> {
    await insertRow(table, row);
    await expectViolation(insertRow(table, row), UNIQUE_VIOLATION, constraint);
  }

  it("Account.normalized_email", async () => {
    await expectDuplicateRejected("account", await validRow("account"), "account_normalized_email_key");
  });

  it("Session.hashed_token", async () => {
    await expectDuplicateRejected("session", await validRow("session"), "session_hashed_token_key");
  });

  it("Review (movie_id, author_id)", async () => {
    await expectViolation(
      insertRow("review", await validRow("review", { author_id: f.author })),
      UNIQUE_VIOLATION,
      "review_movie_id_author_id_key",
    );
  });

  it("ModerationDecision.report_id", async () => {
    await expectDuplicateRejected("moderation_decision", await validRow("moderation_decision"), "moderation_decision_report_id_key");
  });

  it("ReviewSummary.job_id and ReviewModeration.job_id", async () => {
    await expectDuplicateRejected("review_summary", await validRow("review_summary"), "review_summary_job_id_key");
    await expectDuplicateRejected("review_moderation", await validRow("review_moderation"), "review_moderation_job_id_key");
  });

  it("ModerationStrike (target_user_id, review_id) across strike cycles", async () => {
    const first = await validRow("moderation_strike");
    await insertRow("moderation_strike", first);
    const sameIncidentLaterCycle = await validRow("moderation_strike", { review_id: first.review_id, strike_cycle: 1 });
    await expectViolation(
      insertRow("moderation_strike", sameIncidentLaterCycle),
      UNIQUE_VIOLATION,
      "moderation_strike_target_user_id_review_id_key",
    );
  });

  it("ModerationStrike.accepted_report_id", async () => {
    const first = await validRow("moderation_strike");
    await insertRow("moderation_strike", first);
    const sameReport = await validRow("moderation_strike", { accepted_report_id: first.accepted_report_id });
    await expectViolation(
      insertRow("moderation_strike", sameReport),
      UNIQUE_VIOLATION,
      "moderation_strike_accepted_report_id_key",
    );
  });

  it("SchedulerLease.name", async () => {
    const lease = await validRow("scheduler_lease");
    await expectDuplicateRejected("scheduler_lease", lease, "scheduler_lease_pkey");
  });

  it("RateLimitWindow (bucket_key, window_start), allowing a new window for the same key", async () => {
    const window = await validRow("rate_limit_window");
    await expectDuplicateRejected("rate_limit_window", window, "rate_limit_window_pkey");
    await insertRow("rate_limit_window", { ...window, window_start: new Date(Date.now() + 60_000) });
  });

  it("AIBudgetDay.budget_day", async () => {
    await expectDuplicateRejected("ai_budget_day", await validRow("ai_budget_day"), "ai_budget_day_pkey");
  });

  it("AIBudgetReservation.ai_job_id", async () => {
    await expectDuplicateRejected(
      "ai_budget_reservation",
      await validRow("ai_budget_reservation"),
      "ai_budget_reservation_ai_job_id_key",
    );
  });
});

describe("partial unique open Report per (reporter_id, review_id)", () => {
  const index = "report_open_reporter_id_review_id_key";

  it("rejects a second open Report from the same reporter on the same Review", async () => {
    const row = await validRow("report", { reporter_id: await insertAccount(db), status: "open" });
    await insertRow("report", row);
    await expectViolation(insertRow("report", row), UNIQUE_VIOLATION, index);
  });

  it("allows a new open Report once the earlier one is closed", async () => {
    const reporter = await insertAccount(db);
    await insertRow("report", await validRow("report", { reporter_id: reporter, status: "dismissed" }));
    await insertRow("report", await validRow("report", { reporter_id: reporter, status: "accepted" }));
    await insertRow("report", await validRow("report", { reporter_id: reporter, status: "open" }));
  });
});

describe("AIJob unique active dedup key", () => {
  const index = "ai_job_running_dedup_key_key";

  it("rejects a second running job with the same dedup key", async () => {
    const dedupKey = randomUUID();
    await insertAiJob(db, { dedupKey, status: "running" });
    await expectViolation(insertAiJob(db, { dedupKey, status: "running" }), UNIQUE_VIOLATION, index);
  });

  it("allows the key again once the running job ends", async () => {
    const dedupKey = randomUUID();
    const first = await insertAiJob(db, { dedupKey, status: "running" });
    await insertAiJob(db, { dedupKey, status: "failed" });
    await db.query("UPDATE app.ai_job SET status = 'stale' WHERE id = $1", [first]);
    await insertAiJob(db, { dedupKey, status: "running" });
  });
});

describe("ModerationWork revision uniqueness NULLS NOT DISTINCT", () => {
  const constraint = "moderation_work_revision_key";

  it("rejects duplicate work when model_id is null", async () => {
    const work = await validRow("moderation_work", { model_id: null });
    await insertRow("moderation_work", work);
    await expectViolation(insertRow("moderation_work", work), UNIQUE_VIOLATION, constraint);
  });

  it("rejects duplicate work with the same model", async () => {
    const work = await validRow("moderation_work");
    await insertRow("moderation_work", work);
    await expectViolation(insertRow("moderation_work", work), UNIQUE_VIOLATION, constraint);
  });

  it("allows the same revision under a different model, prompt or policy version", async () => {
    const work = await validRow("moderation_work", { model_id: null });
    await insertRow("moderation_work", work);
    await insertRow("moderation_work", { ...work, model_id: "synthetic-model" });
    await insertRow("moderation_work", { ...work, prompt_version: "p2" });
    await insertRow("moderation_work", { ...work, policy_version: "v2" });
  });
});

describe("foreign keys restrict deletion of evidence-bearing records", () => {
  it("rejects deleting an Account that authored a Review", async () => {
    await expectViolation(db.query("DELETE FROM app.account WHERE id = $1", [f.author]), FOREIGN_KEY_VIOLATION);
  });

  it("rejects deleting a Movie or Review referenced by a Report", async () => {
    await expectViolation(db.query("DELETE FROM app.movie WHERE id = $1", [f.movie]), FOREIGN_KEY_VIOLATION);
    await expectViolation(db.query("DELETE FROM app.review WHERE id = $1", [f.review]), FOREIGN_KEY_VIOLATION);
  });

  it("rejects a Review for a Movie that does not exist", async () => {
    await expectViolation(
      insertRow("review", await validRow("review", { movie_id: randomUUID() })),
      FOREIGN_KEY_VIOLATION,
      "review_movie_id_fkey",
    );
  });
});
