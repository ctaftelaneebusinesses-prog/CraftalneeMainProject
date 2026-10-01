// Mirrors the serialisers in craftlanee/api/common.py

export type Role = "founder" | "employee";

export interface EmployeeBrief {
  id: number;
  emp_code: string;
  full_name: string;
  initials: string;
  designation: string | null;
  department: string | null;
  email: string | null;
  phone: string | null;
  joining_date: string | null;
  employment_type: string | null;
  monthly_salary: number | null;   // null when the viewer isn't allowed to see it
  status: "active" | "inactive";
  photo_url: string | null;
  roles: string[];
  manager_id: number | null;
  end_date: string | null;
  is_admin: boolean;      // has any admin access
  full_access: boolean;   // has every area, same as the founder
}

export interface EmployeeFull extends EmployeeBrief {
  date_of_birth: string | null;
  address: string | null;
  work_location: string | null;
  reporting_person: string | null;
  salary_effective_date: string | null;
  bank_name: string | null;
  bank_account_name?: string | null;
  bank_account_number?: string | null;
  bank_account_masked?: string | null;
  bank_ifsc: string | null;
  manager: { id: number; full_name: string } | null;
  created_at: string | null;
  college: string | null;            // interns & trainees
  study_department: string | null;   // department / course at college
  experience_level: "fresher" | "experienced" | null;
  experience_years: number | null;
  previous_company: string | null;
  resume_name: string | null;
  resume_url: string | null;
}

/** Console areas the founder can grant (mirrors PERMISSIONS in craftlanee/models.py). */
export type Area = "employees" | "payroll" | "documents" | "finance" | "leaves" | "team" | "settings" | "announcements" | "followups";
export interface AreaInfo { key: Area; label: string; description: string }

export interface LoginInfo { email: string; active: boolean; is_admin: boolean; permissions: Area[]; last_login_at: string | null }

export interface EmployeeProfile extends EmployeeFull {
  login: LoginInfo | null;
  offer_letters: OfferLetter[];
  joining_letters: JoiningLetter[];
  relieving_letters: RelievingLetter[];
  payslips: Payslip[];
  documents: EmployeeDocument[];
  payroll: PayrollRow[];
  reports: EmployeeBrief[];   // people who report directly to this employee
}

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  is_admin: boolean;   // founder, or an employee granted at least one area → admin console
  is_owner: boolean;   // the founder
  permissions: Area[]; // console areas this user may use (all of them for the founder)
  full_access: boolean; // has every area
  can_edit_signatures: boolean; // the one founder login allowed to change the PDF signatures
  employee: EmployeeBrief | null;
}

export interface Company {
  company_name: string;
  tagline: string | null;
  logo_url: string | null;
}

export interface CompanySettings extends Company {
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  gstin: string | null;
  founder_name: string | null;
  founder_designation: string | null;
  offer_terms: string | null;
  internship_terms: string | null;
  joining_body: string | null;
  relieving_body: string | null;
  mou_terms: string | null;
  signature_url: string | null;
  hr_name: string | null;
  hr_designation: string | null;
  hr_signature_url: string | null;
  show_name_with_logo: boolean;
  letterhead_url: string | null;
}

export interface Session {
  user: User | null;
  csrf: string;
  setup_required: boolean;
  setup_code_required?: boolean;  // hosted server with CRAFTLANEE_SETUP_CODE set
  company: Company | null;
}

interface LetterBase {
  id: number;
  number: string;
  employee_id: number;
  employee_name: string;
  emp_code: string | null;
  letter_date: string;
  designation: string | null;
  department: string | null;
  joining_date: string | null;
  salary: number;
  archived: boolean;
  created_at: string;
  file_url: string;
}
export interface OfferLetter extends LetterBase {
  kind: "offer";
  candidate_name: string;
  address: string | null;
  employment_type: string | null;
  work_location: string | null;
  reporting_person: string | null;
  end_date: string | null;
  letter_type: "employment" | "internship";
  intro: string;
  terms: string;
}
export interface JoiningLetter extends LetterBase {
  kind: "joining";
  reporting_person: string | null;
  employment_type: string | null;
  work_location: string | null;
  body: string;
}
export interface RelievingLetter extends LetterBase {
  kind: "relieving";
  employment_type: string | null;
  resignation_date: string | null;
  last_working_day: string | null;
  body: string;
}
export type Letter = OfferLetter | JoiningLetter | RelievingLetter;
export type LetterKind = "offer" | "joining" | "relieving";

