import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ConfirmDialog } from "../../../src/components/confirmation-dialog";
import { LiveRegion } from "../../../src/components/status-primitives";
import { TableState } from "../../../src/components/table-state";

type ControlProps = Readonly<{
  children?: ReactNode;
  onCancel?: (event: { preventDefault: () => void }) => void;
  onClick?: (event: { preventDefault: () => void }) => void;
  onSubmit?: (event: { preventDefault: () => void }) => void;
  type?: string;
}>;

function nodesOfType(node: ReactNode, type: string): ReactElement<ControlProps>[] {
  if (!node || typeof node !== "object" || !("props" in node)) return [];

  const element = node as ReactElement<ControlProps>;
  const descendants = Array.isArray(element.props.children) ? element.props.children : [element.props.children];
  return [element, ...descendants.flatMap((child) => nodesOfType(child, type))].filter((item) => item.type === type);
}

describe("dialog and state contracts", () => {
  it("routes rendered cancel, confirm, Escape, and Enter interactions to exactly one matching callback", () => {
    let confirmed = 0;
    let cancelled = 0;
    const dialog = ConfirmDialog({
      confirmLabel: "Archive movie",
      consequence: "The movie will be unavailable publicly.",
      onCancel: () => { cancelled += 1; },
      onConfirm: () => { confirmed += 1; },
      open: true,
      targetName: "Arrival",
      title: "Confirm archive",
    });

    const form = nodesOfType(dialog, "form")[0];
    const buttons = nodesOfType(dialog, "button");
    const cancel = buttons.find((button) => button.props.children === "Cancel");
    const confirm = buttons.find((button) => button.props.children === "Archive movie");
    const dialogElement = nodesOfType(dialog, "dialog")[0];
    const event = { preventDefault: () => undefined };

    expect(cancel?.props.type).toBe("button");
    cancel?.props.onClick?.(event);
    expect(cancelled).toBe(1);
    expect(confirmed).toBe(0);

    confirm?.props.onClick?.(event);
    form.props.onSubmit?.(event);
    expect(confirmed).toBe(1);
    expect(cancelled).toBe(1);

    dialogElement.props.onCancel?.(event);
    expect(cancelled).toBe(2);
    form.props.onSubmit?.(event);
    expect(confirmed).toBe(2);
  });

  it("uses the K12 LiveRegion message contract and all required table state labels", () => {
    const announcement = renderToStaticMarkup(createElement(LiveRegion, { message: "Review submitted" }));

    expect(announcement).toContain("Review submitted");
    expect(announcement).toContain('aria-live="polite"');
    expect(announcement).toContain('role="status"');

    for (const [state, label] of [["loading", "Loading"], ["empty", "Empty"], ["error", "Error"], ["stale", "Stale"], ["success", "Success"]] as const) {
      const rendered = renderToStaticMarkup(createElement(TableState, { state }));

      expect(rendered).toContain(`data-state="${state}"`);
      expect(rendered).toContain(label);
      expect(rendered).toMatch(/role="(status|alert)"/);
    }
  });
});
