import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";

export type Theme = "dark" | "light";
const Ctx = createContext<{ theme: Theme; toggle: (origin?: { x: number; y: number }) => void }>({ theme: "dark", toggle: () => {} });

function initial(): Theme {
  const attr = document.documentElement.dataset.theme;
  return attr === "light" ? "light" : "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(initial);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#07080c" : "#f4f5fa");
    try { localStorage.setItem("cl.theme", theme); } catch { /* private mode */ }
  }, [theme]);

  const toggle = useCallback((origin?: { x: number; y: number }) => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!doc.startViewTransition || reduced) { setTheme(next); return; }
    const x = origin?.x ?? window.innerWidth - 60;
    const y = origin?.y ?? 32;
    const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const t = doc.startViewTransition(() => { flushSync(() => setTheme(next)); document.documentElement.dataset.theme = next; });
    t.ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        { duration: 550, easing: "cubic-bezier(.2,.8,.2,1)", pseudoElement: "::view-transition-new(root)" },
      );
    }).catch(() => undefined);
  }, [theme]);

  return <Ctx.Provider value={{ theme, toggle }}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);
