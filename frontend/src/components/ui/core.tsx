import { forwardRef, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes,
  type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Link } from "react-router-dom";
import { animate, motion, useInView } from "motion/react";
import { ArrowLeft, Download, Eye, Loader2, Search, X } from "lucide-react";
import { cn, inr } from "@/lib/format";
import type { EmployeeBrief } from "@/lib/types";

/* ------------------------------------------------------------ Button */

type BtnVariant = "default" | "primary" | "ghost" | "danger";
type BtnSize = "md" | "sm" | "xs";

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: BtnSize;
  icon?: ReactNode;
  iconOnly?: boolean;
  loading?: boolean;
  to?: string;
  href?: string;
  download?: boolean;
}

export function Button({ variant = "default", size = "md", icon, iconOnly, loading, to, href, download,
  className, children, disabled, ...rest }: BtnProps) {
  const cls = cn("btn", variant !== "default" && `btn-${variant}`, size !== "md" && `btn-${size}`,
    iconOnly && "btn-icon", className);
  const inner = (<>{loading ? <Loader2 className="animate-spin" /> : icon}{!iconOnly && children}</>);
  if (to) return <Link to={to} className={cls} title={rest.title}>{inner}</Link>;
  if (href) return <a href={href} className={cls} title={rest.title} target={download ? undefined : "_blank"} rel="noopener" download={download || undefined}>{inner}</a>;
  return <button className={cls} disabled={disabled || loading} type={rest.type ?? "button"} {...rest}>{inner}</button>;
}

/* ------------------------------------------------------------ Card */

export function Card({ className, children, glow, hover, ...rest }: { className?: string; children: ReactNode; glow?: boolean; hover?: boolean } & React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("glass", glow && "glow-border", hover && "glass-hover", className)} {...rest}>{children}</div>;
}

export function CardHeader({ title, subtitle, action, icon }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-6 pt-5 pb-4">
      <div className="flex items-center gap-3 min-w-0">
        {icon && <span className="grid place-items-center size-9 rounded-xl bg-white/[0.05] border border-white/[0.07] text-brand-300 [&>svg]:size-[18px]">{icon}</span>}
        <div className="min-w-0">
          <h3 className="font-display text-[15px] font-semibold text-fg truncate">{title}</h3>
          {subtitle && <p className="text-[12.5px] text-fg-3 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

/* ------------------------------------------------------------ Form fields */

export function Field({ label, hint, error, children, className, optional }: { label?: ReactNode; hint?: ReactNode; error?: string; children: ReactNode; className?: string; optional?: boolean }) {
  return (
    <div className={className}>
      {label && <label className="field-label">{label}{optional && <span className="text-fg-4 font-normal"> · optional</span>}</label>}
      {children}
      {error ? <p className="text-[12px] text-bad mt-1.5">{error}</p> : hint ? <p className="text-[12px] text-fg-3 mt-1.5">{hint}</p> : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...p }, ref) => <input ref={ref} className={cn("input", className)} {...p} />);
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...p }, ref) => <textarea ref={ref} className={cn("input", className)} {...p} />);
Textarea.displayName = "Textarea";

