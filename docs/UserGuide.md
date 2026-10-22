---
layout: default.md
title: "User Guide"
pageNav: 3
---

# FreshApples User Guide

FreshApples is a moderated movie-review community. Anyone can browse the movie catalogue, read published reviews, view announcements, and read available review summaries. Registered Users can report a published review, while Admins maintain the catalogue and announcements.

<page-nav-print />

--------------------------------------------------------------------------------------------------------------------

## Quick start

1. Open the FreshApples application in your browser.
2. Select **Movies** to browse the active catalogue. Use the title search and sort controls to find a movie.
3. Select a movie title to read its synopsis, metadata, community rating, published reviews, and review summary when one is available.
4. To use account features, select **Register** and create a User account, or select **Sign in** if you already have one.
5. After signing in, select your display name to open your private workspace. **My reviews** shows your saved review statuses, and **My reports** shows reports that you submitted.
6. Select **Announcements** to read published product and community updates.

> **Current release note:** The application exposes the User review and reporting services, but review creation and editing controls are not yet available in the current browser UI. The Admin review moderation, report decision, and user-management pages are also not yet interactive. This guide documents the workflows currently available from the site.

--------------------------------------------------------------------------------------------------------------------

## Features

### 1. General navigation

The header links provide the following destinations:

| Link | Use |
| --- | --- |
| **Home** | Return to the FreshApples landing page. |
| **Movies** | Search and browse active movies. |
| **Announcements** | Read published announcements. |
| **Sign in** / **Register** | Open account access pages when signed out. |
| Your display name | Open the User or Admin workspace when signed in. |

Use the **Back to movies** link on a movie details page to return to the catalogue. The site also provides a **Skip to main content** link for keyboard users.

### 2. Browsing and finding movies

#### 2.1 Listing movies

The Movies page lists active movies with their title, release year, genres, and community rating.

* Use **Search by title** to find titles. Searches are case-insensitive and may contain up to 200 characters.
* Use **Sort movies** to choose **Newest release** or **Title A–Z**.
* Use the page controls to move through the results.
* Select a title to open its movie details.

If no movie matches the search, select **Clear search** to return to the full catalogue. A movie with no published reviews shows **No community ratings yet**.

#### 2.2 Reading movie details

A movie details page may contain:

* title, synopsis, release date, genres, director, cast, and runtime;
* the average community rating and published-review count;
* published reviews, including the author's display name, rating, text, and edited date; and
* a review summary generated from a sample of eligible reviews.

Archived movies are not shown in public movie results. Unknown or unavailable movie pages cannot be opened publicly.

#### 2.3 Reading a review summary

Review summaries are labelled **AI summary of a sample; may miss opinions or make mistakes**. A ready summary displays an overall view, strengths, criticisms, mixed opinions, the number of reviews included, and its generation time.

The summary can also show one of these messages:

* **Not enough reviews for a summary yet** — at least three eligible reviews are required.
* **A review summary is awaiting its scheduled update** — the movie's reviews changed and the next scheduled update has not completed.
* **The review summary is temporarily unavailable** — the summary service could not be read.

There is no generate, retry, or regenerate button. Summaries are scheduled by the application.

### 3. Accounts

#### 3.1 Creating an account

Select **Register** and enter a display name, email address, password, and the same password again. Select **Create an account**. Public registration always creates a User account; it cannot create an Admin account or choose an account status.

After successful registration, select **Sign in** to access the account.

#### 3.2 Signing in and out

Select **Sign in**, enter your email address and password, and submit the form. Active Users are taken to the User workspace. Admins are taken to the Admin workspace.

Sign out using the account control provided by the application. Signing out invalidates the current session. If sign-in fails, FreshApples uses a general error message and does not reveal whether an account exists or is suspended.

#### 3.3 Account access rules

* Suspended Users may still browse public pages and sign out, but cannot use authenticated features.
* Users can access only their own review and report information.
* Admin accounts are provisioned by the project operator; they cannot be created through public registration.
* There is no self-service password recovery in the current release. Contact the project operator if an account needs controlled recovery.

### 4. User workspace

Select your display name after signing in to open the private workspace.

#### 4.1 My reviews

**My reviews** lists your non-deleted, non-hidden reviews and their current moderation state:

| Status | Meaning |
| --- | --- |
| **Published** | The review is visible on its movie's public page. |
| **Pending moderation** | The review has been saved and is waiting for an automatic check or recovery attempt. |
| **Held for review** | The review is not public and requires moderation. |

The list includes the movie link, review text, rating, status, and last-updated time. Deleted and Admin-hidden reviews are not shown in this list.

#### 4.2 My reports

**My reports** lists only reports that you submitted. Each entry shows its category, status, and submission time.

Possible statuses are **Submitted — awaiting review**, **Accepted**, and **Dismissed**. Reports received about you, report counts, evidence snapshots, Admin notes, and private moderation assessments are not shown to Users.

### 5. Reporting a published review

