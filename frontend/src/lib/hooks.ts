import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type { EmployeeBrief, Meta } from "./types";

export function useMeta() {
  return useQuery({ queryKey: ["meta"], queryFn: () => api.get<Meta>("/meta"), staleTime: Infinity }).data ?? {
    employment_types: ["Full-time", "Part-time", "Contract", "Freelancer", "Intern", "Trainee"],
    fixed_term_types: ["Contract", "Freelancer", "Intern", "Trainee"],
    stipend_types: ["Intern", "Trainee"],
    leave_types: ["Casual", "Sick", "Earned", "Unpaid", "Work from home", "Other"],
    task_priorities: ["Low", "Medium", "High", "Urgent"],
    expense_categories: ["Salary", "Server/Hosting", "Software", "Office", "Travel", "Marketing", "Equipment", "Other"],
    payment_methods: ["Bank Transfer", "UPI", "Cash", "Card", "Cheque", "Other"],
    income_statuses: ["Received", "Pending", "Partially Received"],
  };
}

export function useEmployeeOptions() {
  return useQuery({ queryKey: ["employee-options"], queryFn: () => api.get<{ employees: EmployeeBrief[] }>("/employees/options") });
}

export function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

/** Minimal form state helper: values + typed setter factory. */
export function useFormState<T extends Record<string, unknown>>(initial: T) {
  const [values, setValues] = useState<T>(initial);
  const bind = <K extends keyof T>(key: K) => ({
    value: (values[key] ?? "") as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setValues((v) => ({ ...v, [key]: e.target.value })),
  });
  const set = <K extends keyof T>(key: K, value: T[K]) => setValues((v) => ({ ...v, [key]: value }));
  return { values, setValues, bind, set };
}