export function Select({ options, className, placeholder, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { options: (string | { value: string; label: string })[]; placeholder?: string }) {
  return (
    <select className={cn("input", className)} {...p}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => typeof o === "string"
        ? <option key={o} value={o}>{o}</option>
        : <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function MoneyInput({ value, onChange, className, ...p }: Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> & { value: number | string; onChange: (v: string) => void }) {
  return (
    <div className="relative">
      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-fg-3 pointer-events-none">₹</span>
      <input className={cn("input tnum pl-8", className)} inputMode="decimal" value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))} {...p} />
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = "Search…", className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  return (
    <div className={cn("relative", className)}>
      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-fg-4 pointer-events-none" />
      <input className="input input-sm pl-10 pr-9 h-[38px]" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      {value && <button className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-fg-4 hover:text-fg" onClick={() => onChange("")} aria-label="Clear"><X className="size-3.5" /></button>}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode }) {
  const id = useId();
  return (
    <label htmlFor={id} className="inline-flex items-center gap-3 cursor-pointer select-none text-[13.5px] text-fg-2">
      <button id={id} type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={cn("relative h-[22px] w-[40px] rounded-full transition-colors border", checked ? "bg-brand-500 border-brand-400" : "bg-white/[0.06] border-white/10")}>
        <motion.span layout transition={{ type: "spring", stiffness: 600, damping: 35 }}
          className={cn("absolute top-[2px] size-4 rounded-full bg-white shadow", checked ? "right-[2px]" : "left-[2px]")} />
      </button>
      {label}
    </label>
  );
}

/* ------------------------------------------------------------ Badges & avatars */

export type Tone = "neutral" | "good" | "warn" | "bad" | "info" | "brand";
export function Badge({ tone = "neutral", dot, children, className }: { tone?: Tone; dot?: boolean; children: ReactNode; className?: string }) {
  return <span className={cn("badge", tone !== "neutral" && `badge-${tone}`, className)}>{dot && <span className="dot" />}{children}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  return status === "active" ? <Badge tone="good" dot>Active</Badge> : <Badge dot>Inactive</Badge>;
}

const AVATAR_GRADS = [
  "from-[#7c5cff] to-[#ff7a45]", "from-[#22d3ee] to-[#7c5cff]", "from-[#f472b6] to-[#fb923c]",
  "from-[#34d399] to-[#22d3ee]", "from-[#fbbf24] to-[#f472b6]", "from-[#60a5fa] to-[#a78bfa]",
];

export function Avatar({ person, size = 40, ring }: { person: Pick<EmployeeBrief, "photo_url" | "initials" | "id"> | { photo_url?: string | null; initials: string; id?: number }; size?: number; ring?: boolean }) {
  const grad = AVATAR_GRADS[(person.id ?? person.initials.charCodeAt(0)) % AVATAR_GRADS.length];
  return (
    <span className={cn("relative inline-grid place-items-center rounded-full shrink-0 overflow-hidden font-display font-semibold text-on-accent bg-gradient-to-br", grad,
      ring && "ring-2 ring-white/10 ring-offset-2 ring-offset-ink-900")}
      style={{ width: size, height: size, fontSize: Math.max(11, size * 0.36) }}>
      {person.photo_url ? <img src={person.photo_url} alt="" className="absolute inset-0 size-full object-cover" /> : person.initials}
    </span>
  );
}

export function Person({ e, sub, to, size = 38 }: { e: EmployeeBrief; sub?: ReactNode; to?: string; size?: number }) {
  const name = to ? <Link to={to} className="font-medium text-fg hover:text-brand-300 transition-colors truncate">{e.full_name}</Link>
    : <span className="font-medium text-fg truncate">{e.full_name}</span>;
  return (
    <div className="flex items-center gap-3 min-w-0">
      <Avatar person={e} size={size} />
      <div className="min-w-0 flex flex-col">{name}<span className="text-[12.5px] text-fg-3 truncate">{sub ?? e.designation ?? "—"}</span></div>
    </div>
  );
}

/* ------------------------------------------------------------ Page layout */

export function PageHeader({ eyebrow, title, subtitle, actions, back }: { eyebrow?: ReactNode; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { to: string; label: string } }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-7">
      <div className="min-w-0">
        {back && (
          <Link to={back.to} className="inline-flex items-center gap-1.5 text-[12.5px] text-fg-3 hover:text-fg mb-3 transition-colors">
            <ArrowLeft className="size-3.5" /> {back.label}
          </Link>
        )}
        {eyebrow && <div className="eyebrow mb-2">{eyebrow}</div>}
        <h1 className="font-display text-[28px] leading-tight font-bold text-fg">{title}</h1>
        {subtitle && <p className="text-fg-3 mt-1.5 text-[14px]">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      <div className="relative mb-5">
        <div className="absolute inset-0 blur-2xl bg-brand-500/30 rounded-full" />
        <div className="relative grid place-items-center size-14 rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.08] to-white/[0.02] text-brand-300 [&>svg]:size-6">{icon}</div>
      </div>
      <h3 className="font-display text-[16px] font-semibold">{title}</h3>
      {text && <p className="text-fg-3 text-[13.5px] mt-1.5 max-w-sm">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} />;
}

export function PageSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-9 w-64" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}</div>
      <Skeleton className="h-80 rounded-2xl" />
    </div>
  );
}

/* ------------------------------------------------------------ Segmented control */

export function Segmented<T extends string>({ value, onChange, options, layoutId }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; count?: number }[]; layoutId: string }) {
  return (
    <div className="inline-flex p-1 rounded-xl bg-white/[0.035] border border-white/[0.07] gap-0.5 overflow-x-auto max-w-full">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={cn("relative px-3.5 h-[30px] rounded-[9px] text-[13px] font-medium transition-colors whitespace-nowrap", value === o.value ? "text-fg" : "text-fg-3 hover:text-fg")}>
          {value === o.value && <motion.span layoutId={layoutId} className="absolute inset-0 rounded-[9px] bg-white/[0.09] border border-white/[0.1] shadow-[0_4px_14px_-4px_rgba(0,0,0,0.6)]" transition={{ type: "spring", stiffness: 500, damping: 38 }} />}
          <span className="relative flex items-center gap-1.5">{o.label}{o.count !== undefined && <span className="text-[11px] text-fg-4">{o.count}</span>}</span>
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ Animated numbers */

export function AnimatedNumber({ value, money = true, className }: { value: number; money?: boolean; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const prev = useRef(0);
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    if (!inView) return;
    const controls = animate(prev.current, value, {
      duration: 1.1, ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setDisplay(v),
    });
    prev.current = value;
    return () => controls.stop();
  }, [value, inView]);
  return <span ref={ref} className={cn("tnum", className)}>{money ? inr(Math.round(display)) : Math.round(display).toLocaleString("en-IN")}</span>;
}

/* ------------------------------------------------------------ File actions */

export function FileActions({ url, size = "sm" }: { url: string; size?: BtnSize }) {
  const dl = url + (url.includes("?") ? "&" : "?") + "dl=1";
  return (
    <div className="flex items-center gap-1">
      <Button size={size} variant="ghost" iconOnly icon={<Eye />} href={url} title="Preview" />
      <Button size={size} variant="ghost" iconOnly icon={<Download />} href={dl} download title="Download" />
    </div>
  );
}

/* ------------------------------------------------------------ Motion helpers */

export const fadeUp = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] as const },
};

export function Stagger({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} initial="hidden" animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.055 } } }}>
      {children}
    </motion.div>
  );
}
export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} variants={{ hidden: { opacity: 0, y: 16, filter: "blur(4px)" }, show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] } } }}>
      {children}
    </motion.div>
  );
}
