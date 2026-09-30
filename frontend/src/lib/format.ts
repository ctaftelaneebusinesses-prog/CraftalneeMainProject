import { clsx, type ClassValue } from "clsx";

export const cn = (...v: ClassValue[]) => clsx(v);

const inrFmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
const inrCompact = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 });

/** ₹2,80,000 — Indian digit grouping. */
export function inr(value: number | null | undefined) {
  const n = Number(value || 0);
  return `${n < 0 ? "-" : ""}₹${inrFmt.format(Math.abs(n))}`;
}

/** ₹2.8L style for chart axes. */
export function inrShort(value: number) {
  const n = Math.abs(value);
  if (n >= 1e7) return `₹${(value / 1e7).toFixed(1).replace(/\.0$/, "")}Cr`;
  if (n >= 1e5) return `₹${(value / 1e5).toFixed(1).replace(/\.0$/, "")}L`;
  if (n >= 1e3) return `₹${(value / 1e3).toFixed(0)}K`;
  return `₹${inrCompact.format(value)}`;
}

export function fmtDate(value: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short", year: "numeric" }) {
  if (!value) return "—";
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-GB", opts);
}

export function fmtDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  return `${d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

export function monthLabel(month: string | null | undefined, short = false) {
  if (!month) return "";
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: short ? "short" : "long", year: "numeric" });
}

export function relative(value: string | null | undefined) {
  if (!value) return "";
  const diff = (Date.now() - new Date(value).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return fmtDate(value, { day: "2-digit", month: "short" });
}

export function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

const pad = (n: number) => String(n).padStart(2, "0");
/** Local (not UTC) dates — avoids off-by-one around midnight in IST. */
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const thisMonth = () => today().slice(0, 7);

export function capitalize(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
