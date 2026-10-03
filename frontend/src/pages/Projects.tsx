import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ExternalLink, FileText, FolderKanban, Globe2, Link2, Pencil, Plus, Trash2, Users } from "lucide-react";
import { api, toForm } from "@/lib/api";
import { cn, fmtDate } from "@/lib/format";
import { useEmployeeOptions } from "@/lib/hooks";
import type { ProjectDoc } from "@/lib/types";
import { Avatar, Badge, Button, Card, EmptyState, Field, FileActions, Input, PageHeader, SearchInput, Segmented, Select,
  Skeleton, Textarea } from "@/components/ui/core";
import { Drawer, FileDrop, useConfirm } from "@/components/ui/overlay";

type Data = { documents: ProjectDoc[]; projects: string[]; can_manage: boolean };

/** Project briefs, specs and files. Everyone sees what's shared with them; the founder and admins with the
 *  "projects" area (e.g. the project manager) share with everyone or with chosen people. */
export default function Projects() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [project, setProject] = useState("");
  const [editing, setEditing] = useState<ProjectDoc | "new" | null>(null);
  const { data, isLoading } = useQuery({ queryKey: ["projects"], queryFn: () => api.get<Data>("/projects") });

  useEffect(() => { if (params.get("new")) { setEditing("new"); params.delete("new"); setParams(params, { replace: true }); } }, [params, setParams]);

  const del = useMutation({
    mutationFn: (id: number) => api.del(`/projects/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["projects"] }); toast.success("Document deleted"); },
  });

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = (data?.documents ?? []).filter((d) => (!project || d.project === project)
      && (!needle || `${d.project} ${d.title} ${d.description ?? ""} ${d.file_name ?? ""}`.toLowerCase().includes(needle)));
    const map = new Map<string, ProjectDoc[]>();
    rows.forEach((d) => map.set(d.project, [...(map.get(d.project) ?? []), d]));
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [data, q, project]);

  const manage = !!data?.can_manage;
  return (
    <>
      <PageHeader eyebrow="Work" title="Project documents" subtitle={manage ? "Share briefs, specs and files from project discussions with everyone or chosen people." : "Briefs, specs and files shared with you for your projects."}
        actions={manage && <Button variant="primary" icon={<Plus />} onClick={() => setEditing("new")}>Share document</Button>} />

      {!!data?.documents.length && (
        <div className="flex flex-wrap items-center gap-3 mb-5">
          <Select className="input-sm h-[38px] w-[220px]" value={project} onChange={(e) => setProject(e.target.value)} placeholder="All projects" options={data.projects} />
          <div className="flex-1" />
          <SearchInput value={q} onChange={setQ} placeholder="Search documents…" className="w-full sm:w-[260px]" />
        </div>
      )}

      {isLoading ? <div className="space-y-3">{[0, 1].map((i) => <Skeleton key={i} className="h-28" />)}</div>
        : !data?.documents.length ? (
          <Card><EmptyState icon={<FolderKanban />} title="No project documents yet"
            text={manage ? "Upload a brief, spec or file from a project discussion and choose who can see it." : "When a document is shared with you, it shows up here."}
            action={manage ? <Button variant="primary" icon={<Plus />} onClick={() => setEditing("new")}>Share document</Button> : undefined} /></Card>
        ) : !groups.length ? <Card><EmptyState icon={<FolderKanban />} title="Nothing matches" text="Try another project or search." /></Card>
        : (
          <div className="space-y-5">
            {groups.map(([name, docs]) => (
              <Card key={name} className="overflow-hidden">
                <div className="flex items-center gap-3 px-5 py-4 border-b divider">
                  <span className="grid place-items-center size-9 rounded-xl bg-brand-500/15 text-brand-300"><FolderKanban className="size-[18px]" /></span>
                  <div className="font-display font-semibold text-[15px] flex-1 truncate">{name}</div>
                  <span className="text-[12.5px] text-fg-4">{docs.length} document{docs.length === 1 ? "" : "s"}</span>
                </div>
                <div className="divide-y divider">
                  {docs.map((d) => (
                    <div key={d.id} className="group flex items-start gap-4 px-5 py-4">
                      <span className="grid place-items-center size-10 shrink-0 rounded-xl border border-white/[0.08] bg-white/[0.03] text-fg-2">{d.file_url ? <FileText className="size-[18px]" /> : <Link2 className="size-[18px]" />}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{d.title}</span>
                          {manage && (d.audience === "all"
                            ? <Badge tone="info"><Globe2 className="size-3" /> Everyone</Badge>
                            : <Badge tone="brand"><Users className="size-3" /> {d.recipients.length <= 2 ? d.recipients.map((r) => r.full_name).join(", ") : `${d.recipients.length} people`}</Badge>)}
                        </div>
                        {d.description && <p className="mt-1 text-[13px] text-fg-2 whitespace-pre-wrap leading-relaxed">{d.description}</p>}
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-fg-4">
                          {d.file_name && <span className="truncate max-w-[260px]">{d.file_name}</span>}
                          {d.link && <a href={d.link} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-brand-300 hover:underline"><ExternalLink className="size-3" />Open link</a>}
                          <span>{d.author_name ? `Shared by ${d.author_name} · ` : ""}{fmtDate(d.created_at)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                        {d.file_url && <FileActions url={d.file_url} />}
                        {manage && <>
                          <Button size="sm" variant="ghost" iconOnly icon={<Pencil />} title="Edit or change who can see it" onClick={() => setEditing(d)} />
                          <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} title="Delete" className="hover:text-bad" onClick={async () => {
                            if (await confirm({ title: `Delete “${d.title}”?`, message: "Everyone it was shared with loses access. This can't be undone.", danger: true, confirmText: "Delete" })) del.mutate(d.id);
                          }} />
                        </>}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        )}

      {manage && <DocDrawer editing={editing} projects={data?.projects ?? []} onClose={() => setEditing(null)} />}
    </>
  );
}

function DocDrawer({ editing, projects, onClose }: { editing: ProjectDoc | "new" | null; projects: string[]; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: opts } = useEmployeeOptions();
  const doc = editing && editing !== "new" ? editing : null;
  const [f, setF] = useState({ project: "", title: "", description: "", link: "" });
  const [file, setFile] = useState<File | null>(null);
  const [removeFile, setRemoveFile] = useState(false);
  const [audience, setAudience] = useState<"all" | "selected">("all");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!editing) return;
    setF({ project: doc?.project ?? "", title: doc?.title ?? "", description: doc?.description ?? "", link: doc?.link ?? "" });
    setFile(null); setRemoveFile(false); setAudience(doc?.audience ?? "all");
    setPicked(new Set(doc?.recipients.map((r) => r.id) ?? [])); setQ("");
  }, [editing, doc]);

  const people = (opts?.employees ?? []).filter((e) => e.status === "active");
  const shown = people.filter((e) => !q || `${e.full_name} ${e.emp_code} ${e.designation ?? ""} ${e.employment_type ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  const allShown = shown.length > 0 && shown.every((e) => picked.has(e.id));
  const flip = (id: number) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const save = useMutation({
    mutationFn: () => {
      const form = toForm({ ...f, audience, recipient_ids: JSON.stringify([...picked]), remove_file: removeFile }, { file });
      return doc ? api.post<{ document: ProjectDoc }>(`/projects/${doc.id}`, form) : api.post<{ document: ProjectDoc }>("/projects", form);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success(doc ? "Document updated" : audience === "all" ? "Shared with everyone" : `Shared with ${picked.size} ${picked.size === 1 ? "person" : "people"}`);
      onClose();
    },
  });
  const hasFile = !!file || (!!doc?.file_url && !removeFile);
  const canSave = f.project.trim() && f.title.trim() && (hasFile || f.link.trim()) && (audience === "all" || picked.size > 0);

  return (
    <Drawer open={!!editing} onClose={onClose} width={600} title={doc ? "Edit project document" : "Share a project document"}
      subtitle="Only the people you choose can open it."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" icon={<Check />} loading={save.isPending} disabled={!canSave} onClick={() => save.mutate()}>
          {doc ? "Save changes" : audience === "all" ? "Share with everyone" : `Share with ${picked.size || "…"} ${picked.size === 1 ? "person" : "people"}`}
        </Button></>}>
      <div className="space-y-5">
        <Field label="Project"><Input value={f.project} onChange={(e) => setF({ ...f, project: e.target.value })} list="project-names" placeholder="e.g. Acme Website Redesign" autoFocus maxLength={160} />
          <datalist id="project-names">{projects.map((p) => <option key={p} value={p} />)}</datalist></Field>
        <Field label="Document title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Requirements from kick-off meeting" maxLength={200} /></Field>
        <Field label="Notes" optional><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} className="min-h-[90px]" placeholder="What was discussed, what to do next…" /></Field>
        <Field label="File" optional={!!f.link.trim()} hint="PDF, Word, Excel, PowerPoint, images, CSV, ZIP · up to 15 MB">
          <FileDrop file={file} onFile={(x) => { setFile(x); if (x) setRemoveFile(false); }} accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.zip,.png,.jpg,.jpeg,.webp"
            label={doc?.file_url && !removeFile ? `Replace ${doc.file_name ?? "file"}` : "Drop a file or click to browse"} />
          {doc?.file_url && !file && <label className="mt-2 inline-flex items-center gap-2 text-[12.5px] text-fg-3 cursor-pointer"><input type="checkbox" className="accent-[#7c5cff]" checked={removeFile} onChange={(e) => setRemoveFile(e.target.checked)} /> Remove current file</label>}
        </Field>
        <Field label="Link" optional hint="Figma, Google Drive, a website…"><Input value={f.link} onChange={(e) => setF({ ...f, link: e.target.value })} placeholder="https://" /></Field>

        <Field label="Who can see it">
          <Segmented layoutId="proj-audience" value={audience} onChange={setAudience}
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
      </div>
    </Drawer>
  );
}
