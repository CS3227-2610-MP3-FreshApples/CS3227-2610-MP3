import { expect, test } from "@playwright/test";

// Real Admin session/API with AI disabled by the E2E harness: regeneration must still persist pending
// work safely. Provider success/failure and provenance use the isolated PostgreSQL integration suite.
test("Admin can request regeneration without losing an unsaved movie edit", async ({ page, request }) => {
  const anonymous = await request.post("/api/v1/admin/movies/00000000-0000-4000-8000-000000000051/summary/regenerate", { data: {} });
  expect(anonymous.status()).toBe(401);
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(process.env.ADMIN_BOOTSTRAP_EMAIL!);
  await page.getByLabel("Password").fill(process.env.ADMIN_BOOTSTRAP_PASSWORD!);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/admin");

  const title = "Synthetic summary regeneration movie";
  await page.goto("/admin/movies/new");
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page.getByLabel("Synopsis", { exact: true }).fill("Synthetic movie for manual summary regeneration.");
  await page.getByRole("button", { name: "Create movie", exact: true }).click();
  await page.getByRole("link", { name: `Edit “${title}”` }).click();
  await expect(page.getByRole("heading", { name: `Edit “${title}”` })).toBeVisible();
  await page.getByLabel("Director", { exact: true }).fill("Unsaved synthetic director");

  const movieId = await page.locator("code").textContent();
  const withoutCsrf = await page.request.post(`/api/v1/admin/movies/${movieId}/summary/regenerate`, { data: {} });
  expect(withoutCsrf.status()).toBe(403);

  const responsePromise = page.waitForResponse((response) =>
    response.url().endsWith("/summary/regenerate") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Regenerate AI summary", exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: "pending" });
  expect(response.request().postDataJSON()).toEqual({});
  expect(response.request().headers()["x-csrf-token"]).toBeTruthy();
  await expect(page.getByRole("status").filter({ hasText: "The summary is pending." })).toBeVisible();
  await expect(page.getByLabel("Director", { exact: true })).toHaveValue("Unsaved synthetic director");

  // The throttle is server-enforced even after the first request completes.
  const throttledPromise = page.waitForResponse((result) => result.url().endsWith("/summary/regenerate"));
  await page.getByRole("button", { name: "Regenerate AI summary", exact: true }).click();
  const throttled = await throttledPromise;
  expect(throttled.status()).toBe(429);
  expect(Number(throttled.headers()["retry-after"])).toBeGreaterThan(0);
  await expect(page.getByRole("alert").filter({ hasText: "Too many requests" })).toBeVisible();

  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Director", { exact: true })).toHaveValue("Unsaved synthetic director");
});
