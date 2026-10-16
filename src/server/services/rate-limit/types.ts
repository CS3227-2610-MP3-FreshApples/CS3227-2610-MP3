import "server-only";

/** K6 limit names (workflow/contracts.md §9, §20 AM-11). Adding a value is a contract PR. */
export type RateLimitName = "login_failure_email" | "login_failure_ip" | "review_mutation" | "report_create" | "soc_requests";
