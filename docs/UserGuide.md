---
layout: default.md
title: "User Guide"
pageNav: 3
---

# FreshApples User Guide

FreshApples is a moderated movie-review community. Visitors can discover movies, read published reviews and announcements, and view scheduled review summaries. Users can submit reviews and report another User's published review. Admins manage the catalogue and make moderation decisions.

<page-nav-print />

--------------------------------------------------------------------------------------------------------------------

## Quick start

1. Open the FreshApples application in your browser.
2. Select **Movies** to browse the active catalogue. Search by title or sort by newest release or title.
3. Select a movie to read its details, reviews, review summary, and the review form.
4. Select **Register** to create a User account, or **Sign in** if you already have one.
5. After signing in, select your display name to open the User workspace. **My reviews** shows your review statuses and **My reports** shows reports you submitted.
6. Admins can use the Admin dashboard to manage movies, announcements, reviews, and reports.

--------------------------------------------------------------------------------------------------------------------

## Features

### 1. Navigation

The header provides these links:

| Link | Purpose |
| --- | --- |
| **Home** | Return to the FreshApples landing page. |
| **Movies** | Search the catalogue and open movie details. |
| **Announcements** | Read published announcements. |
| **Sign in** / **Register** | Access account features when signed out. |
| Your display name | Open the User or Admin workspace when signed in. |

Use **Back to movies** on a movie page to return to the catalogue. Keyboard users can use **Skip to main content**.

### 2. Discovering movies

#### 2.1 Browse and search

The Movies page lists active movies with their title, release year, genres, and community rating.

* Enter a title in **Search by title**. Searches are case-insensitive and accept up to 200 characters.
* Choose **Newest release** or **Title A–Z** from **Sort movies**.
* Use the page controls to move through results.
* Select a movie title to open its details.

Select **Clear search** when no results match your search. A movie without published reviews shows **No community ratings yet**. Archived movies do not appear in public results.

#### 2.2 Read movie details

Movie details may include the synopsis, release date, genres, director, cast, runtime, average rating, review count, published reviews, review form, and review summary.

Published reviews show the author's display name, rating out of 10, review text, and updated time. Edited reviews are labelled **Edited**.

### 3. Accounts

#### 3.1 Register

Select **Register** and enter a display name, email address, password, and matching password confirmation. Select **Create an account**, then use **Sign in**.

Public registration always creates a User account. It cannot select the Admin role or account status.

#### 3.2 Sign in and sign out

Select **Sign in**, enter your email address and password, and submit the form. Active Users go to the User workspace; Admins go to the Admin dashboard. Select **Sign out** from the account control when finished.

Sign-in errors are intentionally general and do not reveal whether an account exists or is suspended. Suspended Users may browse public pages and sign out, but cannot use authenticated features.

Admin accounts are provisioned through a controlled operator process and cannot be created through public registration. Self-service password recovery is not available in this release.

### 4. User reviews

#### 4.1 Submit a review

1. Sign in as a User and open **Movies**.
2. Select a movie and scroll to **Share your perspective**.
3. Choose a whole-number **Rating** from 1 to 10.
4. Enter a plain-text review of 10–2,000 characters.
5. Select **Submit review**.

Your review is saved before automatic screening completes. The message identifies whether it is pending moderation, held for review, or published. A review must be cleared before it appears publicly or contributes to the movie's rating.

Users can submit one review per movie. The current browser UI provides submission and status viewing; review editing and deletion controls are not exposed here.

#### 4.2 My reviews

Open **My reviews** from the User workspace. The list shows your review text, rating, movie link, status, and last-updated time.

| Status | Meaning |
| --- | --- |
| **Published** | Cleared and visible on the movie's public page. |
| **Pending moderation** | Waiting for automatic assessment or recovery. |
| **Held for review** | Not public and awaiting moderation. |

Deleted and Admin-hidden reviews are not shown in the User list. Authors do not see private AI explanations or reports received about them.

### 5. Report a published review

1. Sign in as a User.
2. Open a movie and locate another User's published review.
3. Select **Report user**.
4. Choose **Profanity**, **Harassment**, **Hate**, **Spam**, or **Other**.
5. Enter an explanation of 10–1,000 characters.
6. Select **Submit report**.

A report is an allegation for Admin review, not an established violation. The report records the review as immutable evidence. You cannot report yourself or submit a duplicate open report for the same review.

#### 5.1 My reports

Open **My reports** to see only reports you submitted. Each report shows its category, status, and submission time.

| Status | Meaning |
| --- | --- |
| **Submitted — awaiting review** | An Admin has not made a final decision. |
| **Accepted** | An Admin accepted the allegation. |
| **Dismissed** | An Admin dismissed the allegation. |

Report recipients cannot see received reports, reporter identity, evidence, counts, or Admin notes.

### 6. Review summaries

Movie pages may show a scheduled AI-generated review summary labelled **AI summary of a sample; may miss opinions or make mistakes**. A ready summary includes an overall view, strengths, criticisms, mixed opinions, the number of reviews included, and the generation time.

Other states are:

* **Not enough reviews for a summary yet** — at least three eligible reviews are required.
* **A review summary is awaiting its scheduled update** — review changes are waiting for the scheduled process.
* **The review summary is temporarily unavailable** — the service could not be read.

Summaries are read-only. There is no generate, retry, or regenerate button.

### 7. Announcements

The public **Announcements** page lists published announcements by publication time. An announcement may link to an active related movie. If that movie is archived, the announcement remains readable and its public movie link is omitted.

### 8. Admin workspace

Only Admin accounts can use the Admin dashboard. Admin actions require a reason where stated and are recorded in the private audit history.

#### 8.1 Manage movies

Open **Admin > Movies** to:

