import { useCallback, useEffect, useRef, useState } from "react";
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Italic, List, ListOrdered, Redo2,
  RemoveFormatting, Underline, Undo2 } from "lucide-react";
import { cn } from "@/lib/format";

/**
 * Lightweight rich-text editor. Produces the small HTML subset the server sanitises and
 * renders into PDFs: <b>/<i>/<u>, <ul>/<ol>/<li>, text-align, <font face size>.
 */
const FONTS = [{ value: "sans", label: "Sans" }, { value: "serif", label: "Serif" }, { value: "mono", label: "Mono" }];
const SIZES = [{ value: "2", label: "Small" }, { value: "3", label: "Normal" }, { value: "4", label: "Large" }, { value: "5", label: "Heading" }];

type Cmd = "bold" | "italic" | "underline" | "insertUnorderedList" | "insertOrderedList" |
  "justifyLeft" | "justifyCenter" | "justifyRight" | "justifyFull";

export function RichTextEditor({ value, onChange, placeholder, minHeight = 180, className }: {
  value: string; onChange: (html: string) => void; placeholder?: string; minHeight?: number; className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<Record<string, boolean>>({});
  const [focused, setFocused] = useState(false);

  // Only push external value into the DOM when it really differs (keeps the caret stable while typing).
  useEffect(() => {
    const el = ref.current;
    if (el && el.innerHTML !== (value || "")) el.innerHTML = value || "";
  }, [value]);

  const emit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const html = el.innerHTML === "<br>" ? "" : el.innerHTML;
    onChange(html);
  }, [onChange]);

  const refresh = useCallback(() => {
    const cmds: Cmd[] = ["bold", "italic", "underline", "insertUnorderedList", "insertOrderedList", "justifyLeft", "justifyCenter", "justifyRight", "justifyFull"];
    const next: Record<string, boolean> = {};
    cmds.forEach((c) => { try { next[c] = document.queryCommandState(c); } catch { next[c] = false; } });
    setActive(next);
  }, []);

  useEffect(() => {
    const h = () => { if (document.activeElement === ref.current) refresh(); };
    document.addEventListener("selectionchange", h);
    return () => document.removeEventListener("selectionchange", h);
  }, [refresh]);

  const exec = (cmd: string, arg?: string) => {
    ref.current?.focus();
    document.execCommand("styleWithCSS", false, "false");
    document.execCommand(cmd, false, arg);
    emit();
    refresh();
  };

  const Btn = ({ cmd, icon: Icon, title }: { cmd: Cmd | "undo" | "redo" | "removeFormat"; icon: typeof Bold; title: string }) => (
    <button type="button" title={title} aria-label={title} onMouseDown={(e) => { e.preventDefault(); exec(cmd); }}
      className={cn("grid place-items-center size-8 rounded-lg transition-colors", active[cmd] ? "bg-brand-500/20 text-brand-300" : "text-fg-3 hover:text-fg hover:bg-white/[0.06]")}>
      <Icon className="size-4" />
    </button>
  );
  const Sep = () => <span className="w-px h-5 bg-white/10 mx-1" />;

  return (
    <div className={cn("rounded-2xl border transition-all overflow-hidden", focused ? "border-brand-400/70 shadow-[0_0_0_4px_rgba(124,92,255,0.14)]" : "border-white/[0.12]", className)}>
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-white/[0.08] bg-white/[0.025]">
        <select title="Font" className="h-8 rounded-lg bg-transparent text-[12.5px] text-fg-2 px-2 hover:bg-white/[0.06] outline-none cursor-pointer"
          onMouseDown={(e) => e.stopPropagation()} onChange={(e) => { exec("fontName", e.target.value); e.target.value = ""; }} defaultValue="">
          <option value="" disabled>Font</option>
          {FONTS.map((f) => <option key={f.value} value={f.value} className="bg-ink-800">{f.label}</option>)}
        </select>
        <select title="Size" className="h-8 rounded-lg bg-transparent text-[12.5px] text-fg-2 px-2 hover:bg-white/[0.06] outline-none cursor-pointer"
          onChange={(e) => { exec("fontSize", e.target.value); e.target.value = ""; }} defaultValue="">
          <option value="" disabled>Size</option>
          {SIZES.map((f) => <option key={f.value} value={f.value} className="bg-ink-800">{f.label}</option>)}
        </select>
        <Sep />
        <Btn cmd="bold" icon={Bold} title="Bold (Ctrl+B)" />
        <Btn cmd="italic" icon={Italic} title="Italic (Ctrl+I)" />
        <Btn cmd="underline" icon={Underline} title="Underline (Ctrl+U)" />
        <Sep />
        <Btn cmd="insertUnorderedList" icon={List} title="Bullet points" />
        <Btn cmd="insertOrderedList" icon={ListOrdered} title="Numbered points" />
        <Sep />
        <Btn cmd="justifyLeft" icon={AlignLeft} title="Align left" />
        <Btn cmd="justifyCenter" icon={AlignCenter} title="Align centre" />
        <Btn cmd="justifyRight" icon={AlignRight} title="Align right" />
        <Btn cmd="justifyFull" icon={AlignJustify} title="Justify" />
        <Sep />
        <Btn cmd="removeFormat" icon={RemoveFormatting} title="Clear formatting" />
        <span className="flex-1" />
        <Btn cmd="undo" icon={Undo2} title="Undo" />
        <Btn cmd="redo" icon={Redo2} title="Redo" />
      </div>
      <div
        ref={ref}
        className="rte px-4 py-3.5 overflow-y-auto bg-white/[0.02]"
        style={{ minHeight, maxHeight: 520 }}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        data-placeholder={placeholder}
        onInput={emit}
        onFocus={() => { setFocused(true); refresh(); }}
        onBlur={() => { setFocused(false); emit(); }}
        onKeyUp={refresh}
        onPaste={(e) => {
          // Paste as clean text — formatting comes from the toolbar, not from Word/web pages.
          e.preventDefault();
          const text = e.clipboardData.getData("text/plain");
          document.execCommand("insertText", false, text);
        }}
      />
    </div>
  );
}
