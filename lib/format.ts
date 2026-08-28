export const money = (value: number | string | null | undefined) =>
  new Intl.NumberFormat("en-GH", { style: "currency", currency: "GHS", minimumFractionDigits: 2 }).format(Number(value || 0));

export const date = (value: string | Date | null | undefined) => value
  ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: value instanceof Date || String(value).includes("T") ? "short" : undefined }).format(new Date(value))
  : "—";
