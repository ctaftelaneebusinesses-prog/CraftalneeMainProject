import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Eye, ExternalLink, ImagePlus, Link2, Megaphone, Pencil, Pin, Plus, Send, Trash2, Users, X } from "lucide-react";
import { api } from "@/lib/api";
import { cn, fmtDateTime, relative } from "@/lib/format";
import { useEmployeeOptions } from "@/lib/hooks";
import type { Announcement, AnnouncementLink, EmployeeBrief } from "@/lib/types";
import { Avatar, Badge, Button, Card, EmptyState, Field, Input, PageHeader, PageSkeleton, SearchInput, Segmented, Textarea, Toggle } from "@/components/ui/core";
import { Drawer, Modal, useConfirm } from "@/components/ui/overlay";

// ------------------------------------------------------------------ helpers

/** YouTube video id from watch / youtu.be / shorts / embed links, else null. */
export function youtubeId(url: string) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^(www\.|m\.)/, "");
    if (host === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
    if (host === "youtube.com" || host === "youtube-nocookie.com") {
      if (u.searchParams.get("v")) return u.searchParams.get("v");
      const m = u.pathname.match(/^\/(shorts|embed|live)\/([\w-]{6,})/);
      return m ? m[2] : null;
    }
  } catch { /* not a URL */ }
  return null;
}

