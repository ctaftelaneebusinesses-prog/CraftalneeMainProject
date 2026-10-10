import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ChevronLeft, ChevronRight, ClipboardList, PhoneCall, UserX } from "lucide-react";
import { api } from "@/lib/api";
import { fmtDate, fmtDateTime } from "@/lib/format";
import type { EmployeeBrief } from "@/lib/types";
import { Avatar, Badge, Button, Card, CardHeader, EmptyState, Field, Input, PageHeader, PageSkeleton, Textarea } from "@/components/ui/core";

type CountKey = "calls_total" | "calls_left" | "rejected" | "no_response" | "demo_requested" | "video_requested";
type Update = Record<CountKey, number> & { id: number; day: string; followup_details: string | null; notes: string | null;
  employee: EmployeeBrief | null; created_at: string; updated_at: string };
type Data = { today: string; can_review: boolean; can_submit: boolean; day?: string; updates?: Update[];
  totals?: Record<CountKey, number>; missing?: EmployeeBrief[]; mine?: Update[] };

const COUNTS: { key: CountKey; label: string; short: string; hint?: string }[] = [
  { key: "calls_total", label: "Total calls made", short: "Calls" },
  { key: "calls_left", label: "Calls left (not done yet)", short: "Left" },
  { key: "rejected", label: "Rejected", short: "Rejected" },
  { key: "no_response", label: "Not responded", short: "No response" },
  { key: "demo_requested", label: "Asked for a demo", short: "Demo", hint: "Follow up later" },
  { key: "video_requested", label: "Asked for a video", short: "Video", hint: "Follow up later" },
];

const shift = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Today's update: team members report their calls each day; founders, the project manager and admins with the
 *  "Daily updates" area see everyone's numbers and who hasn't sent one. */
export default function DailyUpdates() {
  const [day, setDay] = useState("");
  const { data, isLoading } = useQuery({ queryKey: ["daily-updates", day], queryFn: () => api.get<Data>(`/daily-updates${day ? `?day=${day}` : ""}`) });
  if (isLoading || !data) return <PageSkeleton />;
  return data.can_review ? <Review data={data} setDay={setDay} /> : <Submit data={data} />;
}

