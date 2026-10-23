import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StatusMessage } from "../../../src/components/status-primitives";
import {
  SummaryRegeneration,
  summaryRegenerationNotice,
} from "../../../src/app/admin/movies/_components/summary-regeneration";

describe("Admin summary regeneration control", () => {
  it("explains immediate invalidation and exposes the public summary link", () => {
    const html = renderToStaticMarkup(createElement(SummaryRegeneration, { movieId: "movie/id" }));

    expect(html).toContain("Regenerate AI summary");
    expect(html).toContain("current summary becomes pending immediately");
    expect(html).toContain('href="/movies/movie%2Fid"');
    expect(html).toContain("View public movie summary");
  });

  it.each([
    ["generated", "success", "was regenerated"],
    ["pending", "info", "Scheduled recovery"],
    ["insufficient_reviews", "warning", "at least three eligible reviews"],
  ] as const)("announces the %s outcome as %s", (status, tone, copy) => {
    const notice = summaryRegenerationNotice({ status });
    const html = renderToStaticMarkup(createElement(StatusMessage, { status: notice.status }, notice.message));
    expect(html).toContain(`data-status="${tone}"`);
    expect(html).toContain('role="status"');
    expect(html).toContain(copy);
  });

  it("uses an alert for a safe request failure", () => {
    const html = renderToStaticMarkup(createElement(StatusMessage, { status: "error" }, "Your session has ended."));
    expect(html).toContain('role="alert"');
    expect(html).toContain("Your session has ended.");
  });
});
