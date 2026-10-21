import { expect, test, type Page } from "@playwright/test";
import { adminReviewView } from "../support/admin-review-view";

// UI-only HTTP fixtures exercise presentation and failure paths. The final test uses the real API.
async function fixtureAdmin(page: Page) {
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ json: { displayName: "Synthetic Admin", role: "ADMIN", status: "active" } }));
  await page.route("**/api/v1/auth/csrf", (route) => route.fulfill({ json: { csrfToken: "synthetic-csrf" } }));
}
test("review filters preserve pagination, All reviews resets everything, and empty states remain usable", async ({ page }) => {
  await fixtureAdmin(page);
  await page.route("**/api/v1/admin/reviews?*", (route) => {
    const query = new URL(route.request().url()).searchParams;
    return route.fulfill({ json: { items: query.get("assessment") === "deleted" ? [] : [adminReviewView], total: query.get("assessment") === "deleted" ? 0 : 21, page: Number(query.get("page")), pageSize: 20 } });
  });
  await page.goto(`/admin/reviews?assessment=flagged&movieId=${adminReviewView.movieId}`);
  await expect(page.getByRole("link", { name: "Review by Synthetic Author" })).toBeVisible();
  await page.getByRole("link", { name: "Next page" }).click();
  await expect(page).toHaveURL(/page=2/);
  expect(new URL(page.url()).searchParams.get("assessment")).toBe("flagged");
  expect(new URL(page.url()).searchParams.get("movieId")).toBe(adminReviewView.movieId);
  await page.getByRole("link", { name: "All reviews", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/reviews$/);
  await expect(page.getByLabel("Movie ID", { exact: true })).toHaveValue("");
  await page.getByLabel("Assessment or state").selectOption("deleted");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByText("No reviews match these filters.", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "All reviews", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /check|retry|regenerate/i })).toHaveCount(0);
});

test("source and assessment are inert plain text with limitations and historical provenance", async ({ page }, testInfo) => {
  await fixtureAdmin(page);
  const attack = '<img src=x onerror="alert(1)">';
  await page.route(`**/api/v1/admin/reviews/${adminReviewView.id}`, (route) => route.fulfill({ json: {
    ...adminReviewView, body: attack, contentRevision: 2,
    latestAssessment: { contentRevision: 1, capturedReviewVersion: 1, modelId: "fake", promptVersion: "p1", policyVersion: "v1",
      generatedAt: adminReviewView.createdAt, result: { assessment: "uncertain", explanation: attack, matches: [], limitations: ["Context may be misunderstood."] } },
  } }));
  await page.goto(`/admin/reviews/${adminReviewView.id}`);
  await expect(page.getByRole("region", { name: "Current review text" })).toContainText(attack);
  await expect(page.getByRole("region", { name: "Automatic assessment" })).toContainText(attack);
  await expect(page.getByText("Context may be misunderstood.")).toBeVisible();
  await expect(page.getByText("Historical assessment — earlier text", { exact: true })).toBeVisible();
  await expect(page.locator("img")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /check|retry|regenerate/i })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("review-detail-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("region", { name: "Automatic assessment" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("review-detail-mobile.png"), fullPage: true });
});

