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
    <table>
      <caption>{caption}</caption>
      <thead>
        <tr>{columns.map((column) => <th key={column.header} scope="col">{column.header}</th>)}</tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr><td colSpan={Math.max(columns.length, 1)} role="status">{emptyMessage}</td></tr>
        ) : rows.map((row) => {
          const key = rowKey(row);
          return <tr data-row-key={key} key={key}>{columns.map((column) => <td key={column.header}>{column.cell(row)}</td>)}</tr>;
        })}
      </tbody>
    </table>
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
