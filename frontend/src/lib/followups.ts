import { fmtDate, today } from "./format";
import type { Lead, LeadDue } from "./types";

function daysFromToday(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const [ty, tm, td] = today().split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86400000);
}

/** "3 days overdue", "Today", "Tomorrow", "In 5 days", "12 Oct". */
export function dueText(lead: Pick<Lead, "next_followup" | "due">) {
  if (lead.due === "closed") return "Closed";
  if (!lead.next_followup) return "No date set";
  const n = daysFromToday(lead.next_followup);
  if (n < 0) return `${-n} day${n === -1 ? "" : "s"} overdue`;
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  return n <= 14 ? `In ${n} days` : fmtDate(lead.next_followup, { day: "2-digit", month: "short" });
}

/** Text colour for a lead's due state. */
export const DUE_TONE: Record<LeadDue, string> = { overdue: "text-bad", today: "text-warn", upcoming: "text-fg-2", none: "text-fg-4", closed: "text-fg-4" };