test("confirmation names both targets, keyboard cancel sends nothing, stale writes preserve the reason", async ({ page }) => {
  await fixtureAdmin(page);
  let writes = 0;
  let reads = 0;
  await page.route(`**/api/v1/admin/reviews/${adminReviewView.id}`, (route) => {
    reads++;
    return route.fulfill({ json: { ...adminReviewView, version: reads, body: reads > 1 ? "New current text after another edit." : adminReviewView.body } });
  });
  await page.route(`**/api/v1/admin/reviews/${adminReviewView.id}/approve`, (route) => {
    writes++;
    expect(route.request().headers()["if-match"]).toBe('"1"');
    expect(route.request().postDataJSON()).toEqual({ reason: "Human considered this review." });
    return route.fulfill({ status: 409, json: { error: { code: "stale_version" } } });
  });
  await page.goto(`/admin/reviews/${adminReviewView.id}`);
  await page.getByRole("button", { name: "Approve review", exact: true }).click();
  await expect(page.getByLabel("Reason", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("Reason", { exact: true }).fill("Human considered this review.");
  await page.getByRole("button", { name: "Approve review", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Synthetic Author");
  await expect(dialog).toContainText("Synthetic Movie");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Approve review", exact: true })).toBeFocused();
  expect(writes).toBe(0);
  await page.getByRole("button", { name: "Approve review", exact: true }).click();
  await dialog.getByRole("button", { name: "Approve review", exact: true }).click();
  await expect(page.locator('[data-status="error"]')).toContainText("changed this record");
  await expect(page.getByLabel("Reason", { exact: true })).toHaveValue("Human considered this review.");
  await expect(page.getByRole("button", { name: "Approve review", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Load latest version" }).click();
  await expect(page.getByText("New current text after another edit.")).toBeVisible();
  await expect(page.getByLabel("Reason", { exact: true })).toHaveValue("Human considered this review.");
  expect(writes).toBe(1);
});

test("real API journey: hide and restore retain pending state, then human approval publishes", async ({ page, browser }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(process.env.ADMIN_BOOTSTRAP_EMAIL!);
  await page.getByLabel("Password").fill(process.env.ADMIN_BOOTSTRAP_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/admin");
  const csrf = (await (await page.request.get("/api/v1/auth/csrf")).json()).csrfToken;
  const movieResponse = await page.request.post("/api/v1/admin/movies", { headers: { origin: new URL(page.url()).origin, "x-csrf-token": csrf }, data: { title: "Review UI journey Movie", synopsis: "A synthetic journey Movie." } });
  expect(movieResponse.status()).toBe(201);
  const movie = await movieResponse.json();
  const context = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const api = context.request;
    const token = async () => (await (await api.get("/api/v1/auth/csrf")).json()).csrfToken;
    const identity = { email: `review-ui-${Date.now()}@example.test`, password: "Synthetic-review-user1!", displayName: "Review UI Author" };
    const registration = await api.post("/api/v1/auth/register", { headers: { origin: new URL(page.url()).origin, "x-csrf-token": await token() }, data: identity });
    expect(registration.status()).toBe(201);
    const login = await api.post("/api/v1/auth/login", { headers: { origin: new URL(page.url()).origin, "x-csrf-token": await token() }, data: { email: identity.email, password: identity.password } });
    expect(login.status()).toBe(200);
    const saved = await api.post(`/api/v1/movies/${movie.id}/reviews`, { headers: { origin: new URL(page.url()).origin, "x-csrf-token": await token() }, data: { rating: 8, body: "Synthetic review for the Admin moderation UI journey." } });
    expect(saved.status()).toBe(201);
    const review = await saved.json();
    await page.goto(`/admin/reviews/${review.id}`);
    await expect(page.getByText("Pending", { exact: true })).toBeVisible();
    for (const action of ["Hide review", "Restore review", "Approve review"]) {
      await page.getByLabel("Reason", { exact: true }).fill(`Human decision: ${action}.`);
      await page.getByRole("button", { name: action, exact: true }).click();
      await expect(page.getByRole("dialog")).toContainText("Review UI Author");
      await expect(page.getByRole("dialog")).toContainText(movie.title);
      await page.getByRole("dialog").getByRole("button", { name: action, exact: true }).click();
      await expect(page.locator('[aria-live="polite"]')).toContainText("decision saved");
      if (action === "Restore review") {
        await expect(page.getByText("Pending", { exact: true })).toBeVisible();
        expect((await (await api.get(`/api/v1/movies/${movie.id}/reviews`)).json()).items).toHaveLength(0);
      }
    }
    await expect(page.getByText("Cleared", { exact: true })).toBeVisible();
    expect((await (await api.get(`/api/v1/movies/${movie.id}/reviews`)).json()).items).toHaveLength(1);
  } finally { await context.close(); }
});
