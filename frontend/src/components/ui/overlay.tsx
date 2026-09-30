import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, FileUp, X } from "lucide-react";
import { cn } from "@/lib/format";
import { Button, Input } from "./core";

/* ------------------------------------------------------------ Modal (centered) */

export function Modal({ open, onClose, title, subtitle, children, footer, width = 520 }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEscape(open, onClose);
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[80] grid place-items-center p-4">
          <motion.div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.div role="dialog" aria-modal="true"
            className="relative w-full glass glow-border bg-ink-850/95 max-h-[calc(100vh-32px)] flex flex-col"
            style={{ maxWidth: width }}
            initial={{ opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}>
            <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b divider">
              <div>
                <h2 className="font-display text-[17px] font-semibold">{title}</h2>
                {subtitle && <p className="text-[13px] text-fg-3 mt-1">{subtitle}</p>}
              </div>
              <button onClick={onClose} className="p-1.5 -mr-1.5 rounded-lg text-fg-3 hover:text-fg hover:bg-white/5" aria-label="Close"><X className="size-4" /></button>
            </div>
            <div className="px-6 py-5 overflow-y-auto">{children}</div>
            {footer && <div className="flex justify-end gap-2 px-6 py-4 border-t divider bg-white/[0.015] rounded-b-[20px]">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/* ------------------------------------------------------------ Drawer (right side panel) */

export function Drawer({ open, onClose, title, subtitle, children, footer, width = 560 }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEscape(open, onClose);
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[70]">
          <motion.div className="absolute inset-0 bg-black/55 backdrop-blur-[3px]" onClick={onClose}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.aside role="dialog" aria-modal="true"
            className="absolute right-0 top-0 bottom-0 w-full flex flex-col bg-ink-900/95 backdrop-blur-xl border-l border-white/[0.08] shadow-2xl"
            style={{ maxWidth: width }}
            initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 40 }}>
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-400/60 to-transparent" />
            <div className="flex items-start justify-between gap-4 px-7 pt-6 pb-5 border-b divider">
              <div>
                <h2 className="font-display text-[19px] font-semibold">{title}</h2>
                {subtitle && <p className="text-[13px] text-fg-3 mt-1">{subtitle}</p>}
              </div>
              <button onClick={onClose} className="p-1.5 -mr-1.5 rounded-lg text-fg-3 hover:text-fg hover:bg-white/5" aria-label="Close"><X className="size-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-7 py-6">{children}</div>
            {footer && <div className="flex justify-end gap-2 px-7 py-4 border-t divider bg-white/[0.015]">{footer}</div>}
          </motion.aside>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", h); document.body.style.overflow = prev; };
  }, [open, onClose]);
}

/* ------------------------------------------------------------ Confirm dialog (promise based) */

interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmText?: string;
  danger?: boolean;
  requireText?: string; // user must type this exactly
}
type ConfirmFn = (o: ConfirmOptions) => Promise<string | false>;
const ConfirmCtx = createContext<ConfirmFn>(async () => false);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (v: string | false) => void }) | null>(null);
  const [typed, setTyped] = useState("");
  const confirm = useCallback<ConfirmFn>((o) => new Promise((resolve) => { setTyped(""); setState({ ...o, resolve }); }), []);
  const close = (v: string | false) => { state?.resolve(v); setState(null); };
  const blocked = !!state?.requireText && typed.trim().toUpperCase() !== state.requireText.toUpperCase();
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Modal open={!!state} onClose={() => close(false)} width={440}
        title={<span className="flex items-center gap-2.5">{state?.danger && <span className="grid place-items-center size-8 rounded-lg bg-bad/10 text-bad"><AlertTriangle className="size-4" /></span>}{state?.title}</span>}
        footer={<>
          <Button variant="ghost" onClick={() => close(false)}>Cancel</Button>
          <Button variant={state?.danger ? "danger" : "primary"} disabled={blocked} onClick={() => close(typed || "yes")}>{state?.confirmText ?? "Confirm"}</Button>
        </>}>
        {state?.message && <div className="text-fg-2 text-[14px] leading-relaxed">{state.message}</div>}
        {state?.requireText && (
          <div className="mt-4">
            <label className="field-label">Type <span className="font-mono text-fg">{state.requireText}</span> to confirm</label>
            <Input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} />
          </div>
        )}
      </Modal>
    </ConfirmCtx.Provider>
  );
}
export const useConfirm = () => useContext(ConfirmCtx);

/* ------------------------------------------------------------ File drop zone */

export function FileDrop({ file, onFile, accept, label = "Drop a file or click to browse", hint, preview, className }: { file: File | null; onFile: (f: File | null) => void; accept?: string; label?: string; hint?: string; preview?: string | null; className?: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (file && file.type.startsWith("image/")) { const u = URL.createObjectURL(file); setUrl(u); return () => URL.revokeObjectURL(u); }
    setUrl(null);
  }, [file]);
  const img = url ?? preview ?? null;
  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
      className={cn("group relative flex items-center gap-4 rounded-2xl border border-dashed px-4 py-4 cursor-pointer transition-all",
        over ? "border-brand-400 bg-brand-500/10" : "border-white/12 bg-white/[0.02] hover:border-white/25 hover:bg-white/[0.035]", className)}>
      <input ref={inputRef} type="file" accept={accept} className="hidden" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      {img ? (
        <img src={img} alt="" className="size-14 rounded-xl object-contain bg-[#fff]/90 p-1 shrink-0" />
      ) : (
        <span className="grid place-items-center size-12 rounded-xl bg-white/[0.05] text-fg-3 group-hover:text-brand-300 transition-colors shrink-0"><FileUp className="size-5" /></span>
      )}
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-medium text-fg truncate">{file ? file.name : label}</div>
        <div className="text-[12px] text-fg-3">{file ? `${(file.size / 1024).toFixed(0)} KB · click to change` : hint}</div>
      </div>
      {file && <button type="button" onClick={(e) => { e.stopPropagation(); onFile(null); if (inputRef.current) inputRef.current.value = ""; }} className="p-1.5 rounded-lg text-fg-3 hover:text-fg hover:bg-white/5"><X className="size-4" /></button>}
    </div>
  );
}