* view active and archived movies;
* create a movie;
* edit movie metadata;
* archive an active movie after confirming its title; and
* restore an archived movie.

Archiving hides a movie from public pages but retains its reviews and history. Editing an archived movie does not restore it; restore it from the movie list when ready.

#### 8.2 Manage announcements

Open **Admin > Announcements** to create, edit, publish, and unpublish announcements.

New announcements are saved as drafts. Drafts are Admin-only. **Save and publish** makes a draft public immediately. Editing a published announcement updates the public content immediately. **Save and unpublish** returns it to a draft. Deleted announcements are retained for reading but cannot be edited or published again.

#### 8.3 Moderate reviews

Open **Admin > Reviews** to inspect review text and automatic assessments.

1. Filter by assessment or state, such as **Pending**, **Flagged**, **Needs manual review**, **Failed automatic assessment**, **Hidden**, **Deleted**, or **Cleared**. You can also filter by Movie ID.
2. Select a review to open its detail page.
3. Read the current review text, status, visibility message, and automatic assessment. An assessment may be historical if it belongs to an earlier review version.
4. Enter a reason of 10–1,000 characters.
5. Choose **Approve review**, **Hide review**, or **Restore review**, then confirm the action.

Automatic assessments are advisory and may be wrong. Read the current source text before deciding. Approval does not undo an author's deletion or an Admin hide. Restore removes only the Admin hide; pending or flagged text remains unpublished, and an archived movie remains non-public. These actions do not add strikes.

If the review changed while you were deciding, use **Load latest version**, read the new text, and submit a new decision. Loading the latest version does not submit a decision.

#### 8.4 Moderate reports

Open **Admin > Reports** to review submitted reports. Filter by **Open**, **Accepted**, **Dismissed**, or **All reports**, and by category.

Open a report to read:

* the reporter's explanation;
* the immutable evidence snapshot, including review text and rating;
* the live review state;
* the target account status; and
* the projected strike and suspension effect.

For an open report, enter a reason of 10–1,000 characters and choose one action:

* **Dismiss report** — records a dismissal without a strike;
* **Accept report** — accepts the allegation and applies the projected moderation effect; or
* **Accept and hide review** — accepts the allegation and hides the evidence review.

Confirm the decision. Accepted reports may add one strike for the review incident. Reaching the configured threshold may suspend the target account and revoke its sessions. The AI assessment never accepts reports or suspends accounts.

#### 8.5 Manage users

**Admin > Users** is currently unavailable because its approved Admin read model has not been added. No user records or account-status controls are shown there yet.

--------------------------------------------------------------------------------------------------------------------

## Input rules and constraints

### Registration

* Display names contain 1–60 characters.
* Email addresses must be valid and no longer than 254 characters.
* Passwords contain 12–128 characters, including at least one number and one special character.
* The email address must not already belong to an account.

### Reviews and reports

* Review ratings are whole numbers from 1 to 10.
* Review text is plain text of 10–2,000 characters.
* Report explanations are plain text of 10–1,000 characters.
* Report categories are profanity, harassment, hate, spam, and other.

### Admin catalogue and announcements

* Movie titles are required and may contain up to 200 characters.
* Movie synopses are required and may contain up to 5,000 characters.
* Announcement titles are required and may contain up to 200 characters.
* Announcement bodies are required and may contain up to 5,000 characters.
* Movie release dates must be valid calendar dates.
* Movie runtime is a whole number from 1 to 1,000 minutes.
* Genres and cast are entered one item per line.

All user-generated text is treated as plain text. Do not paste HTML or scripts into text fields.

--------------------------------------------------------------------------------------------------------------------

## FAQ

**Q: Can I browse without an account?**<br>
**A:** Yes. Movie listings, details, published reviews, announcements, and available summaries are public.

**Q: Why is my submitted review not public yet?**<br>
**A:** New and changed review text is checked before publication. It may be pending or held for Admin review.

**Q: Why is a review summary missing?**<br>
**A:** The movie may have fewer than three eligible reviews, the summary may be awaiting its scheduled update, or the summary service may be temporarily unavailable.

**Q: Can I report a User without signing in?**<br>
**A:** No. Reporting requires a signed-in User account and is available from another User's published review.

**Q: Can the person I reported see my report?**<br>
**A:** No. Received reports and their evidence are private to Admins.

**Q: Can I register as an Admin?**<br>
**A:** No. Public registration always creates a User account.

**Q: Why can an Admin not see user-management controls?**<br>
**A:** The Users workspace is not available yet. The current Admin UI supports movie, announcement, review, and report workflows.

**Q: What should I do if a page cannot load?**<br>
**A:** Use the page's retry control where provided, check your connection, and try again later. If a mutation result is unclear, check the relevant list before resubmitting.

--------------------------------------------------------------------------------------------------------------------

## Feature summary

| Area | Available action | Where |
| --- | --- | --- |
| Public catalogue | Browse, search, sort, paginate, and open details | **Movies** |
| User reviews | Submit a rating and plain-text review; view status | Movie details, **My reviews** |
| Public reviews | Read published reviews and report another User | Movie details |
| User reports | View submitted report status | **My reports** |
| Public summaries | Read the scheduled AI summary and disclosure | Movie details |
| Accounts | Register, sign in, and sign out | **Register**, **Sign in**, account control |
| Announcements | Read published announcements | **Announcements** |
| Admin catalogue | Create, edit, archive, and restore movies | **Admin > Movies** |
| Admin announcements | Create, edit, publish, and unpublish announcements | **Admin > Announcements** |
| Admin review moderation | Filter, inspect, approve, hide, and restore reviews | **Admin > Reviews** |
| Admin report moderation | Filter, inspect, accept, dismiss, and accept-and-hide reports | **Admin > Reports** |

The application is a web interface; it does not require a command-line client or a local data file.
