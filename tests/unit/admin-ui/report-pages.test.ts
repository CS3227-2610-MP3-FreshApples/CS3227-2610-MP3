import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReportDetail } from "../../../src/app/admin/reports/_components/report-detail";
import { ReportList } from "../../../src/app/admin/reports/_components/report-list";

describe("A-05 Admin report presentation", () => {
  it("keeps the report queue reset, live loading status, and private-detail boundary visible", () => {
    const list = renderToStaticMarkup(createElement(ReportList, { page: 1, status: "open", category: "all" }));
    const detail = renderToStaticMarkup(createElement(ReportDetail, { reportId: "report-1" }));
    expect(list).toContain('href="/admin/reports"');
    expect(list).toContain("Loading reports…");
    expect(detail).toContain("Loading report…");
    expect(detail).toContain("Admin-only report evidence");
  });
});
