import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { Company, EmployeeDocument, EmployeeFull, JoiningLetter, OfferLetter, Payslip, RelievingLetter } from "@/lib/types";

export interface MeData {
  employee: EmployeeFull;
  payslips: Payslip[];
  documents: { offer: OfferLetter[]; joining: JoiningLetter[]; relieving: RelievingLetter[]; other: EmployeeDocument[] };
  company: Company;
}

/** Everything the employee portal shows — the server scopes it to the signed-in employee. */
export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: () => api.get<MeData>("/me") });
}
