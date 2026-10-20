# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: admin-catalogue.spec.ts >> Admin movie and announcement screens >> a stale edit is rejected and the Admin's text is kept
- Location: tests\e2e\admin-catalogue.spec.ts:73:7

# Error details

```
Error: page.goto: Target page, context or browser has been closed
```

# Page snapshot

```yaml
- generic [active] [ref=f1e1]:
  - generic [ref=f1e2]:
    - link "Skip to main content" [ref=f1e3] [cursor=pointer]:
      - /url: "#main-content"
    - banner [ref=f1e4]:
      - paragraph [ref=f1e5]: Admin dashboard
      - navigation "Admin dashboard navigation" [ref=f1e6]:
        - list [ref=f1e7]:
          - listitem [ref=f1e8]:
            - link "Overview" [ref=f1e9] [cursor=pointer]:
              - /url: /admin
          - listitem [ref=f1e10]:
            - link "Movies" [ref=f1e11] [cursor=pointer]:
              - /url: /admin/movies
          - listitem [ref=f1e12]:
            - link "Reviews" [ref=f1e13] [cursor=pointer]:
              - /url: /admin/reviews
          - listitem [ref=f1e14]:
            - link "Reports" [ref=f1e15] [cursor=pointer]:
              - /url: /admin/reports
          - listitem [ref=f1e16]:
            - link "Announcements" [ref=f1e17] [cursor=pointer]:
              - /url: /admin/announcements
          - listitem [ref=f1e18]:
            - link "Users" [ref=f1e19] [cursor=pointer]:
              - /url: /admin/users
    - main [ref=f1e20]:
      - generic [ref=f1e21]:
        - heading "Admin overview" [level=1] [ref=f1e22]
        - paragraph [ref=f1e23]: Manage the catalogue and moderation work.
  - alert [ref=f1e24]
```

# Test source

