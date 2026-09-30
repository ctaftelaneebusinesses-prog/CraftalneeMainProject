import type { ReactNode } from "react";
import { motion } from "motion/react";
import { BriefcaseBusiness, DoorOpen, FileText, Handshake, Receipt, Send } from "lucide-react";
import { cn } from "@/lib/format";
import { FileActions } from "@/components/ui/core";

export const DOC_STYLE = {
  offer: { icon: Send, cls: "from-brand-500/25 text-brand-300" },
  joining: { icon: BriefcaseBusiness, cls: "from-info/25 text-info" },
  relieving: { icon: DoorOpen, cls: "from-warn/25 text-warn" },
  payslip: { icon: Receipt, cls: "from-good/25 text-good" },
  mou: { icon: Handshake, cls: "from-flame-500/25 text-flame-400" },
  doc: { icon: FileText, cls: "from-white/15 text-fg-2" },
} as const;
export type DocKind = keyof typeof DOC_STYLE;

export function DocIcon({ kind, size = 40 }: { kind: DocKind; size?: number }) {
  const s = DOC_STYLE[kind];
  return (
    <span className={cn("grid place-items-center shrink-0 rounded-xl border border-white/[0.08] bg-gradient-to-br to-white/[0.02]", s.cls)} style={{ width: size, height: size }}>
      <s.icon className="size-[45%]" />
    </span>
  );
}

export function DocRow({ kind, title, sub, url, extra, badge, index = 0 }: { kind: DocKind; title: ReactNode; sub?: ReactNode; url: string; extra?: ReactNode; badge?: ReactNode; index?: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.03 }}
      className="group flex items-center gap-4 px-5 py-3.5 hover:bg-white/[0.025] transition-colors">
      <DocIcon kind={kind} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 font-medium text-fg truncate">{title}{badge}</div>
        {sub && <div className="text-[12.5px] text-fg-3 truncate">{sub}</div>}
      </div>
      <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
        {extra}
        <FileActions url={url} />
      </div>
    </motion.div>
  );
}
