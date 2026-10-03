import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { Bell, BellOff, BellRing, PhoneCall } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/format";
import { DUE_TONE, dueText, fmtTime } from "@/lib/followups";
import type { Lead } from "@/lib/types";

type Feed = { due: Lead[]; later_today: Lead[] };

const SEEN_KEY = "craftlanee.reminders.seen";      // popped up already
const VIEWED_KEY = "craftlanee.reminders.viewed";  // looked at in the bell → no longer counted on the badge
const POPUP_WINDOW = 12 * 3600_000;  // don't pop up reminders older than this (the bell still lists them)
200
function loadSeen(key = SEEN_KEY): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(key) || "[]")); } catch { return new Set(); }
}
function saveSeen(seen: Set<string>, key = SEEN_KEY) {
  try { localStorage.setItem(key, JSON.stringify([...seen].slice(-300))); } catch { /* private mode */ }
}
/** One key per reminder: a new date or time for the same lead counts as a new reminder. */
const reminderKey = (l: Lead) => `${l.id}@${l.remind_at}`;

export type PopupState = "on" | "off" | "blocked" | "unsupported";
export function popupState(): PopupState {
  if (typeof Notification === "undefined" || !window.isSecureContext) return "unsupported";
  return Notification.permission === "granted" ? "on" : Notification.permission === "denied" ? "blocked" : "off";
}
export async function enablePopups() {
  if (popupState() !== "off") return popupState();
  await Notification.requestPermission();
  const state = popupState();
  if (state === "on") new Notification("Desktop reminders are on", { body: "You'll get a pop-up when a client follow-up is due.", icon: "/favicon.png" });
  return state;
}

/** Polls due follow-ups every minute; each one pops up (desktop notification + toast) once per date/time. */
function useReminderFeed() {
  const navigate = useNavigate();
  const seen = useRef(loadSeen());
  const query = useQuery({
    queryKey: ["followup-reminders"],
    queryFn: () => api.get<Feed>("/followups/reminders"),
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
    staleTime: 30_000,
  });

  useEffect(() => {
    const due = query.data?.due ?? [];
    let changed = false;
    for (const l of due) {
      const key = reminderKey(l);
      if (seen.current.has(key)) continue;
      seen.current.add(key);
      changed = true;
      if (!l.remind_at || Date.now() - new Date(l.remind_at).getTime() > POPUP_WINDOW) continue;
      const open = () => { window.focus(); navigate(`/followups?open=${l.id}`); };
      const body = [l.contact_person, l.phone, l.last_activity && `Last: ${l.last_activity.body}`].filter(Boolean).join(" · ").slice(0, 180);
      if (popupState() === "on") {
        const n = new Notification(`Follow up with ${l.name}`, { body: body || dueText(l), tag: `lead-${l.id}`, icon: "/favicon.png", requireInteraction: true });
        n.onclick = () => { open(); n.close(); };
      }
      toast(`Follow up with ${l.name}`, { description: body || dueText(l), icon: <PhoneCall className="size-4" />, duration: 15_000, action: { label: "Open", onClick: open } });
    }
    if (changed) saveSeen(seen.current);
  }, [query.data, navigate]);

  return query.data;
}

export function ReminderBell() {
  const feed = useReminderFeed();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [popups, setPopups] = useState<PopupState>(popupState);
  const [viewed, setViewed] = useState(() => loadSeen(VIEWED_KEY));
  const box = useRef<HTMLDivElement>(null);
  const due = feed?.due ?? [];
  const later = feed?.later_today ?? [];
  const unseen = due.filter((l) => !viewed.has(reminderKey(l))).length;

  // Opening the bell marks everything due right now as seen; the badge only counts reminders that came due since.
  const markViewed = () => {
    if (!unseen) return;
    const next = new Set(viewed);
    due.forEach((l) => next.add(reminderKey(l)));
    saveSeen(next, VIEWED_KEY);
    setViewed(next);
  };

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const go = (l: Lead) => { setOpen(false); navigate(`/followups?open=${l.id}`); };
  const row = (l: Lead, isDue: boolean) => (
    <button key={l.id} onClick={() => go(l)} className="w-full text-left rounded-xl px-3 py-2.5 hover:bg-white/[0.05] transition-colors">
      <div className="flex items-center gap-2">
        <span className={cn("size-1.5 rounded-full shrink-0", isDue ? (l.due === "overdue" ? "bg-bad" : "bg-warn") : "bg-brand-300")} />
        <span className="font-medium text-[13.5px] truncate flex-1">{l.name}</span>
        <span className={cn("text-[12px] whitespace-nowrap", isDue ? DUE_TONE[l.due] : "text-fg-3")}>{isDue ? dueText(l) : fmtTime(l.next_followup_time ?? "09:00")}</span>
      </div>
      {(l.contact_person || l.phone) && <div className="pl-3.5 text-[12px] text-fg-4 truncate">{[l.contact_person, l.phone].filter(Boolean).join(" · ")}</div>}
    </button>
  );

  return (
    <div ref={box} className="relative">
      <button onClick={() => { setOpen((o) => !o); setPopups(popupState()); markViewed(); }} className="btn btn-ghost btn-icon relative" aria-label={`Follow-up reminders${unseen ? `, ${unseen} new` : ""}`} title="Follow-up reminders">
        {unseen ? <BellRing className="text-warn" /> : <Bell />}
        {unseen > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 grid place-items-center rounded-full text-[10.5px] font-bold text-on-accent" style={{ background: "var(--grad)" }}>{unseen}</span>}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            className="absolute right-0 top-full mt-2 w-[min(360px,calc(100vw-32px))] glass panel p-2 z-40">
            <div className="flex items-center justify-between px-3 pt-1.5 pb-2">
              <span className="font-display font-semibold text-[14px]">Follow-up reminders</span>
              <button onClick={() => { setOpen(false); navigate("/followups"); }} className="text-[12px] text-fg-3 hover:text-fg">View all</button>
            </div>
            <div className="max-h-[360px] overflow-y-auto">
              {due.length > 0 && <div className="eyebrow px-3 pt-1 pb-1">Due now</div>}
              {due.map((l) => row(l, true))}
              {later.length > 0 && <div className="eyebrow px-3 pt-3 pb-1">Later today</div>}
              {later.map((l) => row(l, false))}
              {!due.length && !later.length && <p className="px-3 py-6 text-center text-[13px] text-fg-4">Nothing due. You're all caught up.</p>}
            </div>
            <div className="mt-1 border-t divider px-3 pt-2.5 pb-1.5 text-[12px]">
              {popups === "on" && <span className="flex items-center gap-1.5 text-fg-3"><BellRing className="size-3.5 text-good" />Desktop pop-ups are on</span>}
              {popups === "off" && <button onClick={async () => setPopups(await enablePopups())} className="flex items-center gap-1.5 text-brand-300 hover:underline"><BellRing className="size-3.5" />Turn on desktop pop-ups</button>}
              {popups === "blocked" && <span className="flex items-center gap-1.5 text-fg-3"><BellOff className="size-3.5 text-bad" />Pop-ups are blocked. Allow notifications for this site in the browser's address bar.</span>}
              {popups === "unsupported" && <span className="flex items-center gap-1.5 text-fg-3"><BellOff className="size-3.5" />Desktop pop-ups need the app opened on localhost or https. In-app alerts still work.</span>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