const URL_RE = /(https?:\/\/[^\s<]+[^\s<.,;:!?)"'\]])/g;

/** Plain text with web links made clickable (no HTML is ever injected). */
function Linkified({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  return <>{parts.map((p, i) => (i % 2 === 1
    ? <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="text-brand-300 hover:underline break-all">{p}</a>
    : <Fragment key={i}>{p}</Fragment>))}</>;
}

const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };

/** Shrink big phone photos before upload (keeps posts well under the 15 MB request limit). */
async function shrink(file: File, max = 1800): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif" || file.size < 600_000) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.85));
    return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

// ------------------------------------------------------------------ page

export default function Announcements() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [editing, setEditing] = useState<Announcement | "new" | null>(null);
  const [readersOf, setReadersOf] = useState<Announcement | null>(null);
  const [lightbox, setLightbox] = useState<{ photos: Announcement["photos"]; index: number } | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ["announcements"], queryFn: () => api.get<{ announcements: Announcement[]; unread: number; can_post: boolean }>("/announcements") });

  // Remember what was new when the page opened (to highlight it), then mark everything read.
  const fresh = useRef<Set<number> | null>(null);
  useEffect(() => {
    if (!data || fresh.current) return;
    fresh.current = new Set(data.announcements.filter((a) => !a.read).map((a) => a.id));
    if (fresh.current.size) api.post("/announcements/read", {}).then(() => qc.invalidateQueries({ queryKey: ["nav-counts"] })).catch(() => undefined);
  }, [data, qc]);

  const del = useMutation({
    mutationFn: (id: number) => api.del(`/announcements/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["announcements"] }); toast.success("Announcement deleted"); },
  });

  if (isLoading || !data) return <PageSkeleton />;
  const items = data.announcements;

  return (
    <>
      <PageHeader eyebrow="Company" title="Announcements"
        subtitle={data.can_post ? "Share news with everyone or with chosen people — add links, videos and photos." : "News and updates from the company."}
        actions={data.can_post && <Button variant="primary" icon={<Plus />} onClick={() => setEditing("new")}>New announcement</Button>} />

      {!items.length ? (
        <Card><EmptyState icon={<Megaphone />} title="No announcements yet"
          text={data.can_post ? "Post your first update — everyone, or just the people you choose, will see it here." : "When the company posts an update, it appears here."}
          action={data.can_post && <Button variant="primary" icon={<Plus />} onClick={() => setEditing("new")}>New announcement</Button>} /></Card>
      ) : (
        <div className="max-w-3xl space-y-4">
          {items.map((a, i) => (
            <motion.div key={a.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 8) * 0.04 }}>
              <AnnouncementCard a={a} isNew={!!fresh.current?.has(a.id)} canPost={data.can_post}
                onPhoto={(index) => setLightbox({ photos: a.photos, index })}
                onReaders={() => setReadersOf(a)} onEdit={() => setEditing(a)}
                onDelete={async () => { if (await confirm({ title: `Delete “${a.title}”?`, message: "It disappears for everyone, along with its photos.", danger: true, confirmText: "Delete" })) del.mutate(a.id); }} />
            </motion.div>
          ))}
        </div>
      )}

      <Composer value={editing} onClose={() => setEditing(null)} />
      <ReadersModal a={readersOf} onClose={() => setReadersOf(null)} />
      <Lightbox state={lightbox} onClose={() => setLightbox(null)} onMove={(index) => setLightbox((l) => l && { ...l, index })} />
    </>
  );
}

function AnnouncementCard({ a, isNew, canPost, onPhoto, onReaders, onEdit, onDelete }: {
  a: Announcement; isNew: boolean; canPost: boolean; onPhoto: (i: number) => void; onReaders: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const videos = a.links.filter((l) => youtubeId(l.url));
  const others = a.links.filter((l) => !youtubeId(l.url));
  return (
    <Card className={cn("overflow-hidden", a.pinned && "glow-border", isNew && "ring-1 ring-brand-400/40")}>
      <div className="p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="grid place-items-center size-10 shrink-0 rounded-full text-on-accent font-semibold" style={{ background: "var(--grad)" }}>
            {(a.author_name ?? "C").charAt(0).toUpperCase()}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
              <span className="font-semibold">{a.author_name ?? "Company"}</span>
              <span className="text-fg-4" title={fmtDateTime(a.created_at)}>{relative(a.created_at)}{a.edited && " · edited"}</span>
              {a.pinned && <Badge tone="brand"><Pin className="size-3" /> Pinned</Badge>}
              {isNew && <Badge tone="warn" dot>New</Badge>}
            </div>
            <div className="mt-0.5 text-[12px] text-fg-4 flex items-center gap-1.5">
              <Users className="size-3.5" />
              {a.audience === "all" ? "Everyone" : a.recipients.length <= 3 ? a.recipients.map((r) => r.full_name).join(", ") : `${a.recipients.length} people`}
            </div>
          </div>
          {canPost && (
            <div className="flex gap-0.5">
              <Button size="sm" variant="ghost" iconOnly icon={<Pencil />} title="Edit" onClick={onEdit} />
              <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} title="Delete" onClick={onDelete} className="hover:text-bad" />
            </div>
          )}
        </div>

        <h2 className="mt-4 font-display font-bold text-[19px] leading-snug">{a.title}</h2>
        {a.body && <p className="mt-2 text-[14px] text-fg-2 leading-relaxed whitespace-pre-wrap break-words"><Linkified text={a.body} /></p>}

        {videos.map((l) => (
          <div key={l.url} className="mt-4">
            <div className="relative w-full overflow-hidden rounded-xl border border-white/[0.08] bg-black" style={{ aspectRatio: "16 / 9" }}>
              <iframe className="absolute inset-0 size-full" src={`https://www.youtube-nocookie.com/embed/${youtubeId(l.url)}`} title={l.label || "YouTube video"}
                loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
            </div>
            {l.label && <div className="mt-1.5 text-[12.5px] text-fg-3">{l.label}</div>}
          </div>
        ))}

        {others.length > 0 && (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
            {others.map((l) => (
              <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer"
                className="group flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] px-3.5 py-3 hover:border-brand-400/40 hover:bg-brand-500/[0.06] transition-colors">
                <span className="grid place-items-center size-9 shrink-0 rounded-lg bg-brand-500/15 text-brand-300"><Link2 className="size-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium">{l.label || hostOf(l.url)}</span>
                  <span className="block truncate text-[12px] text-fg-4">{hostOf(l.url)}</span>
                </span>
                <ExternalLink className="size-4 text-fg-4 group-hover:text-fg" />
              </a>
            ))}
          </div>
        )}

        {a.photos.length > 0 && <PhotoGrid photos={a.photos} onOpen={onPhoto} />}
      </div>

      {canPost && a.reach !== undefined && (
        <button type="button" onClick={onReaders}
          className="w-full flex items-center gap-2 px-6 py-3 border-t divider text-[12.5px] text-fg-3 hover:text-fg hover:bg-white/[0.02] transition-colors">
          <Eye className="size-4" />Seen by {a.seen} of {a.reach}
          <span className="ml-auto h-1.5 w-28 rounded-full bg-white/[0.06] overflow-hidden">
            <span className="block h-full rounded-full" style={{ width: `${a.reach ? ((a.seen ?? 0) / a.reach) * 100 : 0}%`, background: "var(--grad)" }} />
          </span>
        </button>
      )}
    </Card>
  );
}