export interface Mou {
  id: number;
  number: string;
  party_name: string;
  contact_person: string | null;
  address: string | null;
  start_date: string | null;
  end_date: string | null;
  purpose: string | null;
  scope: string | null;
  payment_terms: string | null;
  responsibilities: string | null;
  terms: string | null;
  signatory: string | null;
  signatory_designation: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
  file_url: string;
}

export interface Payslip {
  id: number;
  number: string;
  month: string;
  net: number;
  employee_id: number;
  employee: EmployeeBrief | null;
  created_at: string;
  updated_at: string;
  file_url: string;
}

export interface PayrollRow {
  id: number;
  month: string;
  employee: EmployeeBrief;
  basic: number;
  allowances: number;
  deductions: number;
  bonus: number;
  net: number;
  notes: string | null;
  status: "draft" | "finalized";
  finalized_at: string | null;
  payslip: { id: number; number: string; file_url: string } | null;
}

export interface PayrollMonth {
  month: string;
  label: string;
  rows: PayrollRow[];
  totals: Record<"basic" | "allowances" | "deductions" | "bonus" | "net", number>;
  drafts: number;
  finalized: number;
  missing_payslips: number;
  addable: EmployeeBrief[];
  expenses: Expense[];
  posted?: number;
  generated?: number;
}

export interface EmployeeDocument {
  id: number;
  employee_id: number;
  title: string;
  notes: string | null;
  original_name: string | null;
  visible_to_employee: boolean;
  archived: boolean;
  created_at: string;
  file_url: string;
}

export interface Income {
  id: number;
  code: string;
  date: string;
  source: string;
  client: string | null;
  description: string | null;
  amount: number;
  payment_status: "Received" | "Pending" | "Partially Received";
  notes: string | null;
  invoice: { id: number; number: string } | null;   // set when recorded from a paid invoice (locked)
  created_at: string;
}

export interface Expense {
  id: number;
  code: string;
  date: string;
  category: string;
  description: string;
  amount: number;
  paid_by: string | null;
  payment_method: string | null;
  notes: string | null;
  payroll_month: string | null;
  is_payroll: boolean;
  receipt_name: string | null;
  receipt_url: string | null;
  created_at: string;
}

export interface Totals {
  income: number;
  pending_income: number;
  expenses: number;
  payroll: number;
  other_expenses: number;
  balance: number;
}

export interface TrendPoint { month: string; label: string; income: number; expenses: number; balance: number }
export interface CategoryAmount { category: string; amount: number }

export interface AuditEntry {
  id: number;
  user_name: string;
  action: string;
  category: string | null;
  details: string | null;
  created_at: string;
}

export interface DocItem {
  type: string;
  kind: "mou" | "offer" | "joining" | "relieving" | "payslip" | "doc";
  id: number;
  number: string;
  title: string;
  subtitle: string;
  date: string;
  employee_id: number | null;
  archived: boolean;
  file_url: string;
}

export interface Period { period: string; label: string; start: string | null; end: string | null }

export interface Meta {
  employment_types: string[];
  fixed_term_types: string[];
  stipend_types: string[];
  leave_types: string[];
  task_priorities: string[];
  expense_categories: string[];
  payment_methods: string[];
  income_statuses: string[];
}

export type LeaveStatus = "pending" | "approved" | "rejected" | "cancelled";
export interface Leave {
  id: number;
  employee: EmployeeBrief;
  leave_type: string;
  start_date: string;
  end_date: string;
  half_day: boolean;
  days: number;
  status: LeaveStatus;
  source: string;
  created_at: string;
  reason?: string | null;
  decided_by?: string | null;
  decided_at?: string | null;
  decision_note?: string | null;
}
export interface Holiday { id: number; date: string; name: string }

