import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster, toast } from "sonner";
import { errorMessage } from "@/lib/api";
import { SessionProvider } from "@/lib/session";
import { ConfirmProvider } from "@/components/ui/overlay";
import { ThemeProvider, useTheme } from "@/lib/theme";
import App from "./App";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: (n, err) => n < 1 && (err as { status?: number }).status !== 403 && (err as { status?: number }).status !== 404, refetchOnWindowFocus: false, staleTime: 15_000 },
  },
  // Every failed mutation surfaces as a toast unless the caller handles it (meta.silent).
  mutationCache: new MutationCache({
    onError: (err, _v, _c, mutation) => { if (!mutation.meta?.silent) toast.error(errorMessage(err)); },
  }),
});

function ThemedToaster() {
  const { theme } = useTheme();
  return <Toaster theme={theme} position="bottom-right" richColors closeButton
    toastOptions={{ style: { background: "var(--panel)", border: "1px solid var(--line-strong)", backdropFilter: "blur(12px)", borderRadius: 14, color: "var(--color-fg)" } }} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
   <ThemeProvider>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SessionProvider>
          <ConfirmProvider>
            <App />
            <ThemedToaster />
          </ConfirmProvider>
        </SessionProvider>
      </BrowserRouter>
    </QueryClientProvider>
   </ThemeProvider>
  </StrictMode>,
);
