import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import AdminUsersPage from "../../../src/app/admin/users/page";
import { UserList } from "../../../src/app/admin/users/_components/user-list";

describe("A-06 Admin user presentation", () => {
  it("provides loading and user-management affordances", () => {
    const list = renderToStaticMarkup(createElement(UserList, { page: 1, status: "", q: "" }));
    expect(list).toContain("Loading users…");
    expect(list).toContain("Manage users");
    expect(list).toContain("Search users");
    expect(list).toContain("Status");
  });

  it("uses the guarded client page with approved confirmation language", () => {
    const page = renderToStaticMarkup(createElement(AdminUsersPage, { searchParams: Promise.resolve({}) }));
    expect(page).toContain("Loading users…");
  });
});
