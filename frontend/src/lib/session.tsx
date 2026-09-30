import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, setCsrf } from "./api";
import type { Area, Session, User } from "./types";

interface SessionCtx {
  session: Session | undefined;
  user: User | null;
  loading: boolean;
  setSession: (patch: Partial<Session>) => void;
  signOut: () => Promise<void>;
}

const Ctx = createContext<SessionCtx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["session"],
    queryFn: async () => {
      const s = await api.get<Session>("/auth/session");
      setCsrf(s.csrf);
      return s;
    },
    staleTime: Infinity,
  });

  const setSession = (patch: Partial<Session>) =>
    qc.setQueryData<Session>(["session"], (old) => ({ ...(old as Session), ...patch }));

  const signOut = async () => {
    await api.post("/auth/logout").catch(() => undefined);
    // Full reload: guarantees no cached data from the previous user survives in memory.
    window.location.assign("/login");
  };

  // Server said our session is gone (expired, deactivated) → refresh session state.
  useEffect(() => {
    const onUnauthorized = () => qc.invalidateQueries({ queryKey: ["session"] });
    window.addEventListener("cl:unauthorized", onUnauthorized);
    return () => window.removeEventListener("cl:unauthorized", onUnauthorized);
  }, [qc]);

  return (
    <Ctx.Provider value={{ session: data, user: data?.user ?? null, loading: isLoading, setSession, signOut }}>
      {children}
    </Ctx.Provider>
  );
}

export function useSession() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSession outside provider");
  return ctx;
}

/** Whether this user may use an area of the admin console. The server enforces the same rule. */
export function can(user: User | null | undefined, area: Area) {
  return !!user?.is_owner || !!user?.permissions?.includes(area);
}
