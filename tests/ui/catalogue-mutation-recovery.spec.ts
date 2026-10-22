import { expect, test } from "@playwright/test";

const timestamp = "2026-10-22T00:00:00Z";

test("archived movie edits recover their committed title and stay current after navigation", async ({ page }) => {
  let movie = { id: "synthetic-movie", title: "Original Movie", synopsis: "Synthetic synopsis", releaseDate: null, genres: [], director: "", cast: [], runtimeMinutes: null, archivedAt: timestamp, version: 1, createdAt: timestamp, updatedAt: timestamp };
  let writes = 0;
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/me")) return route.fulfill({ json: { displayName: "Synthetic Admin", role: "ADMIN", status: "active" } });
    if (path.endsWith("/csrf")) return route.fulfill({ json: { csrfToken: "synthetic-csrf" } });
    if (route.request().method() === "PATCH") {
      writes += 1;
      movie = { ...movie, ...route.request().postDataJSON(), version: movie.version + 1 };
      movie.title = movie.title.trim();
      return route.fulfill({ status: 412, contentType: "text/plain", body: "PRECONDITION_FAILED" });
    }
    return route.fulfill({ json: path.endsWith("/synthetic-movie") ? movie : { items: [movie], page: 1, pageSize: 20, total: 1 } });
  });
  await page.goto("/admin/movies/synthetic-movie");
  await page.getByLabel("Title", { exact: true }).fill(" Updated Movie ");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Edit “Updated Movie”" })).toBeVisible();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Updated Movie");
  await expect(page.locator('[data-status="error"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Load latest version" })).toHaveCount(0);
  await page.getByRole("link", { name: "Back to movies", exact: true }).click();
  await page.getByRole("link", { name: "Updated Movie", exact: true }).click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Updated Movie");
  expect(writes).toBe(1);
});

test("announcement publication and content edits recover without false errors or duplicate writes", async ({ page }) => {
  let notice = { id: "synthetic-notice", title: "Synthetic Notice", body: "Original body", movieId: null, state: "draft", publishedAt: null as string | null, authorId: "synthetic-admin", version: 1, createdAt: timestamp, updatedAt: timestamp };
  let writes = 0;
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/me")) return route.fulfill({ json: { displayName: "Synthetic Admin", role: "ADMIN", status: "active" } });
    if (path.endsWith("/csrf")) return route.fulfill({ json: { csrfToken: "synthetic-csrf" } });
    if (route.request().method() === "PATCH") {
      writes += 1;
      notice = { ...notice, ...route.request().postDataJSON(), version: notice.version + 1 };
      notice.title = notice.title.trim();
      notice.body = notice.body.trim();
      if (notice.state === "published") notice.publishedAt = timestamp;
      return route.fulfill({ status: 412, contentType: "text/plain", body: "PRECONDITION_FAILED" });
    }
    return route.fulfill({ json: path.endsWith("/synthetic-notice") ? notice : { items: [notice], page: 1, pageSize: 20, total: 1 } });
  });
  await page.goto("/admin/announcements");
  await page.getByRole("button", { name: "Publish Synthetic Notice", exact: true }).click();
  await expect(page.getByRole("button", { name: "Unpublish Synthetic Notice", exact: true })).toBeVisible();
  await expect(page.locator('[data-status="error"]')).toHaveCount(0);
  await page.getByRole("link", { name: "Synthetic Notice", exact: true }).click();
  await page.getByLabel("Title", { exact: true }).fill(" Updated Notice ");
  await page.getByLabel("Body", { exact: true }).fill(" Updated body ");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Announcement “Updated Notice”" })).toBeVisible();
  await expect(page.getByLabel("Body", { exact: true })).toHaveValue("Updated body");
  await expect(page.locator('[data-status="error"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Load latest version" })).toHaveCount(0);
  await page.getByRole("button", { name: "Save and unpublish", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save draft", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Back to announcements", exact: true }).click();
  await expect(page.getByRole("button", { name: "Publish Updated Notice", exact: true })).toBeVisible();
  await expect(page.locator('[data-status="error"]')).toHaveCount(0);
  expect(writes).toBe(3);
});