function PhotoGrid({ photos, onOpen }: { photos: Announcement["photos"]; onOpen: (i: number) => void }) {
  const shown = photos.slice(0, 4);
  const extra = photos.length - shown.length;
  return (
    <div className={cn("mt-4 grid gap-1.5 overflow-hidden rounded-xl", shown.length === 1 ? "grid-cols-1" : "grid-cols-2")}>
      {shown.map((p, i) => (
        <button key={p.id} type="button" onClick={() => onOpen(i)}
          className={cn("relative overflow-hidden bg-white/[0.03]", shown.length === 1 ? "max-h-[460px]" : "aspect-[4/3]", shown.length === 3 && i === 0 && "row-span-2 aspect-auto")}>
          <img src={p.url} alt={p.name ?? "Photo"} loading="lazy" className={cn("size-full hover:scale-[1.02] transition-transform duration-300", shown.length === 1 ? "object-contain" : "object-cover")} />
          {extra > 0 && i === shown.length - 1 && <span className="absolute inset-0 grid place-items-center bg-black/55 text-[#fff] font-display font-bold text-[22px]">+{extra}</span>}
        </button>
      ))}
    </div>
  );
}

function Lightbox({ state, onClose, onMove }: { state: { photos: Announcement["photos"]; index: number } | null; onClose: () => void; onMove: (i: number) => void }) {
  useEffect(() => {
    if (!state) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") onMove((state.index + 1) % state.photos.length);
      if (e.key === "ArrowLeft") onMove((state.index - 1 + state.photos.length) % state.photos.length);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [state, onMove]);
  const p = state?.photos[state.index];
  return (
    <Modal open={!!state} onClose={onClose} width={1000} title={state ? `Photo ${state.index + 1} of ${state.photos.length}` : ""}>
      {p && state && (
        <div className="relative">
          <img src={p.url} alt={p.name ?? "Photo"} className="mx-auto max-h-[72vh] rounded-lg object-contain" />
          {state.photos.length > 1 && (<>
            <Button className="absolute left-2 top-1/2 -translate-y-1/2" iconOnly icon={<ChevronLeft />} title="Previous" onClick={() => onMove((state.index - 1 + state.photos.length) % state.photos.length)} />
            <Button className="absolute right-2 top-1/2 -translate-y-1/2" iconOnly icon={<ChevronRight />} title="Next" onClick={() => onMove((state.index + 1) % state.photos.length)} />
          </>)}
          <div className="mt-3 text-center"><a href={`${p.url}?dl=1`} className="text-[12.5px] text-brand-300 hover:underline">Download</a></div>
        </div>
      )}
    </Modal>
  );
}

function ReadersModal({ a, onClose }: { a: Announcement | null; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ["announcement-readers", a?.id],
    queryFn: () => api.get<{ seen: (EmployeeBrief & { read_at: string })[]; not_seen: EmployeeBrief[] }>(`/announcements/${a!.id}/readers`),
    enabled: !!a,
  });
  const Row = ({ e, right }: { e: EmployeeBrief; right: ReactNode }) => (
    <div className="flex items-center gap-3 py-2">
      <Avatar person={e} size={30} />
      <span className="flex-1 min-w-0 truncate text-[13.5px]">{e.full_name}</span>
      <span className="text-[12px] text-fg-4">{right}</span>
    </div>
  );
  return (
    <Modal open={!!a} onClose={onClose} title="Who has seen this" subtitle={a?.title}>
      {!data ? <p className="text-fg-4 text-[13px]">Loading…</p> : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div>
            <div className="eyebrow mb-1">Seen · {data.seen.length}</div>
            {data.seen.map((e) => <Row key={e.id} e={e} right={relative(e.read_at)} />)}
            {!data.seen.length && <p className="text-[13px] text-fg-4 py-2">No one yet.</p>}
          </div>
          <div>
            <div className="eyebrow mb-1">Not yet · {data.not_seen.length}</div>
            {data.not_seen.map((e) => <Row key={e.id} e={e} right="—" />)}
            {!data.not_seen.length && <p className="text-[13px] text-fg-4 py-2">Everyone has seen it 🎉</p>}
          </div>
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ composer

interface LinkRow extends AnnouncementLink { key: number }
let linkKey = 1;

function Composer({ value, onClose }: { value: Announcement | "new" | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: opts } = useEmployeeOptions();
  const editing = value && value !== "new" ? value : null;
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<"all" | "selected">("all");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [q, setQ] = useState("");
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [photos, setPhotos] = useState<{ file: File; url: string }[]>([]);
  const [removed, setRemoved] = useState<Set<number>>(new Set());
  const [pinned, setPinned] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!value) return;
    const a = value === "new" ? null : value;
    setTitle(a?.title ?? ""); setBody(a?.body ?? ""); setAudience(a?.audience ?? "all");
    setPicked(new Set(a?.recipients.map((r) => r.id) ?? [])); setQ("");
    setLinks((a?.links ?? []).map((l) => ({ ...l, key: linkKey++ })));
    setPhotos((old) => { old.forEach((p) => URL.revokeObjectURL(p.url)); return []; });
    setRemoved(new Set()); setPinned(a?.pinned ?? false);
  }, [value]);

  const people = useMemo(() => (opts?.employees ?? []).filter((e) => e.status === "active"), [opts]);
  const shown = people.filter((e) => !q || `${e.full_name} ${e.emp_code} ${e.designation ?? ""} ${e.employment_type ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  const keptPhotos = (editing?.photos ?? []).filter((p) => !removed.has(p.id));

  const save = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append("title", title);
      fd.append("body", body);
      fd.append("audience", audience);
      fd.append("recipient_ids", JSON.stringify([...picked]));
      fd.append("links", JSON.stringify(links.filter((l) => l.url.trim()).map(({ url, label }) => ({ url: url.trim(), label }))));
      fd.append("pinned", pinned ? "1" : "0");
      fd.append("remove_photo_ids", JSON.stringify([...removed]));
      for (const p of photos) fd.append("photos", await shrink(p.file));
      return editing ? api.put<{ announcement: Announcement }>(`/announcements/${editing.id}`, fd) : api.post<{ announcement: Announcement }>("/announcements", fd);
    },
    onSuccess: () => {
      ["announcements", "nav-counts"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.success(editing ? "Announcement updated" : audience === "all" ? "Posted to everyone" : `Sent to ${picked.size} ${picked.size === 1 ? "person" : "people"}`);
      onClose();
    },
  });

  const addFiles = (list: FileList | null) => {
    const files = Array.from(list ?? []).filter((f) => /^image\/(png|jpe?g|webp)$/.test(f.type));
    if (list && files.length < list.length) toast.error("Only PNG, JPG and WebP photos can be added.");
    setPhotos((ps) => [...ps, ...files.map((file) => ({ file, url: URL.createObjectURL(file) }))].slice(0, 12 - keptPhotos.length));
  };
  const flip = (id: number) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allShown = shown.length > 0 && shown.every((e) => picked.has(e.id));
  const canSend = title.trim() && (audience === "all" || picked.size > 0);

  return (
    <Drawer open={!!value} onClose={onClose} width={640} title={editing ? "Edit announcement" : "New announcement"}
      subtitle="People see it in Announcements, with a badge until they open it."
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon={<Send />} loading={save.isPending} disabled={!canSend} onClick={() => save.mutate()}>
          {editing ? "Save changes" : audience === "all" ? "Post to everyone" : `Send to ${picked.size || "…"} ${picked.size === 1 ? "person" : "people"}`}
        </Button>
      </>}>
      <div className="space-y-6">
        <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="e.g. Office closed on Friday for Diwali" autoFocus /></Field>
        <Field label="Message" optional hint="Links you paste here become clickable.">
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} className="min-h-[140px]" maxLength={10000} placeholder="Write your announcement…" />
        </Field>

        <Field label="Who should see it">
          <Segmented layoutId="ann-audience" value={audience} onChange={setAudience}
            options={[{ value: "all", label: "Everyone" }, { value: "selected", label: "Selected people" }]} />
        </Field>
        {audience === "selected" && (
          <div className="rounded-xl border border-white/[0.08] p-3 -mt-3">
            <div className="flex items-center gap-2 mb-2">
              <SearchInput value={q} onChange={setQ} placeholder="Search name, ID, role, type…" className="flex-1" />
              <Button size="sm" variant="ghost" onClick={() => setPicked((s) => { const n = new Set(s); shown.forEach((e) => (allShown ? n.delete(e.id) : n.add(e.id))); return n; })}>
                {allShown ? "Unselect shown" : "Select shown"}
              </Button>
            </div>
            <div className="max-h-56 overflow-y-auto -mx-1">
              {shown.map((e) => (
                <label key={e.id} className={cn("flex items-center gap-3 rounded-lg px-2 py-1.5 cursor-pointer", picked.has(e.id) ? "bg-brand-500/[0.08]" : "hover:bg-white/[0.04]")}>
                  <input type="checkbox" className="size-4 accent-[#7c5cff]" checked={picked.has(e.id)} onChange={() => flip(e.id)} />
                  <Avatar person={e} size={26} />
                  <span className="flex-1 min-w-0 truncate text-[13.5px]">{e.full_name}</span>
                  <span className="text-[11.5px] text-fg-4">{e.employment_type}</span>
                </label>
              ))}
              {!shown.length && <p className="px-2 py-3 text-[13px] text-fg-4">No one found.</p>}
            </div>
            <div className="mt-2 text-[12px] text-fg-4">{picked.size} selected</div>
          </div>
        )}

        <Field label="Links" optional hint="YouTube links play right inside the announcement.">
          <div className="space-y-2">
            {links.map((l) => (
              <div key={l.key} className="grid grid-cols-[minmax(0,1fr)_150px_32px] gap-2">
                <Input value={l.url} onChange={(e) => setLinks((ls) => ls.map((x) => (x.key === l.key ? { ...x, url: e.target.value } : x)))} placeholder="https://youtube.com/watch?v=…" className="input-sm" />
                <Input value={l.label} onChange={(e) => setLinks((ls) => ls.map((x) => (x.key === l.key ? { ...x, label: e.target.value } : x)))} placeholder="Label (optional)" className="input-sm" maxLength={120} />
                <Button size="sm" variant="ghost" iconOnly icon={<X />} title="Remove link" onClick={() => setLinks((ls) => ls.filter((x) => x.key !== l.key))} />
              </div>
            ))}
            {links.length < 10 && <Button size="sm" icon={<Link2 />} onClick={() => setLinks((ls) => [...ls, { url: "", label: "", key: linkKey++ }])}>Add link</Button>}
          </div>
        </Field>

        <Field label="Photos" optional hint="Up to 12 · PNG, JPG or WebP · large photos are resized automatically.">
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            <AnimatePresence initial={false}>
              {keptPhotos.map((p) => (
                <Thumb key={`k${p.id}`} src={p.url} onRemove={() => setRemoved((s) => new Set(s).add(p.id))} />
              ))}
              {photos.map((p, i) => (
                <Thumb key={p.url} src={p.url} onRemove={() => { URL.revokeObjectURL(p.url); setPhotos((ps) => ps.filter((_, j) => j !== i)); }} />
              ))}
            </AnimatePresence>
            {keptPhotos.length + photos.length < 12 && (
              <button type="button" onClick={() => fileInput.current?.click()}
                className="aspect-square grid place-items-center rounded-xl border border-dashed border-white/15 text-fg-3 hover:text-fg hover:border-brand-400/50 transition-colors">
                <span className="flex flex-col items-center gap-1 text-[12px]"><ImagePlus className="size-5" />Add photos</span>
              </button>
            )}
          </div>
          <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
        </Field>

        <Toggle checked={pinned} onChange={setPinned} label="Pin to the top" />
      </div>
    </Drawer>
  );
}

function Thumb({ src, onRemove }: { src: string; onRemove: () => void }) {
  return (
    <motion.div layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
      className="group relative aspect-square overflow-hidden rounded-xl border border-white/[0.08]">
      <img src={src} alt="" className="size-full object-cover" />
      <button type="button" onClick={onRemove} aria-label="Remove photo"
        className="absolute top-1.5 right-1.5 grid place-items-center size-6 rounded-full bg-black/60 text-[#fff] opacity-0 group-hover:opacity-100 transition-opacity">
        <X className="size-3.5" />
      </button>
    </motion.div>
  );
}
