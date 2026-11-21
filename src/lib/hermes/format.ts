import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

export const fmtGmt = (t: number | string | Date, pattern = "yyyy-MM-dd HH:mm"): string =>
  formatInTimeZone(new Date(t), "UTC", pattern) + (pattern.includes("HH") ? " GMT" : "");
export const fmtTime = (t: number | string | Date): string =>
  formatInTimeZone(new Date(t), "UTC", "HH:mm:ss");
export const fmtDate = (t: number | string | Date): string => format(new Date(t), "yyyy-MM-dd");
export const fmtNum = (v: number, dp = 2): string =>
  Number.isFinite(v)
    ? v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })
    : "—";
export const fmtPct = (v: number, dp = 2, sign = false): string =>
  Number.isFinite(v)
    ? `${sign && v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(dp)}%`
    : "—";
export const fmtUsd = (v: number, dp = 2, sign = false): string =>
  Number.isFinite(v)
    ? `${v < 0 ? "−" : sign && v > 0 ? "+" : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`
    : "—";
export const fmtHold = (sec: number): string => {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${String(m).padStart(2, "0")}m`;
};
export const signClass = (v: number): string =>
  v > 0 ? "text-pos" : v < 0 ? "text-neg" : "text-ink-1";

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]!);
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [keys.join(","), ...rows.map((r) => keys.map((k) => esc(r[k])).join(","))].join("\n");
}
export function downloadText(name: string, text: string, mime = "text/csv"): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
