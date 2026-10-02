import { useMemo } from "react";

export function ReportColumn({ row, expression }: { row: Record<string, unknown>; expression: string }) {
  const compute = useMemo(() => new Function("row", `return (${expression});`), [expression]);
  let value: unknown;
  try {
    value = compute(row);
  } catch {
    value = "n/a";
  }
  return <td>{String(value)}</td>;
}
