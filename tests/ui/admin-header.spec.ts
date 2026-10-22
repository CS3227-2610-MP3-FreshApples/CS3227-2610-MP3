import { expect, test } from "@playwright/test";

test("Admin header controls appear across site headers without duplicates and sign out safely", async ({ page }) => {
  let signedIn = true;
  let logoutFails = true;
  let logouts = 0;
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/auth/me")) return signedIn
      ? route.fulfill({ json: { displayName: "Synthetic Admin", role: "ADMIN", status: "active" } })
      : route.fulfill({ status: 401, json: { error: { code: "unauthenticated" } } });
    if (path.endsWith("/csrf")) return route.fulfill({ json: { csrfToken: "synthetic-csrf" } });
    if (path.endsWith("/logout")) {
      logouts += 1;
      expect(route.request().headers()["x-csrf-token"]).toBe("synthetic-csrf");
      if (logoutFails) return route.fulfill({ status: 503, json: {} });
      signedIn = false;
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ json: { items: [], page: 1, pageSize: 20, total: 0 } });
  });

  for (const path of ["/", "/movies", "/announcements", "/sign-in", "/register", "/admin", "/admin/movies", "/app"]) {
    await page.goto(path);
    const header = page.getByRole("banner");
    await expect(header.locator('[data-account-control="admin"]')).toHaveCount(1);
    await expect(header.getByText("Synthetic Admin", { exact: true })).toBeVisible();
    await expect(header.getByRole("button", { name: "Sign out", exact: true })).toHaveCount(1);
  }
  await page.goto("/");
  for (const link of ["Movies", "Announcements", "Admin Dashboard"]) {
    await page.getByRole("banner").getByRole("link", { name: link, exact: true }).click();
    await expect(page.getByRole("banner").locator('[data-account-control="admin"]')).toHaveCount(1);
    await expect(page.getByRole("banner").getByText("Synthetic Admin", { exact: true })).toBeVisible();
  }
  await page.goto("/announcements");
  await page.setViewportSize({ width: 390, height: 844 });
  const signOut = page.getByRole("banner").getByRole("button", { name: "Sign out", exact: true });
  await expect(signOut).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await signOut.click();
  await expect(page.getByRole("banner").getByRole("alert")).toContainText("couldn’t sign you out");
  await expect(page).toHaveURL(/\/announcements$/);
  await expect(signOut).toBeEnabled();
  logoutFails = false;
  await signOut.click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(page.getByRole("banner").locator('[data-account-control="admin"]')).toHaveCount(0);
  expect(logouts).toBe(2);
});

test("anonymous public visitors stay on their page without Admin controls", async ({ page }) => {
  await page.route("**/api/v1/auth/me", (route) => route.fulfill({ status: 401, json: {} }));
  for (const path of ["/", "/movies", "/announcements"]) {
    await page.goto(path);
    await expect(page.getByRole("banner")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(path);
    await expect(page.getByRole("banner").getByRole("button", { name: "Sign out" })).toHaveCount(0);
  }
});
