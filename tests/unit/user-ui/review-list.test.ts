import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ReviewStatus } from "../../../src/app/app/reviews/_components/review-list";

describe("My reviews status presentation", () => {
  it.each([
    ["pending", "Pending moderation", "warning"],
    ["flagged", "Held for review", "warning"],
    ["cleared", "Published", "success"],
  ] as const)("labels %s safely", (state, label, tone) => {
    const html = renderToStaticMarkup(createElement(ReviewStatus, { state }));
    expect(html).toContain(`aria-label="Review status"`);
    expect(html).toContain(label);
    expect(html).toContain(`data-tone="${tone}"`);
  });
});
