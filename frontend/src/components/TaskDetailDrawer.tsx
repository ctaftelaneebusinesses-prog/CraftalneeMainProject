import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { AlarmClock, CheckCircle2, Circle, CircleDot, ListChecks, MessageSquareText, Pencil, Plus, Send, Trash2, X } from "lucide-react";
import { api } from "@/lib/api";
import { cn, fmtDate, relative, today } from "@/lib/format";
import { can, useSession } from "@/lib/session";
import type { TaskDetail, TaskStatus } from "@/lib/types";
import { Avatar, Badge, Button, Input, Segmented, Skeleton, Textarea } from "@/components/ui/core";
import { Drawer } from "@/components/ui/overlay";
import { PriorityBadge } from "@/pages/Tasks";

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
];

/** Open a task: its checklist (the assignee's own to-do list) and progress notes. */
export function TaskDetailDrawer({ taskId, onClose, onEdit }: { taskId: number | null; onClose: () => void; onEdit: (t: TaskDetail) => void }) {
  const { user } = useSession();
  const qc = useQueryClient();
  const key = ["task", taskId];
  const { data, isLoading } = useQuery({ queryKey: key, queryFn: () => api.get<{ task: TaskDetail }>(`/tasks/${taskId}`), enabled: !!taskId });
  const t = data?.task;
  const [newItem, setNewItem] = useState("");
  const [note, setNote] = useState("");
  const [editingItem, setEditingItem] = useState<{ id: number; title: string } | null>(null);

  // Every change returns the fresh task; store it and refresh the board counters.
  const apply = (r: { task: TaskDetail }) => {
    qc.setQueryData(key, r);
    ["tasks", "nav-counts", "dashboard"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };
  const addItem = useMutation({ mutationFn: (title: string) => api.post<{ task: TaskDetail }>(`/tasks/${taskId}/items`, { title }), onSuccess: (r) => { apply(r); setNewItem(""); } });
  const updateItem = useMutation({
    mutationFn: ({ id, ...patch }: { id: number; done?: boolean; title?: string }) => api.put<{ task: TaskDetail }>(`/tasks/items/${id}`, patch),
    onMutate: ({ id, done }) => {  // tick instantly
      if (done === undefined) return;
      const prev = qc.getQueryData<{ task: TaskDetail }>(key);
      if (prev) qc.setQueryData(key, { task: { ...prev.task, items: prev.task.items.map((i) => (i.id === id ? { ...i, done } : i)) } });
    },
    onSuccess: (r) => { apply(r); setEditingItem(null); },
    onError: () => qc.invalidateQueries({ queryKey: key }),
  });
  const delItem = useMutation({ mutationFn: (id: number) => api.del<{ task: TaskDetail }>(`/tasks/items/${id}`), onSuccess: apply });
  const addNote = useMutation({ mutationFn: (body: string) => api.post<{ task: TaskDetail }>(`/tasks/${taskId}/notes`, { body }), onSuccess: (r) => { apply(r); setNote(""); toast.success("Note added"); } });
  const delNote = useMutation({ mutationFn: (id: number) => api.del<{ task: TaskDetail }>(`/tasks/notes/${id}`), onSuccess: apply });
  const move = useMutation({
    mutationFn: (status: TaskStatus) => api.put<{ task: TaskDetail }>(`/tasks/${taskId}`, { status }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: key }); ["tasks", "nav-counts", "dashboard", "org"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); if (r.task.status === "done") toast.success("Task completed 🎉"); },
  });

  const submitItem = (e: FormEvent) => { e.preventDefault(); if (newItem.trim()) addItem.mutate(newItem.trim()); };
  const submitNote = (e: FormEvent) => { e.preventDefault(); if (note.trim()) addNote.mutate(note.trim()); };
  const mayMove = !!t && (t.can_manage || t.assignee.id === user?.employee?.id);
  const pct = t && t.items.length ? Math.round((t.items.filter((i) => i.done).length / t.items.length) * 100) : 0;
  const overdue = t?.due_date && t.status !== "done" && t.due_date < today();

  return (
    <Drawer open={!!taskId} onClose={onClose} width={620}
      title={t ? <span className={cn(t.status === "done" && "line-through text-fg-3")}>{t.title}</span> : "Task"}
      subtitle={t ? `Assigned by ${t.created_by_name ?? "—"} · ${relative(t.created_at)}` : undefined}
      footer={t?.can_manage ? <Button variant="ghost" icon={<Pencil />} onClick={() => onEdit(t)}>Edit task</Button> : undefined}>
      {isLoading || !t ? (
        <div className="space-y-3"><Skeleton className="h-10" /><Skeleton className="h-24" /><Skeleton className="h-40" /></div>
      ) : (
        <div className="space-y-7">
          {/* summary */}
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <PriorityBadge p={t.priority} />
              {t.due_date && <Badge tone={overdue ? "bad" : "neutral"}><AlarmClock className="size-3" />{overdue ? "Overdue · " : "Due "}{fmtDate(t.due_date)}</Badge>}
              <span className="flex items-center gap-2 ml-auto text-[12.5px] text-fg-3"><Avatar person={t.assignee} size={22} />{t.assignee.full_name}</span>
            </div>
            {mayMove ? (
              <Segmented layoutId="task-detail-status" value={t.status} onChange={(s) => s !== t.status && move.mutate(s)} options={STATUS_OPTIONS} />
            ) : (
              <div className="flex items-center gap-2 text-[13px] text-fg-3">
                {t.status === "done" ? <CheckCircle2 className="size-4 text-good" /> : t.status === "in_progress" ? <CircleDot className="size-4 text-warn" /> : <Circle className="size-4 text-brand-300" />}
                {STATUS_OPTIONS.find((o) => o.value === t.status)?.label}
              </div>
            )}
            {t.description && <p className="text-[13.5px] text-fg-2 leading-relaxed whitespace-pre-wrap rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">{t.description}</p>}
          </div>

          {/* checklist */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <ListChecks className="size-4 text-brand-300" />
              <h3 className="font-display font-semibold text-[15px]">Checklist</h3>
              <span className="text-[12.5px] text-fg-4">{t.items.filter((i) => i.done).length} of {t.items.length} done</span>
            </div>
            {t.items.length > 0 && (
              <div className="flex items-center gap-3 mb-3">
                <div className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                  <motion.div className="h-full rounded-full" style={{ background: pct === 100 ? "#34d399" : "var(--grad)" }} animate={{ width: `${pct}%` }} transition={{ duration: 0.4 }} />
                </div>
                <span className="text-[12px] tnum text-fg-3 w-9 text-right">{pct}%</span>
              </div>
            )}
            <div className="space-y-1">
              <AnimatePresence initial={false}>
                {t.items.map((i) => (
                  <motion.div key={i.id} layout initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}
                    className="group flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-white/[0.035]">
                    <button type="button" disabled={!t.can_work} onClick={() => updateItem.mutate({ id: i.id, done: !i.done })}
                      aria-label={i.done ? "Mark as pending" : "Mark as complete"}
                      className={cn("grid place-items-center size-5 shrink-0 rounded-md border transition-colors",
                        i.done ? "bg-good border-good text-[#fff]" : "border-white/25 hover:border-brand-400", !t.can_work && "cursor-default")}>
                      {i.done && <CheckCircle2 className="size-3.5" />}
                    </button>
                    {editingItem?.id === i.id ? (
                      <form className="flex-1 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (editingItem.title.trim()) updateItem.mutate({ id: i.id, title: editingItem.title.trim() }); }}>
                        <Input autoFocus value={editingItem.title} onChange={(e) => setEditingItem({ id: i.id, title: e.target.value })} className="input-sm" />
                        <Button size="xs" type="submit" variant="primary">Save</Button>
                        <Button size="xs" variant="ghost" onClick={() => setEditingItem(null)}>Cancel</Button>
                      </form>
                    ) : (
                      <>
                        <span className={cn("flex-1 text-[13.5px]", i.done && "line-through text-fg-4")}>{i.title}</span>
                        <Badge tone={i.done ? "good" : "neutral"}>{i.done ? "Complete" : "Pending"}</Badge>
                        {t.can_work && (
                          <span className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button type="button" onClick={() => setEditingItem({ id: i.id, title: i.title })} className="p-1 rounded-md text-fg-4 hover:text-fg" aria-label="Rename"><Pencil className="size-3.5" /></button>
                            <button type="button" onClick={() => delItem.mutate(i.id)} className="p-1 rounded-md text-fg-4 hover:text-bad" aria-label="Delete"><X className="size-3.5" /></button>
                          </span>
                        )}
                      </>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
              {!t.items.length && <p className="px-3 py-2 text-[13px] text-fg-4">{t.can_work ? "Break this task into steps and tick them off as you go." : "No checklist yet."}</p>}
            </div>
            {t.can_work && (
              <form onSubmit={submitItem} className="mt-2 flex gap-2">
                <Input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder="Add a step, e.g. Fix the header spacing" maxLength={300} />
                <Button type="submit" icon={<Plus />} loading={addItem.isPending} disabled={!newItem.trim()}>Add</Button>
              </form>
            )}
          </section>

          {/* notes */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <MessageSquareText className="size-4 text-brand-300" />
              <h3 className="font-display font-semibold text-[15px]">Notes</h3>
              <span className="text-[12.5px] text-fg-4">Updates, blockers, links. Everyone on this task can read them.</span>
            </div>
            <form onSubmit={submitNote} className="space-y-2">
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Write an update…" className="min-h-[84px]" maxLength={5000}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submitNote(e); }} />
              <div className="flex items-center justify-between">
                <span className="text-[11.5px] text-fg-4">Ctrl + Enter to post</span>
                <Button size="sm" type="submit" variant="primary" icon={<Send />} loading={addNote.isPending} disabled={!note.trim()}>Add note</Button>
              </div>
            </form>
            <div className="mt-4 space-y-3">
              {[...t.notes].reverse().map((n) => (
                <div key={n.id} className="group rounded-xl border border-white/[0.07] bg-white/[0.02] p-3.5">
                  <div className="flex items-center gap-2 text-[12.5px]">
                    <span className="font-semibold text-fg">{n.author_name ?? "Someone"}</span>
                    <span className="text-fg-4">{relative(n.created_at)}</span>
                    {(n.author_id === user?.id || can(user, "team")) && (
                      <button type="button" onClick={() => delNote.mutate(n.id)} className="ml-auto p-1 rounded-md text-fg-4 opacity-0 group-hover:opacity-100 hover:text-bad transition-opacity" aria-label="Delete note"><Trash2 className="size-3.5" /></button>
                    )}
                  </div>
                  <p className="mt-1 text-[13.5px] text-fg-2 whitespace-pre-wrap leading-relaxed">{n.body}</p>
                </div>
              ))}
              {!t.notes.length && <p className="text-[13px] text-fg-4">No notes yet.</p>}
            </div>
          </section>
        </div>
      )}
    </Drawer>
  );
}