export type TaskStatus = "todo" | "in_progress" | "done";
export interface Task {
  id: number;
  title: string;
  description: string | null;
  assignee: EmployeeBrief;
  created_by_id: number | null;
  created_by_name: string | null;
  due_date: string | null;
  priority: "Low" | "Medium" | "High" | "Urgent";
  status: TaskStatus;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  items_total: number;
  items_done: number;
  notes_count: number;
}

export interface TaskItem { id: number; title: string; done: boolean; done_at: string | null; created_by_name: string | null; created_at: string }
export interface TaskNote { id: number; body: string; author_id: number | null; author_name: string | null; created_at: string }
export interface TaskDetail extends Task {
  items: TaskItem[];
  notes: TaskNote[];
  can_work: boolean;    // may edit the checklist (assignee, assigner, Team admin)
  can_manage: boolean;  // may edit / delete the task itself
}

export interface OrgNode extends EmployeeBrief { open_tasks: number; on_leave: boolean }
export interface NavCounts { my_open_tasks: number; pending_leaves: number; assigned_open: number; my_pending_leaves: number; can_assign: boolean; unread_announcements: number; followups_due: number }

export type InvoiceStatus = "unpaid" | "paid" | "cancelled";
export interface InvoiceLine { description: string; qty: number; rate: number; amount: number }
export interface InvoiceClient { client_name: string; client_address: string | null; client_email: string | null; client_phone: string | null; client_gstin: string | null }
export interface Invoice extends InvoiceClient {
  id: number;
  number: string;              // CL-INV-2026-0001
  invoice_date: string;
  due_date: string | null;
  items: InvoiceLine[];
  tax_label: string;
  tax_rate: number;            // percent
  discount: number;
  subtotal: number;
  tax_amount: number;
  total: number;
  notes: string | null;        // payment details
  terms: string | null;
  status: InvoiceStatus;
  overdue: boolean;
  paid_date: string | null;
  payment_method: string | null;
  income: { id: number; code: string } | null;
  created_at: string;
  updated_at: string;
  file_url: string | null;
}
export interface InvoiceSummary { outstanding: number; overdue: number; overdue_count: number; unpaid_count: number; paid_this_year: number }

export interface AnnouncementLink { url: string; label: string }
export interface Announcement {
  id: number;
  title: string;
  body: string | null;
  links: AnnouncementLink[];
  audience: "all" | "selected";
  recipients: { id: number; full_name: string }[];
  photos: { id: number; url: string; name: string | null }[];
  pinned: boolean;
  author_name: string | null;
  created_at: string;
  updated_at: string;
  edited: boolean;
  read: boolean;
  reach?: number;   // managers only: how many active people it reaches
  seen?: number;    // managers only: how many of them have opened it
}

// Client / lead follow-ups (craftlanee/api/followups.py)
export type LeadStatus = "new" | "contacted" | "in_talks" | "proposal" | "won" | "lost";
export type LeadDue = "overdue" | "today" | "upcoming" | "none" | "closed";
export interface LeadActivity { id: number; kind: string; body: string; author_name: string | null; created_at: string }
export interface Lead {
  id: number;
  code: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  source: string | null;
  interest: string | null;
  est_value: number | null;
  status: LeadStatus;
  next_followup: string | null;
  next_followup_time: string | null;   // "HH:MM"; none = reminded at 9:00
  remind_at: string | null;            // date + time the reminder fires
  due: LeadDue;
  notes: string | null;
  closed_at: string | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  activity_count: number;
  last_activity: LeadActivity | null;
  activities?: LeadActivity[];   // only on the single-lead endpoints
}
export interface FollowupCounts { overdue: number; today: number; week: number; open: number; no_date: number; pipeline: number; won: number; lost: number }
export interface EmailReminderSettings {
  enabled: boolean; ready: boolean; smtp_host: string | null; smtp_port: number; smtp_user: string | null; smtp_from: string | null;
  password_set: boolean; app_url: string; recipients: { name: string; email: string }[];
}
