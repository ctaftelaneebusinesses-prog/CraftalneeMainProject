import { fmtDate, today } from "./format";
import type { Lead, LeadDue } from "./types";

function daysFromToday(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const [ty, tm, td] = today().split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86400000);
}

/** "14:30" -> "2:30 PM". */
export function fmtTime(hhmm: string | null | undefined) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** "3 days overdue", "Today, 2:30 PM", "Tomorrow", "In 5 days", "12 Oct". */
export function dueText(lead: Pick<Lead, "next_followup" | "next_followup_time" | "due">) {
  if (lead.due === "closed") return "Closed";
  if (!lead.next_followup) return "No date set";
  const n = daysFromToday(lead.next_followup);
  if (n < 0) return `${-n} day${n === -1 ? "" : "s"} overdue`;
  const at = lead.next_followup_time ? `, ${fmtTime(lead.next_followup_time)}` : "";
  if (n === 0) return `Today${at}`;
  if (n === 1) return `Tomorrow${at}`;
  return n <= 14 ? `In ${n} days` : fmtDate(lead.next_followup, { day: "2-digit", month: "short" });
}

/** Text colour for a lead's due state. */
export const DUE_TONE: Record<LeadDue, string> = { overdue: "text-bad", today: "text-warn", upcoming: "text-fg-2", none: "text-fg-4", closed: "text-fg-4" };
