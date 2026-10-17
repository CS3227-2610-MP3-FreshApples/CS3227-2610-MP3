import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ConfirmDialog } from "../../../src/components/confirmation-dialog";

function html(): string {
  return renderToStaticMarkup(
    createElement(ConfirmDialog, {
      confirmLabel: "Confirm Archive",
      consequence: "This action will affect the named target: The Matrix.",
      dialogId: "archive-movie",
      onCancel: () => undefined,
      onConfirm: () => undefined,
      open: true,
      targetName: "The Matrix",
      title: "Confirm Archive",
    }),
  );
}

describe("K12 confirmation dialog", () => {
  it("names the action target through the dialog title and description", () => {
    const rendered = html();

    expect(rendered).toContain('<dialog open="" aria-labelledby="archive-movie-title"');
    expect(rendered).toContain('aria-describedby="archive-movie-description"');
    expect(rendered).toContain('id="archive-movie-title"');
    expect(rendered).toContain("Confirm Archive");
    expect(rendered).toContain("The Matrix");
  });

  it("provides native keyboard confirm and cancel controls without claiming authorization", () => {
    const rendered = html();

    expect(rendered).toContain('<form method="dialog">');
    expect(rendered).toContain('value="confirm"');
    expect(rendered).toContain('type="button"');
    expect(rendered).toContain('type="submit"');
    expect(rendered).toContain("focus-visible");
    expect(rendered).toContain("Cancel");
    expect(rendered).toContain("Confirm Archive");
    expect(rendered.toLowerCase()).not.toContain("authorize");
    expect(rendered.toLowerCase()).not.toContain("permission");
  });
});