```ts
  1   | import { expect, test, type Page } from "@playwright/test";
  2   | 
  3   | // B#6 commit 3 (A-01/A-02 UI; FR-05, FR-07, D-21): the Admin movie and announcement screens against the
  4   | // real API and a disposable database. Synthetic data only. The public halves of AT-02/AT-06 wait on
  5   | // U-01, and archive/restore return 503 until K8 is wired (D-84), so this spec asserts that interim state.
  6   | 
  7   | const MOVIE_TITLE = "Synthetic E2E Movie";
  8   | const UNKNOWN_MOVIE_ID = "00000000-0000-4000-8000-00000000e2e0";
  9   | /** The K12 StatusMessage error; Next.js also renders an empty route announcer with role="alert". */
  10  | const ERROR_MESSAGE = "[role=\"alert\"][data-status=\"error\"]";
  11  | 
  12  | async function ensureAdmin(page: Page): Promise<void> {
  13  |   const response = await page.request.post("/api/v1/internal/bootstrap/admin", {
  14  |     headers: { "x-admin-bootstrap-secret": process.env.ADMIN_BOOTSTRAP_SECRET! },
  15  |   });
  16  |   expect(response.status()).toBe(200);
  17  |   expect(["created", "already_provisioned"]).toContain((await response.json()).status);
  18  | }
  19  | 
  20  | async function signInAsAdmin(page: Page): Promise<void> {
> 21  |   await page.goto("/sign-in");
      |              ^ Error: page.goto: Target page, context or browser has been closed
  22  |   await page.getByLabel("Email address").fill(process.env.ADMIN_BOOTSTRAP_EMAIL!);
  23  |   await page.getByLabel("Password").fill(process.env.ADMIN_BOOTSTRAP_PASSWORD!);
  24  |   await page.getByRole("button", { name: "Sign in" }).click();
  25  |   await page.waitForURL("**/admin");
  26  | }
  27  | 
  28  | test.describe.serial("Admin movie and announcement screens", () => {
  29  |   let movieUrl = "";
  30  |   let movieId = "";
  31  | 
  32  |   test.beforeAll(async ({ browser }) => {
  33  |     const page = await browser.newPage();
  34  |     await ensureAdmin(page);
  35  |     await page.close();
  36  |   });
  37  | 
  38  |   test("an anonymous visitor gets an error state, not Admin data", async ({ page }) => {
  39  |     await page.goto("/admin/movies");
  40  |     await expect(page.locator(ERROR_MESSAGE)).toContainText("Sign in again");
  41  |     await expect(page.getByRole("table")).toHaveCount(0);
  42  |   });
  43  | 
  44  |   test("create shows field errors tied to their fields and keeps the typed text", async ({ page }) => {
  45  |     await signInAsAdmin(page);
  46  |     await page.goto("/admin/movies");
  47  |     await expect(page.getByRole("status").filter({ hasText: "No movies yet" })).toBeVisible();
  48  | 
  49  |     await page.getByRole("link", { name: "Create movie" }).click();
  50  |     await page.getByLabel("Title").fill(MOVIE_TITLE);
  51  |     await page.getByLabel("Genres").fill("Drama\nMystery");
  52  |     await page.getByRole("button", { name: "Create movie" }).click();
  53  | 
  54  |     const synopsis = page.getByLabel("Synopsis");
  55  |     await expect(synopsis).toHaveAttribute("aria-invalid", "true");
  56  |     await expect(synopsis).toHaveAttribute("aria-describedby", /synopsis-error/);
  57  |     await expect(page.locator("#synopsis-error")).toBeVisible();
  58  |     await expect(page.getByLabel("Title")).toHaveValue(MOVIE_TITLE);
  59  |     await expect(page.getByLabel("Genres")).toHaveValue("Drama\nMystery");
  60  | 
  61  |     await synopsis.fill("A synthetic synopsis for the end-to-end journey.");
  62  |     await page.getByRole("button", { name: "Create movie" }).click();
  63  |     await expect(page.getByRole("status").filter({ hasText: `Created “${MOVIE_TITLE}”.` })).toBeVisible();
  64  | 
  65  |     await page.getByRole("link", { name: `Edit “${MOVIE_TITLE}”` }).click();
  66  |     await expect(page.getByRole("heading", { name: `Edit “${MOVIE_TITLE}”` })).toBeVisible();
  67  |     movieUrl = page.url();
  68  |     movieId = (await page.locator("code").textContent()) ?? "";
  69  |     expect(movieId).toMatch(/^[0-9a-f-]{36}$/);
  70  |     await expect(page.getByLabel("Genres")).toHaveValue("Drama\nMystery");
  71  |   });
  72  | 
  73  |   test("a stale edit is rejected and the Admin's text is kept", async ({ browser }) => {
  74  |     const first = await browser.newPage();
  75  |     const second = await browser.newPage();
  76  |     await signInAsAdmin(first);
  77  |     await signInAsAdmin(second);
  78  |     await first.goto(movieUrl);
  79  |     await second.goto(movieUrl);
  80  |     await expect(first.getByLabel("Title")).toHaveValue(MOVIE_TITLE);
  81  |     await expect(second.getByLabel("Title")).toHaveValue(MOVIE_TITLE);
  82  | 
  83  |     await second.getByLabel("Director").fill("Synthetic Director");
  84  |     await second.getByRole("button", { name: "Save changes" }).click();
  85  |     await expect(second.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  86  | 
  87  |     await first.getByLabel("Director").fill("Conflicting Director");
  88  |     await first.getByRole("button", { name: "Save changes" }).click();
  89  |     await expect(first.locator(ERROR_MESSAGE)).toContainText("changed this record");
  90  |     await expect(first.getByLabel("Director")).toHaveValue("Conflicting Director");
  91  | 
  92  |     await first.getByRole("button", { name: "Load latest version" }).click();
  93  |     await expect(first.getByLabel("Director")).toHaveValue("Synthetic Director");
  94  |     await first.close();
  95  |     await second.close();
  96  |   });
  97  | 
  98  |   test("archive asks for confirmation naming the Movie; cancel changes nothing", async ({ page }) => {
  99  |     await signInAsAdmin(page);
  100 |     await page.goto("/admin/movies");
  101 |     await page.getByRole("button", { name: `Archive ${MOVIE_TITLE}` }).click();
  102 | 
  103 |     const dialog = page.getByRole("dialog");
  104 |     await expect(dialog).toBeVisible();
  105 |     await expect(dialog.getByRole("heading")).toHaveText(`Archive movie: ${MOVIE_TITLE}`);
  106 |     await dialog.getByRole("button", { name: "Cancel" }).click();
  107 |     await expect(page.getByRole("dialog")).toHaveCount(0);
  108 | 
  109 |     // D-84: archive returns 503 until U-02's K8 is wired. Replace with the archived/restore round trip then.
  110 |     await page.getByRole("button", { name: `Archive ${MOVIE_TITLE}` }).click();
  111 |     await page.getByRole("dialog").getByRole("button", { name: "Archive movie" }).click();
  112 |     await expect(page.locator(ERROR_MESSAGE)).toContainText("temporarily unavailable");
  113 |     await expect(page.getByRole("row", { name: new RegExp(MOVIE_TITLE) }).getByRole("status")).toHaveText("Active");
  114 |   });
  115 | 
  116 |   test("announcement: draft with field errors, then publish and unpublish", async ({ page }) => {
  117 |     await signInAsAdmin(page);
  118 |     await page.goto("/admin/announcements/new");
  119 |     await page.getByLabel("Title").fill("Synthetic notice");
  120 |     await page.getByLabel("Body").fill("Synthetic body text.");
  121 |     await page.getByLabel("Related movie ID").fill(UNKNOWN_MOVIE_ID);
```