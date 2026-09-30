import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { errorMessage, postBlob } from "@/lib/api";
import { cn } from "@/lib/format";

/**
 * Renders the *real* server-generated PDF from unsaved form values, debounced as you type.
 * What you see here is exactly what will be generated.
 */
export function PdfPreview({ endpoint, payload, height = "78vh", className }: { endpoint: string; payload: Record<string, unknown>; height?: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);
  const key = JSON.stringify(payload);
  const last = useRef<string | null>(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const blob = await postBlob(endpoint, JSON.parse(key));
        const next = URL.createObjectURL(blob);
        if (last.current) URL.revokeObjectURL(last.current);
        last.current = next;
        setUrl(next);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setLoading(false);
      }
    }, 750);
    return () => clearTimeout(t);
  }, [endpoint, key, nonce]);

  useEffect(() => () => { if (last.current) URL.revokeObjectURL(last.current); }, []);

  return (
    <div className={cn("relative rounded-2xl p-1.5 bg-gradient-to-br from-brand-500/35 via-white/5 to-flame-500/25 shadow-[0_30px_80px_-30px_rgba(124,92,255,0.45)]", className)}>
      <div className="relative overflow-hidden rounded-xl bg-[#525659]" style={{ height }}>
        {url && <iframe title="PDF preview" src={`${url}#toolbar=0&navpanes=0&view=FitH`} className="absolute inset-0 size-full border-0" />}
        {!url && !error && <div className="absolute inset-0 grid place-items-center text-[#d1d5db]"><Loader2 className="size-6 animate-spin" /></div>}
        {error && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-[#e5e7eb]">
            <div><AlertTriangle className="size-6 mx-auto mb-2 text-[#fbbf24]" /><div className="text-[13px]">{error}</div></div>
          </div>
        )}
        <div className="absolute top-3 right-3 flex items-center gap-1.5">
          {loading && url && <span className="flex items-center gap-1.5 rounded-full bg-[#111827]/80 px-2.5 py-1 text-[11.5px] text-[#e5e7eb]"><Loader2 className="size-3 animate-spin" /> Updating</span>}
          <button type="button" onClick={() => setNonce((n) => n + 1)} title="Refresh preview" className="grid place-items-center size-7 rounded-lg bg-[#111827]/80 text-[#e5e7eb] hover:bg-[#111827]"><RefreshCw className="size-3.5" /></button>
          {url && <a href={url} target="_blank" rel="noopener" title="Open full size" className="grid place-items-center size-7 rounded-lg bg-[#111827]/80 text-[#e5e7eb] hover:bg-[#111827]"><ExternalLink className="size-3.5" /></a>}
        </div>
      </div>
    </div>
  );
}