function Review({ data, setDay }: { data: Data; setDay: (d: string) => void }) {
  const day = data.day ?? data.today;
  const rows = data.updates ?? [];
  const missing = data.missing ?? [];
  return (
    <>
      <PageHeader eyebrow="Work" title="Daily updates" subtitle="Everyone's call report for the day — and who hasn't sent one yet."
        actions={<div className="flex items-center gap-1.5">
          <Button iconOnly variant="ghost" icon={<ChevronLeft />} title="Previous day" onClick={() => setDay(shift(day, -1))} />
          <Input type="date" className="w-[160px]" value={day} max={data.today} onChange={(e) => e.target.value && setDay(e.target.value)} />
          <Button iconOnly variant="ghost" icon={<ChevronRight />} title="Next day" disabled={day >= data.today} onClick={() => setDay(shift(day, 1))} />
          {day !== data.today && <Button size="sm" onClick={() => setDay(data.today)}>Today</Button>}
        </div>} />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
        {COUNTS.map((c) => (
          <Card key={c.key} className="p-4">
            <div className="text-[12px] text-fg-3">{c.short}</div>
            <div className="mt-1 font-display text-[24px] font-bold tnum">{data.totals?.[c.key] ?? 0}</div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-5 items-start">
        <Card className="overflow-hidden">
          <CardHeader icon={<ClipboardList />} title={`Updates · ${fmtDate(day)}`} subtitle={`${rows.length} sent`} />
          {!rows.length ? <EmptyState icon={<PhoneCall />} title="No updates for this day" text="When someone sends today's update it shows up here." />
            : <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead><tr className="text-left text-fg-3 border-b divider">
                  <th className="px-5 py-2.5 font-medium">Person</th>
                  {COUNTS.map((c) => <th key={c.key} className="px-3 py-2.5 font-medium text-right whitespace-nowrap">{c.short}</th>)}
                </tr></thead>
                <tbody className="divide-y divider">
                  {rows.map((u) => (
                    <tr key={u.id} className="align-top">
                      <td className="px-5 py-3 min-w-[220px]">
                        <div className="flex items-center gap-2.5">
                          {u.employee && <Avatar person={u.employee} size={28} />}
                          <div className="min-w-0">
                            <div className="font-medium truncate">{u.employee?.full_name ?? "—"}</div>
                            <div className="text-[11.5px] text-fg-4">Sent {fmtDateTime(u.updated_at)}</div>
                          </div>
                        </div>
                        {u.followup_details && <p className="mt-2 text-[12.5px] text-fg-2 whitespace-pre-wrap"><span className="text-brand-300 font-medium">Follow up: </span>{u.followup_details}</p>}
                        {u.notes && <p className="mt-1 text-[12.5px] text-fg-3 whitespace-pre-wrap">{u.notes}</p>}
                      </td>
                      {COUNTS.map((c) => <td key={c.key} className="px-3 py-3 text-right tnum">{u[c.key]}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>}
        </Card>

        <Card>
          <CardHeader icon={<UserX />} title="Not sent yet" subtitle={missing.length ? `${missing.length} ${missing.length === 1 ? "person" : "people"}` : "Everyone has sent one"} />
          <div className="px-4 pb-4 space-y-1">
            {missing.map((e) => (
              <div key={e.id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
                <Avatar person={e} size={26} />
                <span className="flex-1 min-w-0 truncate text-[13px]">{e.full_name}</span>
                <span className="text-[11.5px] text-fg-4">{e.employment_type}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}

const EMPTY = { calls_total: "", calls_left: "", rejected: "", no_response: "", demo_requested: "", video_requested: "", followup_details: "", notes: "" };

function Submit({ data }: { data: Data }) {
  const qc = useQueryClient();
  const [day, setDay] = useState(data.today);
  const [f, setF] = useState(EMPTY);
  const existing = data.mine?.find((u) => u.day === day);

  useEffect(() => {
    setF(existing ? { ...Object.fromEntries(COUNTS.map((c) => [c.key, String(existing[c.key])])), followup_details: existing.followup_details ?? "", notes: existing.notes ?? "" } as typeof EMPTY : EMPTY);
  }, [existing, day]);

  const save = useMutation({
    mutationFn: () => api.post("/daily-updates", { day, ...f }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["daily-updates"] }); toast.success(existing ? "Update saved" : "Today's update sent"); },
  });
  if (!data.can_submit) return (<><PageHeader eyebrow="Work" title="Daily update" /><Card><EmptyState icon={<ClipboardList />} title="Nothing to send" text="Daily updates are sent by team members." /></Card></>);

  const n = (k: CountKey) => Number(f[k] || 0);
  const tooMany = n("rejected") + n("no_response") + n("demo_requested") + n("video_requested") > n("calls_total");
  const asked = n("demo_requested") + n("video_requested");
  const minDay = shift(data.today, -7);

  return (
    <>
      <PageHeader eyebrow="Work" title="Today's update" subtitle="Send your call numbers at the end of each day. The founder and project manager see them." />
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-5 items-start">
        <Card>
          <CardHeader icon={<PhoneCall />} title={day === data.today ? "Today" : fmtDate(day)}
            subtitle={existing ? `Sent ${fmtDateTime(existing.updated_at)} — you can still change it` : "Not sent yet"}
            action={<Input type="date" className="w-[160px]" value={day} min={minDay} max={data.today} onChange={(e) => e.target.value && setDay(e.target.value)} />} />
          <form className="px-6 pb-6 space-y-5" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {COUNTS.map((c) => (
                <Field key={c.key} label={c.label} hint={c.hint}>
                  <Input type="number" inputMode="numeric" min={0} max={100000} value={f[c.key]} placeholder="0" onChange={(e) => setF({ ...f, [c.key]: e.target.value })} />
                </Field>
              ))}
            </div>
            {tooMany && <p className="text-[12.5px] text-bad">Rejected, not responded, demo and video together can't be more than total calls made.</p>}
            <Field label="Who asked for a demo / video" optional={!asked} hint="Name, phone or business — so we can follow up later">
              <Textarea value={f.followup_details} onChange={(e) => setF({ ...f, followup_details: e.target.value })} className="min-h-[80px]" placeholder={"e.g. Ravi – Sri Sai Traders – 98xxxxxx10 (demo)\nPriya – Bloom Salon (video)"} />
            </Field>
            <Field label="Notes" optional><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className="min-h-[70px]" placeholder="Anything else from today…" /></Field>
            <div className="flex justify-end">
              <Button variant="primary" type="submit" icon={<Check />} loading={save.isPending} disabled={!f.calls_total || tooMany}>{existing ? "Save changes" : "Send update"}</Button>
            </div>
          </form>
        </Card>

        <Card>
          <CardHeader icon={<ClipboardList />} title="Your recent updates" />
          <div className="px-4 pb-4 space-y-1.5">
            {!data.mine?.length && <p className="px-2 text-[13px] text-fg-4">None yet.</p>}
            {data.mine?.slice(0, 20).map((u) => (
              <button key={u.id} onClick={() => u.day >= minDay && setDay(u.day)} className="w-full text-left rounded-lg px-2 py-2 hover:bg-white/[0.04]">
                <div className="flex items-center justify-between gap-2 text-[13px]">
                  <span className="font-medium">{u.day === data.today ? "Today" : fmtDate(u.day)}</span>
                  <Badge tone="brand">{u.calls_total} calls</Badge>
                </div>
                <div className="mt-1 text-[11.5px] text-fg-4">{u.rejected} rejected · {u.no_response} no response · {u.demo_requested} demo · {u.video_requested} video · {u.calls_left} left</div>
              </button>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
