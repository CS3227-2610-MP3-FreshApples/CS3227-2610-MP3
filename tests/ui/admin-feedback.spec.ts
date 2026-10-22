import { expect, test } from "@playwright/test";

test("suspend and reinstate reconcile a committed Vercel 412 and stay current after navigation", async ({ page }, testInfo) => {
  let user = { id: "synthetic-user", displayName: "Synthetic Member", status: "active", version: 1 };
  let writes = 0;
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/me")) return route.fulfill({ json: { displayName: "Synthetic Admin", role: "ADMIN", status: "active" } });
    if (path.endsWith("/csrf")) return route.fulfill({ json: { csrfToken: "synthetic-csrf" } });
    if (route.request().method() === "PATCH") {
      writes += 1;
      user = { ...user, status: route.request().postDataJSON().status, version: user.version + 1 };
      return route.fulfill({ status: 412, contentType: "text/plain", body: "An error occurred\nPRECONDITION_FAILED\nsin1::synthetic" });
    }
    return route.fulfill({ json: path.endsWith("/synthetic-user") ? user : { items: [user], page: 1, pageSize: 20, total: 1 } });
  });

  await page.goto("/admin/users");
  const suspend = page.getByRole("button", { name: "Suspend Synthetic Member" });
  await suspend.waitFor();
  await page.mouse.move(0, 0);
  const before = await suspend.evaluate((element) => getComputedStyle(element).backgroundColor);
  await suspend.hover();
  await expect.poll(() => suspend.evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe(before);
  await suspend.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((element) => element.matches(":modal"))).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("user-status-dialog.png") });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(suspend).toBeFocused();

  for (const action of ["Suspend", "Reinstate"]) {
    await page.getByRole("button", { name: `${action} Synthetic Member` }).click();
    await dialog.getByLabel("Reason").fill("Synthetic moderation reason");
    await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
    await expect(page.getByRole("button", { name: `${action === "Suspend" ? "Reinstate" : "Suspend"} Synthetic Member` })).toBeVisible();
    await expect(page.locator('[role="alert"][data-status="error"]')).toHaveCount(0);
    await page.getByRole("link", { name: "Back to admin dashboard" }).click();
    await page.getByRole("link", { name: "Open users", exact: true }).click();
    await expect(page.getByRole("button", { name: `${action === "Suspend" ? "Reinstate" : "Suspend"} Synthetic Member` })).toBeVisible();
  }
  expect(writes).toBe(2);
});

test("shared archive confirmation has separated controls, native modal focus and responsive layout", async ({ page }, testInfo) => {
  const movie = { id: "synthetic-movie", title: "Synthetic Movie", synopsis: "A synthetic synopsis", releaseDate: null, genres: [], director: "", cast: [], runtimeMinutes: null, archivedAt: null, version: 1, createdAt: "2026-10-22T00:00:00Z", updatedAt: "2026-10-22T00:00:00Z" };
  await page.route("**/api/v1/**", (route) => route.fulfill({ json: route.request().url().includes("/auth/me") ? { displayName: "Synthetic Admin", role: "ADMIN", status: "active" } : { items: [movie], page: 1, pageSize: 20, total: 1 } }));
  await page.setViewportSize({ width: 390, height: 600 });
  await page.goto("/admin/movies");
  await page.getByRole("button", { name: "Archive Synthetic Movie", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((element) => element.matches(":modal"))).toBe(true);
  const buttons = dialog.getByRole("button");
  const cancel = await buttons.nth(0).boundingBox();
  const confirm = await buttons.nth(1).boundingBox();
  expect(cancel!.height).toBeGreaterThanOrEqual(44);
  expect(confirm!.height).toBeGreaterThanOrEqual(44);
  expect(confirm!.x >= cancel!.x + cancel!.width + 8 || confirm!.y >= cancel!.y + cancel!.height + 8).toBe(true);
  const bounds = await dialog.boundingBox();
  expect(bounds!.width).toBeLessThanOrEqual(390);
  expect(bounds!.height).toBeLessThanOrEqual(600);
  await page.screenshot({ path: testInfo.outputPath("archive-dialog-mobile.png") });
  await page.keyboard.press("Shift+Tab");
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Archive Synthetic Movie", exact: true })).toBeFocused();
});
