import type { ReactNode } from "react";

type DataTableColumn<R> = Readonly<{
  cell: (row: R) => ReactNode;
  header: string;
}>;

type DataTableProps<R> = Readonly<{
  caption: string;
  columns: readonly DataTableColumn<R>[];
  emptyMessage: string;
  rowKey: (row: R) => string;
  rows: readonly R[];
}>;

export function DataTable<R>({ caption, columns, emptyMessage, rowKey, rows }: DataTableProps<R>) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm" data-table-shell="admin">
      <table className="min-w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-[0.12em] text-slate-600">
          <tr>{columns.map((column) => <th className="whitespace-nowrap px-4 py-3 font-semibold" key={column.header} scope="col">{column.header}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length === 0 ? (
            <tr><td className="px-4 py-8 text-center text-slate-600" colSpan={Math.max(columns.length, 1)} role="status">{emptyMessage}</td></tr>
          ) : rows.map((row) => {
            const key = rowKey(row);
            return <tr className="transition-colors hover:bg-slate-50" data-row-key={key} key={key}>{columns.map((column) => <td className="px-4 py-4 align-middle text-slate-700" key={column.header}>{column.cell(row)}</td>)}</tr>;
          })}
        </tbody>
      </table>
    </div>
  );
}

type TableStateName = "empty" | "error" | "loading" | "stale" | "success";

type TableStateProps = Readonly<{
  state: TableStateName;
}>;

const stateDetails: Record<TableStateName, Readonly<{ label: string; role: "alert" | "status" }>> = {
  empty: { label: "Empty", role: "status" },
  error: { label: "Error", role: "alert" },
  loading: { label: "Loading", role: "status" },
  stale: { label: "Stale — refresh required", role: "status" },
  success: { label: "Success — current", role: "status" },
};

export function TableState({ state }: TableStateProps) {
  const detail = stateDetails[state];

  return (
    <table>
      <tbody>
        <tr>
          <td colSpan={1} data-state={state} role={detail.role}>
            {detail.label}
          </td>
        </tr>
      </tbody>
    </table>
  );
}
