import { expect, test } from "@playwright/test";

const report = { id: "report-1", status: "open", category: "harassment", createdAt: "2026-10-22T00:00:00.000Z", version: 1, reporter: { id: "reporter-1", displayName: "Synthetic Reporter" }, target: { id: "target-1", displayName: "Synthetic Target", status: "active" }, review: { id: "review-1", movieId: "movie-1", movieTitle: "Synthetic Movie", state: "cleared" } };
const detail = { ...report, explanation: "A sufficiently detailed report explanation.", evidence: { reviewId: "review-1", reviewVersion: 1, authorId: "target-1", movieId: "movie-1", movieTitle: "Synthetic Movie", body: "Synthetic review body.", rating: 8 }, liveReview: { version: 1, moderationState: "cleared", hidden: false, deleted: false, movieArchived: false }, target: { ...report.target, strikeCount: 0, strikeThreshold: 3 }, projectedEffect: { strikeAdded: true, strikeCountAfter: 1, wouldSuspend: false, accountStatusAfter: "active" }, decision: null };

test("Admin report queue filters, private evidence, confirmation, and accept-and-hide flow", async ({ page }) => {
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ json: { displayName: "Synthetic Admin", role: "ADMIN", status: "active" } }));
  await page.route("**/api/v1/auth/csrf", (route) => route.fulfill({ json: { csrfToken: "synthetic-csrf" } }));
  await page.route("**/api/v1/admin/reports?*", (route) => route.fulfill({ json: { items: [report], total: 1, page: 1, pageSize: 20 } }));
  await page.route("**/api/v1/admin/reports/report-1", (route) => route.fulfill({ json: detail, headers: { etag: '"1"' } }));
  await page.route("**/api/v1/admin/reports/report-1/decision", (route) => {
    expect(route.request().headers()["if-match"]).toBe('"1"');
    expect(route.request().postDataJSON()).toEqual({ disposition: "accepted", actions: ["hide_review"], reason: "A valid acceptance reason." });
    return route.fulfill({ json: { report: { ...detail, status: "accepted", version: 2 }, decision: { id: "decision-1", disposition: "accepted", actions: ["hide_review"], reason: "A valid acceptance reason." }, strikeAdded: true, accountStatus: "active", version: 2 }, headers: { etag: '"2"' } });
  });
  await page.goto("/admin/reports?status=open");
  await expect(page.getByRole("link", { name: "harassment report" })).toBeVisible();
  await page.getByRole("link", { name: "harassment report" }).click();
  await expect(page.getByText("Admin-only report evidence is never shown to the target account.")).toBeVisible();
  await page.getByLabel("Reason", { exact: true }).fill("A valid acceptance reason.");
  await page.getByRole("button", { name: "Accept and hide review", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Synthetic Movie");
  await page.getByRole("dialog").getByRole("button", { name: "Confirm decision", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Report accepted");
});
