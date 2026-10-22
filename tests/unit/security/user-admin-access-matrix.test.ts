import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  movieService,
  archiveService,
  announcementService,
  reportService,
  reviewService,
  userService,
} = vi.hoisted(() => ({
  movieService: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn() },
  archiveService: { archive: vi.fn(), restore: vi.fn() },
  announcementService: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  reportService: { list: vi.fn(), get: vi.fn(), decide: vi.fn() },
  reviewService: { list: vi.fn(), get: vi.fn(), approve: vi.fn(), hide: vi.fn(), restore: vi.fn() },
  userService: { list: vi.fn(), get: vi.fn(), updateStatus: vi.fn() },
}));

vi.mock("../../../src/server/composition", () => ({
  authGuards: {
    requireActiveAdmin: vi.fn(),
    requireActiveAdminMutation: vi.fn(),
  },
  adminMovieService: movieService,
  movieArchiveService: archiveService,
  adminAnnouncementService: announcementService,
  adminReportService: reportService,
  adminReviewService: reviewService,
  adminUserService: userService,
}));

import * as announcements from "../../../src/app/api/v1/admin/announcements/route";
import * as announcement from "../../../src/app/api/v1/admin/announcements/[id]/route";
import * as movies from "../../../src/app/api/v1/admin/movies/route";
import * as movie from "../../../src/app/api/v1/admin/movies/[id]/route";
import * as movieRestore from "../../../src/app/api/v1/admin/movies/[id]/restore/route";
import * as reports from "../../../src/app/api/v1/admin/reports/route";
import * as report from "../../../src/app/api/v1/admin/reports/[id]/route";
import * as reportDecision from "../../../src/app/api/v1/admin/reports/[id]/decision/route";
import * as reviews from "../../../src/app/api/v1/admin/reviews/route";
import * as review from "../../../src/app/api/v1/admin/reviews/[id]/route";
import * as reviewApprove from "../../../src/app/api/v1/admin/reviews/[id]/approve/route";
import * as reviewHide from "../../../src/app/api/v1/admin/reviews/[id]/hide/route";
import * as reviewRestore from "../../../src/app/api/v1/admin/reviews/[id]/restore/route";
import * as users from "../../../src/app/api/v1/admin/users/route";
import * as user from "../../../src/app/api/v1/admin/users/[id]/route";
import * as userStatus from "../../../src/app/api/v1/admin/users/[id]/status/route";
import { authGuards } from "../../../src/server/composition";

const ID = "00000000-0000-4000-8000-000000000011";
const context = { params: Promise.resolve({ id: ID }) };
const services = [movieService, archiveService, announcementService, reportService, reviewService, userService];

function request(path: string, method = "GET"): Request {
  return new Request(`http://localhost:3000${path}`, {
    method,
    headers: method === "GET" ? undefined : { "content-type": "application/json", origin: "http://localhost:3000" },
    body: method === "GET" ? undefined : "{}",
  });
}

const readCases = [
  ["movies list", () => movies.GET(request("/api/v1/admin/movies"))],
  ["movie detail", () => movie.GET(request(`/api/v1/admin/movies/${ID}`), context)],
  ["announcements list", () => announcements.GET(request("/api/v1/admin/announcements"))],
  ["announcement detail", () => announcement.GET(request(`/api/v1/admin/announcements/${ID}`), context)],
  ["reports list", () => reports.GET(request("/api/v1/admin/reports"))],
  ["report detail", () => report.GET(request(`/api/v1/admin/reports/${ID}`), context)],
  ["reviews list", () => reviews.GET(request("/api/v1/admin/reviews"))],
  ["review detail", () => review.GET(request(`/api/v1/admin/reviews/${ID}`), context)],
  ["users list", () => users.GET(request("/api/v1/admin/users"))],
  ["user detail", () => user.GET(request(`/api/v1/admin/users/${ID}`), context)],
] as const;

const mutationCases = [
  ["movie create", () => movies.POST(request("/api/v1/admin/movies", "POST"))],
  ["movie patch", () => movie.PATCH(request(`/api/v1/admin/movies/${ID}`, "PATCH"), context)],
  ["movie archive", () => movie.DELETE(request(`/api/v1/admin/movies/${ID}`, "DELETE"), context)],
  ["movie restore", () => movieRestore.POST(request(`/api/v1/admin/movies/${ID}/restore`, "POST"), context)],
  ["announcement create", () => announcements.POST(request("/api/v1/admin/announcements", "POST"))],
  ["announcement patch", () => announcement.PATCH(request(`/api/v1/admin/announcements/${ID}`, "PATCH"), context)],
  ["announcement delete", () => announcement.DELETE(request(`/api/v1/admin/announcements/${ID}`, "DELETE"), context)],
  ["report decision", () => reportDecision.POST(request(`/api/v1/admin/reports/${ID}/decision`, "POST"), context)],
  ["review approve", () => reviewApprove.POST(request(`/api/v1/admin/reviews/${ID}/approve`, "POST"), context)],
  ["review hide", () => reviewHide.POST(request(`/api/v1/admin/reviews/${ID}/hide`, "POST"), context)],
  ["review restore", () => reviewRestore.POST(request(`/api/v1/admin/reviews/${ID}/restore`, "POST"), context)],
  ["user status", () => userStatus.PATCH(request(`/api/v1/admin/users/${ID}/status`, "PATCH"), context)],
] as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authGuards!.requireActiveAdmin).mockResolvedValue({ ok: false, error: { kind: "forbidden" } });
  vi.mocked(authGuards!.requireActiveAdminMutation).mockResolvedValue({ ok: false, error: { kind: "forbidden" } });
});

describe("active USER denial matrix for Admin APIs (AT-01, SEC-01)", () => {
  it.each(readCases)("denies %s before reading domain data", async (_name, invoke) => {
    const response = await invoke();
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("forbidden");
    for (const service of services) {
      for (const operation of Object.values(service)) expect(operation).not.toHaveBeenCalled();
    }
  });

  it.each(mutationCases)("denies %s before validation or mutation", async (_name, invoke) => {
    const response = await invoke();
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("forbidden");
    for (const service of services) {
      for (const operation of Object.values(service)) expect(operation).not.toHaveBeenCalled();
    }
  });
});
