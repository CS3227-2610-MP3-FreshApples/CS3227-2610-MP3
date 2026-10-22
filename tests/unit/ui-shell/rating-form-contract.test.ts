import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import * as formPrimitives from "../../../src/components/form-primitives";
import { FormField } from "../../../src/components/form-primitives";
import { AggregateRating } from "../../../src/components/rating-primitives";

// @ts-expect-error K12 requires a ReactElement child for FormField.
const missingFieldChild = createElement(FormField, { label: "Movie title", name: "title" });
void missingFieldChild;

describe("rating and form contracts", () => {
  it("exposes AggregateRating only through the approved rating primitive API", () => {
    const populated = renderToStaticMarkup(createElement(AggregateRating, {
      average: 8.367,
      count: 12,
      emptyLabel: "No ratings yet",
    }));
    const empty = renderToStaticMarkup(createElement(AggregateRating, {
      average: null,
      count: 0,
      emptyLabel: "No ratings yet",
    }));

    expect(formPrimitives).not.toHaveProperty("AggregateRating");
    expect(populated).toContain("8.3/10");
    expect(empty).toContain("No ratings yet");
  });
});
