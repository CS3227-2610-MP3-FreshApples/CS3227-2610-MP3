import { expect, test, type Page } from "@playwright/test";

// B#6 commit 3 (A-01/A-02 UI; FR-05, FR-07, D-21): the Admin movie and announcement screens against the
// real API and a disposable database. Synthetic data only. The public halves of AT-02/AT-06 wait on
// U-01; Admin archive/restore uses the production K8 lock boundary (D-84).

const MOVIE_TITLE = "Synthetic E2E Movie";
const UNKNOWN_MOVIE_ID = "00000000-0000-4000-8000-00000000e2e0";
/** The K12 StatusMessage error; Next.js also renders an empty route announcer with role="alert". */
const ERROR_MESSAGE = "[role=\"alert\"][data-status=\"error\"]";

async function ensureAdmin(page: Page): Promise<void> {
  const response = await page.request.post("/api/v1/internal/bootstrap/admin", {
    headers: { "x-admin-bootstrap-secret": process.env.ADMIN_BOOTSTRAP_SECRET! },
  });
  expect(response.status()).toBe(200);
  expect(["created", "already_provisioned"]).toContain((await response.json()).status);
}

async function signInAsAdmin(page: Page): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(process.env.ADMIN_BOOTSTRAP_EMAIL!);
  await page.getByLabel("Password").fill(process.env.ADMIN_BOOTSTRAP_PASSWORD!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/admin");
}

test.describe.serial("Admin movie and announcement screens", () => {
  let movieUrl = "";
  let movieId = "";

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await ensureAdmin(page);
    await page.close();
  });

  test("an anonymous visitor gets an error state, not Admin data", async ({ page }) => {
    await page.goto("/admin/movies");
    await expect(page.locator(ERROR_MESSAGE)).toContainText("Sign in again");
    await expect(page.getByRole("table")).toHaveCount(0);
  });

  test("create shows field errors tied to their fields and keeps the typed text", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin/movies");
    await expect(page.getByRole("status").filter({ hasText: "No movies yet" })).toBeVisible();

    await page.getByRole("link", { name: "Create movie" }).click();
    await page.getByLabel("Title").fill(MOVIE_TITLE);
    await page.getByLabel("Genres").fill("Drama\nMystery");
    await page.getByRole("button", { name: "Create movie" }).click();

    const synopsis = page.getByLabel("Synopsis");
    await expect(synopsis).toHaveAttribute("aria-invalid", "true");
    await expect(synopsis).toHaveAttribute("aria-describedby", /synopsis-error/);
    await expect(page.locator("#synopsis-error")).toBeVisible();
    await expect(page.getByLabel("Title")).toHaveValue(MOVIE_TITLE);
    await expect(page.getByLabel("Genres")).toHaveValue("Drama\nMystery");

    await synopsis.fill("A synthetic synopsis for the end-to-end journey.");
    await page.getByRole("button", { name: "Create movie" }).click();
    await expect(page.getByRole("status").filter({ hasText: `Created “${MOVIE_TITLE}”.` })).toBeVisible();

    await page.getByRole("link", { name: `Edit “${MOVIE_TITLE}”` }).click();
    await expect(page.getByRole("heading", { name: `Edit “${MOVIE_TITLE}”` })).toBeVisible();
    movieUrl = page.url();
    movieId = (await page.locator("code").textContent()) ?? "";
    expect(movieId).toMatch(/^[0-9a-f-]{36}$/);
    await expect(page.getByLabel("Genres")).toHaveValue("Drama\nMystery");
  });

  test("a stale edit is rejected and the Admin's text is kept", async ({ browser }) => {
    const first = await browser.newPage();
    const second = await browser.newPage();
    await signInAsAdmin(first);
    await signInAsAdmin(second);
    await first.goto(movieUrl);
    await second.goto(movieUrl);
    await expect(first.getByLabel("Title")).toHaveValue(MOVIE_TITLE);
    await expect(second.getByLabel("Title")).toHaveValue(MOVIE_TITLE);

    await second.getByLabel("Director").fill("Synthetic Director");
    await second.getByRole("button", { name: "Save changes" }).click();
    await expect(second.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();

    await first.getByLabel("Director").fill("Conflicting Director");
    await first.getByRole("button", { name: "Save changes" }).click();
    await expect(first.locator(ERROR_MESSAGE)).toContainText("changed this record");
    await expect(first.getByLabel("Director")).toHaveValue("Conflicting Director");

    await first.getByRole("button", { name: "Load latest version" }).click();
    await expect(first.getByLabel("Director")).toHaveValue("Synthetic Director");
    await first.close();
    await second.close();
  });

  test("archive asks for confirmation naming the Movie; cancel changes nothing", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin/movies");
    await page.getByRole("button", { name: `Archive ${MOVIE_TITLE}` }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading")).toHaveText(`Archive movie: ${MOVIE_TITLE}`);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.getByRole("button", { name: `Archive ${MOVIE_TITLE}` }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Archive movie" }).click();
    const row = page.getByRole("row", { name: new RegExp(MOVIE_TITLE) });
    await expect(row.getByRole("status")).toHaveText("Archived");
    await expect(page.getByRole("status").filter({ hasText: `Archived “${MOVIE_TITLE}”.` })).toBeVisible();

    await row.getByRole("button", { name: `Restore ${MOVIE_TITLE}` }).click();
    await expect(row.getByRole("status")).toHaveText("Active");
    await expect(page.getByRole("status").filter({ hasText: `Restored “${MOVIE_TITLE}”.` })).toBeVisible();
  });

  test("announcement: draft with field errors, then publish and unpublish", async ({ page }) => {
    await signInAsAdmin(page);
    await page.goto("/admin/announcements/new");
    await page.getByLabel("Title").fill("Synthetic notice");
    await page.getByLabel("Body").fill("Synthetic body text.");
    await page.getByLabel("Related movie ID").fill(UNKNOWN_MOVIE_ID);
    await page.getByRole("button", { name: "Save draft" }).click();

    const movieField = page.getByLabel("Related movie ID");
    await expect(movieField).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#movieId-error")).toContainText("existing Movie");
    await expect(page.getByLabel("Body")).toHaveValue("Synthetic body text.");

    await movieField.fill(movieId);
    await page.getByRole("button", { name: "Save draft" }).click();
    await page.getByRole("link", { name: "Edit or publish “Synthetic notice”" }).click();
    await expect(page.getByRole("heading", { name: "Announcement “Synthetic notice”" })).toBeVisible();
    await expect(page.getByText("Draft", { exact: true })).toBeVisible();

    await page.getByLabel("Body").fill("Synthetic body text, revised.");
    await page.getByRole("button", { name: "Save and publish" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved and published." })).toBeVisible();
    await expect(page.getByText("Published", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save and unpublish" })).toBeVisible();

    await page.goto("/admin/announcements");
    const row = page.getByRole("row", { name: /Synthetic notice/ });
    await expect(row.getByText("Published", { exact: true })).toBeVisible();
    await row.getByRole("button", { name: "Unpublish Synthetic notice" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Unpublished “Synthetic notice”." })).toBeVisible();
    await expect(page.getByRole("row", { name: /Synthetic notice/ }).getByText("Draft", { exact: true })).toBeVisible();
  });
});
