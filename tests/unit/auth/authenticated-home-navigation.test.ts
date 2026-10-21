import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/components/route-shell", () => ({
  RouteShell: (props: { authAware?: boolean; children?: React.ReactNode }) => createElement(
    "div",
    { "data-auth-aware": props.authAware === true ? "true" : "false" },
    props.children,
  ),
  publicNavigation: [],
}));

import Home from "../../../src/app/page";

describe("authenticated public navigation", () => {
  it("keeps the Home route connected to the authenticated navigation lookup", () => {
    const rendered = renderToStaticMarkup(createElement(Home));

    expect(rendered).toContain('data-auth-aware="true"');
  });
});