1. Sign in as a User.
2. Open **Movies**, choose a movie, and locate a published review written by another User.
3. Select **Report user**.
4. Choose **Profanity**, **Harassment**, **Hate**, **Spam**, or **Other**.
5. Explain the concern in 10–1,000 characters. A report is an allegation for Admin review, not an established violation.
6. Select **Submit report**.

The report is submitted with the review as evidence. You can follow its status from **My reports**. You cannot report yourself, report anonymously, or submit a duplicate open report for the same review.

### 6. Announcements

The public **Announcements** page shows published announcements ordered by publication date. An announcement may include a link to an active related movie. If its related movie has been archived, the announcement remains readable without a public movie link.

If there are no published announcements, the page displays **There are no published announcements**.

### 7. Admin workspace

Only Admin accounts can open the Admin workspace. The current interactive Admin features are catalogue and announcement management.

#### 7.1 Managing movies

From **Admin > Movies**, an Admin can view active and archived movies, create a movie, edit its metadata, archive an active movie after confirming its title, and restore an archived movie.

Required movie fields are **Title** and **Synopsis**. Optional fields are release date, genres, director, cast, and runtime in minutes. Archived movies are hidden from public pages but their records and related history are retained.

#### 7.2 Managing announcements

From **Admin > Announcements**, an Admin can create an announcement as a draft, edit its title/body/optional related movie ID, publish a draft, unpublish a published announcement back to a draft, and view announcement state and publication time.

Drafts are visible only to Admins. Publishing makes an announcement public immediately. Announcement title and body are plain text; each may contain up to 5,000 characters, and the title is required.

#### 7.3 Admin pages not yet interactive

The **Review moderation**, **Reports**, and **Users** pages are present in the Admin navigation but are currently informational placeholders. They do not yet provide the final moderation, report-decision, suspension, or reinstatement controls.

--------------------------------------------------------------------------------------------------------------------

## Input rules and constraints

### Registration

* Display names contain 1–60 characters.
* Email addresses must be valid and no longer than 254 characters.
* Passwords contain 12–128 characters, including at least one number and one special character. Passphrases and pasted passwords are supported.
* The email address must not already belong to an account.

### Reviews and reports

The review service accepts a rating from 1 to 10 and plain-text review content of 10–2,000 characters. The current browser UI does not expose review authoring controls.

Report explanations must be plain text of 10–1,000 characters. Report categories are **profanity**, **harassment**, **hate**, **spam**, and **other**.

### Admin catalogue and announcements

* Movie titles are required and may contain up to 200 characters.
* Movie synopses are required and may contain up to 5,000 characters.
* Announcement titles are required and may contain up to 200 characters.
* Announcement bodies are required and may contain up to 5,000 characters.
* Movie release dates must be valid calendar dates.
* Movie runtime is a whole number from 1 to 1,000 minutes.
* Genres and cast are entered as one item per line.

All user-generated text is treated as plain text. Do not paste HTML or scripts into text fields.

--------------------------------------------------------------------------------------------------------------------

## FAQ

**Q: Can I browse without an account?**<br>
**A:** Yes. Movie listings, movie details, published reviews, announcements, and available review summaries are public.

**Q: Why can I see a movie but not a review?**<br>
**A:** Only cleared, non-deleted, non-hidden reviews on active movies are public. A review may still be pending or held for moderation.

**Q: Why is a review summary missing?**<br>
**A:** The movie may have fewer than three eligible reviews, the summary may be awaiting a scheduled update, or the summary service may be temporarily unavailable.

**Q: Can I report a User without signing in?**<br>
**A:** No. Reporting requires a signed-in User account and is available from another User's published review.

**Q: Can the person I reported see my report?**<br>
**A:** No. Reports, evidence, report counts, and Admin notes are private to the reporting workflow. You can see only the reports you submitted.

**Q: Can I register as an Admin?**<br>
**A:** No. Public registration always creates a User account. Admin accounts are provisioned through a controlled operator process.

**Q: Why does an Admin page not let me perform an action?**<br>
**A:** Catalogue and announcement management are the currently interactive Admin workflows. Review moderation, report decisions, and user management are not yet available in this release.

**Q: What should I do if a page cannot load?**<br>
**A:** Use the page's retry control where one is provided, check your connection, and try again later. Do not repeatedly resubmit a mutation if the result is unclear; first check the relevant list or private workspace.

--------------------------------------------------------------------------------------------------------------------

## Feature summary

| Area | Available action | Where |
| --- | --- | --- |
| Public catalogue | Browse, search, sort, paginate, and open details | **Movies** |
| Public reviews | Read published reviews and report another User's review | Movie details |
| Public summaries | Read the scheduled AI summary and its disclosure | Movie details |
| Accounts | Register, sign in, and sign out | **Register**, **Sign in**, account control |
| User workspace | View own review and report history | **My reviews**, **My reports** |
| Announcements | Read published announcements | **Announcements** |
| Admin catalogue | Create, edit, archive, and restore movies | **Admin > Movies** |
| Admin announcements | Create drafts, edit, publish, and unpublish announcements | **Admin > Announcements** |

The application is a web interface; it does not require a command-line client or a local data file.
