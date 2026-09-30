import { Suspense, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { ChevronsUpDown, KeyRound, LogOut, Menu, Moon, Search, ShieldCheck, Sun, X } from "lucide-react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/format";
import type { NavCounts } from "@/lib/types";
import { Avatar, PageSkeleton } from "@/components/ui/core";
import { CommandPalette } from "./CommandPalette";
import { navFor, type NavGroup } from "./nav";

export function Ambient() {
  return <div className="ambient" aria-hidden><div className="orb a" /><div className="orb b" /><div className="orb c" /></div>;
}

export function BrandMark({ logo, size = 36 }: { logo?: string | null; size?: number }) {
  if (logo) return <img src={logo} alt="" style={{ width: size, height: size }} className="rounded-xl object-contain bg-[#fff] p-1 shadow-sm" />;
  return (
    <span className="relative grid place-items-center rounded-xl shadow-[0_8px_24px_-6px_rgba(124,92,255,0.7)]" style={{ width: size, height: size, background: "var(--grad)" }}>
      <svg viewBox="0 0 64 64" className="size-[62%]"><path d="M40 22.5a13 13 0 1 0 0 19" fill="none" stroke="#fff" strokeWidth="6.5" strokeLinecap="round" /><circle cx="44" cy="32" r="4" fill="#fff" /></svg>
    </span>
  );
}

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme();
  return (
    <button onClick={(e) => toggle({ x: e.clientX, y: e.clientY })} aria-label="Toggle theme" title={theme === "dark" ? "Switch to light" : "Switch to dark"}
      className={cn("relative grid place-items-center size-10 rounded-xl border border-white/[0.08] bg-white/[0.03] text-fg-2 hover:text-fg hover:border-white/15 transition-colors overflow-hidden", className)}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={theme} initial={{ y: 14, opacity: 0, rotate: -40 }} animate={{ y: 0, opacity: 1, rotate: 0 }} exit={{ y: -14, opacity: 0, rotate: 40 }} transition={{ duration: 0.22 }}>
          {theme === "dark" ? <Moon className="size-[18px]" /> : <Sun className="size-[18px] text-flame-400" />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

function SidebarContent({ groups, counts, onNavigate }: { groups: NavGroup[]; counts?: NavCounts; onNavigate?: () => void }) {
  const { user, session, signOut } = useSession();
  const [menu, setMenu] = useState(false);
  const company = session?.company;
  const roleLabel = user?.is_owner ? "Founder console" : user?.is_admin ? "Admin console" : "Employee portal";
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-5 pt-6 pb-6">
        {company?.logo_url ? (
          // The uploaded logo already carries the name — show it once, at its natural width.
          <div className="min-w-0">
            <span className="inline-flex items-center h-11 max-w-[210px] rounded-xl bg-[#fff] px-3 shadow-sm">
              <img src={company.logo_url} alt={company.company_name} className="max-h-8 max-w-full object-contain" />
            </span>
            <div className="mt-2 text-[11px] text-fg-4 uppercase tracking-[0.14em]">{roleLabel}</div>
          </div>
        ) : (<>
          <BrandMark />
          <div className="min-w-0">
            <div className="font-display font-bold text-[15.5px] tracking-tight truncate">{company?.company_name ?? "CraftLanee"}</div>
            <div className="text-[11px] text-fg-4 uppercase tracking-[0.14em]">{roleLabel}</div>
          </div>
        </>)}
      </div>

      <nav className="flex-1 overflow-y-auto px-3 space-y-5 pb-4">
        {groups.map((g, gi) => (
          <div key={gi}>
            {g.label && <div className="px-3 mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-fg-4">{g.label}</div>}
            <div className="space-y-0.5">
              {g.items.map((item) => {
                const badge = item.badge && counts ? Number(counts[item.badge] || 0) : 0;
                return (
                  <NavLink key={item.to} to={item.to} end={item.end} onClick={onNavigate} className={({ isActive }) => cn("nav-item", isActive && "active")}>
                    {({ isActive }) => (
                      <>
                        {isActive && (
                          <motion.span layoutId="nav-active" className="absolute inset-0 rounded-[11px] bg-gradient-to-r from-brand-500/[0.2] via-brand-500/[0.07] to-transparent border border-white/[0.07]"
                            transition={{ type: "spring", stiffness: 500, damping: 40 }}>
                            <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full" style={{ background: "var(--grad)" }} />
                          </motion.span>
                        )}
                        <item.icon className={cn("relative", isActive && "text-brand-300")} />
                        <span className="relative flex-1">{item.label}</span>
                        {badge > 0 && (
                          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="relative min-w-5 h-5 px-1.5 grid place-items-center rounded-full text-[11px] font-bold text-on-accent" style={{ background: "var(--grad)" }}>{badge}</motion.span>
                        )}
                      </>
                    )}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="relative p-3 border-t divider">
        <AnimatePresence>
          {menu && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
              className="absolute bottom-full left-3 right-3 mb-2 glass panel p-1.5 z-10">
              <NavLink to="/account" onClick={() => { setMenu(false); onNavigate?.(); }} className="nav-item"><KeyRound /> Account & password</NavLink>
              <button onClick={() => signOut()} className="nav-item w-full text-bad hover:text-bad"><LogOut /> Sign out</button>
            </motion.div>
          )}
        </AnimatePresence>
        <button onClick={() => setMenu((m) => !m)} className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 hover:bg-white/[0.04] transition-colors text-left">
          <Avatar person={user?.employee ?? { initials: (user?.name ?? "?").slice(0, 1).toUpperCase(), id: user?.id }} size={34} />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold truncate flex items-center gap-1.5">{user?.name}{user?.is_admin && <ShieldCheck className="size-3.5 text-brand-300 shrink-0" />}</div>
            <div className="text-[11.5px] text-fg-4 truncate">{user?.is_owner ? "Founder · Owner" : user?.employee?.designation ?? "Employee"}{user?.is_admin && !user.is_owner ? " · Admin" : ""}</div>
          </div>
          <ChevronsUpDown className="size-4 text-fg-4" />
        </button>
      </div>
    </div>
  );
}

export function AppShell() {
  const { user } = useSession();
  const location = useLocation();
  const [mobileNav, setMobileNav] = useState(false);
  const [palette, setPalette] = useState(false);
  const admin = !!user?.is_admin;
  const groups = navFor(user);
  const { data: counts } = useQuery({ queryKey: ["nav-counts"], queryFn: () => api.get<NavCounts>("/nav-counts"), refetchInterval: 60_000, staleTime: 20_000 });

  useEffect(() => {
    if (!admin) return;
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); }
      if (e.key === "/" && !(e.target as HTMLElement).closest("input, textarea, select, [contenteditable]")) { e.preventDefault(); setPalette(true); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [admin]);

  useEffect(() => { window.scrollTo({ top: 0 }); }, [location.pathname]);

  return (
    <div className="relative min-h-screen">
      <Ambient />
      <aside className="hidden lg:block fixed inset-y-0 left-0 z-30 w-[264px] border-r border-white/[0.06] bg-ink-900/70 backdrop-blur-xl">
        <SidebarContent groups={groups} counts={counts} />
      </aside>

      <AnimatePresence>
        {mobileNav && (
          <div className="lg:hidden fixed inset-0 z-[60]">
            <motion.div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setMobileNav(false)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            <motion.aside className="absolute inset-y-0 left-0 w-[280px] bg-ink-900 border-r border-white/[0.08]"
              initial={{ x: -300 }} animate={{ x: 0 }} exit={{ x: -300 }} transition={{ type: "spring", stiffness: 400, damping: 40 }}>
              <button className="absolute right-3 top-6 p-1.5 text-fg-3" onClick={() => setMobileNav(false)} aria-label="Close menu"><X className="size-5" /></button>
              <SidebarContent groups={groups} counts={counts} onNavigate={() => setMobileNav(false)} />
            </motion.aside>
          </div>
        )}
      </AnimatePresence>

      <div className="relative z-10 lg:pl-[264px]">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 px-4 sm:px-8 bg-ink-950/60 backdrop-blur-xl border-b border-white/[0.05]">
          <button className="lg:hidden btn btn-ghost btn-icon" onClick={() => setMobileNav(true)} aria-label="Open menu"><Menu /></button>
          {admin && (
            <button onClick={() => setPalette(true)}
              className="group flex h-10 w-full max-w-[440px] items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 text-[13.5px] text-fg-4 hover:border-white/15 hover:bg-white/[0.05] transition-all">
              <Search className="size-4 group-hover:text-brand-300 transition-colors" />
              <span className="flex-1 text-left truncate">Search anything…</span>
              <kbd className="hidden sm:inline-flex items-center rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[11px] font-medium text-fg-3">Ctrl K</kbd>
            </button>
          )}
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden md:inline text-[12.5px] text-fg-4">{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</span>
            <ThemeToggle />
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1320px] px-4 sm:px-8 pt-8 pb-20">
          <AnimatePresence mode="wait">
            <motion.div key={location.pathname}
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}>
              <Suspense fallback={<PageSkeleton />}><Outlet /></Suspense>
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      {admin && <CommandPalette open={palette} onClose={() => setPalette(false)} />}
    </div>
  );
}
