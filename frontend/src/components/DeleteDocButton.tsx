import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/core";
import { useConfirm } from "@/components/ui/overlay";

/** Kinds of stored documents that can be deleted (payslips follow payroll and can't). */
export type DeletableKind = "offer" | "joining" | "relieving" | "mou" | "doc";
export const DELETABLE = new Set<string>(["offer", "joining", "relieving", "mou", "doc"]);

const ENDPOINT: Record<DeletableKind, (id: number) => Promise<unknown>> = {
  offer: (id) => api.del(`/letters/offer/${id}`),
  joining: (id) => api.del(`/letters/joining/${id}`),
  relieving: (id) => api.del(`/letters/relieving/${id}`),
  mou: (id) => api.del(`/mous/${id}`),
  doc: (id) => api.post(`/employee-documents/${id}/delete`),
};

/** Trash button: confirms (type the number to be sure), deletes the record and its PDF, refreshes every list. */
export function DeleteDocButton({ kind, id, number, label = "document", onDeleted, full }: {
  kind: DeletableKind; id: number; number: string; label?: string; onDeleted?: () => void; full?: boolean;
}) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const del = useMutation({
    mutationFn: () => ENDPOINT[kind](id),
    onSuccess: () => {
      ["letters", "mous", "mou", "documents", "employee", "dashboard", "search"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast.success(`${number} deleted`);
      onDeleted?.();
    },
  });
  const ask = async () => {
    if (await confirm({
      title: `Delete ${number}?`, danger: true, confirmText: "Delete forever", requireText: kind === "doc" ? undefined : number,
      message: `This permanently removes the ${label} and its PDF. Archive it instead if you only want it out of the way.`,
    })) del.mutate();
  };
  return full
    ? <Button variant="danger" icon={<Trash2 />} loading={del.isPending} onClick={ask}>Delete</Button>
    : <Button size="sm" variant="ghost" iconOnly icon={<Trash2 />} title="Delete" loading={del.isPending} onClick={ask} className="hover:text-bad" />;
}
