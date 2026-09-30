import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { CalendarCheck, FileSignature, ListChecks, Megaphone, ReceiptText, Users, Wallet, type LucideIcon } from "lucide-react";

/**
 * Login-page showpiece: the CraftLanee mark with the product's modules orbiting it, and a
 * "live activity" feed of the kind of things the workspace does. Purely illustrative — no real data.
 */

interface Chip { icon: LucideIcon; label: string; angle: number; tint: string }
const INNER: Chip[] = [
  { icon: Users, label: "People", angle: 0, tint: "#9d84ff" },
  { icon: Wallet, label: "Payroll", angle: 120, tint: "#ff9466" },
  { icon: FileSignature, label: "Letters", angle: 240, tint: "#5eead4" },
];
const OUTER: Chip[] = [
  { icon: ReceiptText, label: "Invoices", angle: 60, tint: "#fbbf24" },
  { icon: ListChecks, label: "Tasks", angle: 180, tint: "#34d399" },
  { icon: Megaphone, label: "Announcements", angle: 300, tint: "#f472b6" },
];

function Ring({ size, chips, spin, reverse }: { size: number; chips: Chip[]; spin: string; reverse?: boolean }) {
  const r = size / 2;
  return (
    <div className={`cl-orbit-ring${reverse ? " rev" : ""}`} aria-hidden
      style={{ width: size, height: size, left: `calc(50% - ${r}px)`, top: `calc(50% - ${r}px)`, ["--spin" as string]: spin }}>
      <span className="cl-orbit-comet" />
      {chips.map((c) => {
        const rad = (c.angle * Math.PI) / 180;
        return (
          <div key={c.label} className="absolute" style={{ left: r + r * Math.sin(rad) - 19, top: r - r * Math.cos(rad) - 19 }}>
            <div className="cl-orbit-upright" style={{ ["--spin" as string]: spin }}>
              <span title={c.label} className="grid place-items-center size-[38px] rounded-xl border border-white/10 panel shadow-[0_8px_24px_-10px_rgba(0,0,0,0.45)]"
                style={{ color: c.tint, boxShadow: `0 0 0 1px ${c.tint}22, 0 10px 24px -12px ${c.tint}` }}>
                <c.icon className="size-[18px]" />
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const EVENTS: { icon: LucideIcon; tint: string; text: string }[] = [
  { icon: Wallet, tint: "#ff9466", text: "September payroll finalised" },
  { icon: ReceiptText, tint: "#fbbf24", text: "Invoice #0014 marked paid" },
  { icon: FileSignature, tint: "#5eead4", text: "Internship offer letter sent" },
  { icon: ListChecks, tint: "#34d399", text: "“Launch website” completed" },
  { icon: Megaphone, tint: "#f472b6", text: "Announcement sent to all" },
  { icon: CalendarCheck, tint: "#9d84ff", text: "Leave approved for Friday" },
];
const AGES = ["just now", "2 min ago", "6 min ago"];
const ROW = 56; // px per row slot (row height + gap)

function ActivityFeed() {
  const reduce = useReducedMotion();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const t = setInterval(() => setTick((n) => n + 1), 2800);
    return () => clearInterval(t);
  }, [reduce]);
  // Each event gets a fixed slot: 0-2 visible (newest on top), 3 = sliding out below. Rows only ever move
  // between slots, so they can't overlap; a new event enters above slot 0.
  const rows = [0, 1, 2, 3].map((slot) => {
    const n = tick - slot;
    return { slot, id: n, ...EVENTS[((n % EVENTS.length) + EVENTS.length) % EVENTS.length] };
  });
  return (
    <div className="w-[292px] glass glow-border p-4 bg-ink-850/80">
      <div className="flex items-center justify-between mb-3">
        <span className="eyebrow">Live activity</span>
        <span className="flex items-center gap-1.5 text-[11px] text-good">
          <span className="relative flex size-2"><span className="absolute inset-0 rounded-full bg-good opacity-60 animate-ping" /><span className="relative size-2 rounded-full bg-good" /></span>
          Synced
        </span>
      </div>
      <ul className="relative overflow-hidden" style={{ height: ROW * 3 - 8 }}>
        {rows.map((e) => (
          <motion.li key={e.id} initial={tick === 0 ? false : { y: -ROW, opacity: 0 }}
            animate={{ y: e.slot * ROW, opacity: e.slot < 3 ? 1 - e.slot * 0.22 : 0 }}
            transition={{ type: "spring", stiffness: 260, damping: 30 }}
            className="absolute inset-x-0 top-0 flex h-12 items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.025] px-3">
            <span className="grid place-items-center size-8 shrink-0 rounded-lg" style={{ color: e.tint, background: `${e.tint}1f` }}>
              <e.icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] font-medium text-fg">{e.text}</span>
              <span className="block text-[11px] text-fg-4">{AGES[Math.min(e.slot, 2)]}</span>
            </span>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}

export function LoginShowcase() {
  return (
    <div className="mt-12 flex items-center gap-8">
      <div className="relative size-[232px] shrink-0">
        {/* soft glow + the rings */}
        <div className="absolute inset-6 rounded-full blur-2xl opacity-70" style={{ background: "radial-gradient(closest-side, rgba(124,92,255,.45), transparent)" }} />
        <Ring size={228} chips={OUTER} spin="46s" reverse />
        <Ring size={144} chips={INNER} spin="30s" />
        {/* the mark, on a literal-white disc so its colours read in both themes */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 grid place-items-center size-[64px] rounded-full bg-[#fff]
          shadow-[0_14px_40px_-12px_rgba(124,92,255,0.65)] ring-1 ring-black/5">
          <img src="/brand/craftlanee-mark.png" alt="" className="size-[30px] object-contain" />
        </div>
      </div>
      <ActivityFeed />
    </div>
  );
}
