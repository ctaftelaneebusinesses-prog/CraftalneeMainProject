import { Banknote, BriefcaseBusiness, Link2, CalendarDays, DoorOpen, FileSignature, FileText, FolderOpen, Handshake, LayoutDashboard,
  FolderKanban, ListTodo, Megaphone, MessageSquareWarning, Network, PhoneCall, Receipt, ReceiptText, Scale, Send, Settings, TrendingDown, TrendingUp, User, UserPlus, Users, Wallet,
  type LucideIcon } from "lucide-react";
import type { Area, NavCounts, User as SessionUser } from "@/lib/types";
import { can } from "@/lib/session";

/** `area`: the console area needed to see the item (founder-granted); none = every admin. */
export interface NavItem { to: string; label: string; icon: LucideIcon; end?: boolean; badge?: keyof NavCounts; area?: Area }
export interface NavGroup { label?: string; items: NavItem[] }

const ADMIN_NAV: NavGroup[] = [
  { items: [
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/employees", label: "Employees", icon: Users, area: "employees" },
    { to: "/team", label: "Team tree", icon: Network },
  ] },
  { label: "Work", items: [
    { to: "/tasks", label: "Tasks", icon: ListTodo, badge: "my_open_tasks" },
    { to: "/leaves", label: "Leaves", icon: CalendarDays, badge: "pending_leaves" },
    { to: "/announcements", label: "Announcements", icon: Megaphone, badge: "unread_announcements" },
    { to: "/projects", label: "Project documents", icon: FolderKanban },
    { to: "/shared-links", label: "Shared links", icon: Link2 },
    { to: "/complaints", label: "Complaints", icon: MessageSquareWarning, badge: "open_complaints" },
  ] },
  { label: "Payroll", items: [
    { to: "/payroll", label: "Payroll", icon: Wallet, area: "payroll" },
    { to: "/payslips", label: "Payslips", icon: Receipt, area: "payroll" },
  ] },
  { label: "Documents", items: [
    { to: "/documents", label: "All documents", icon: FolderOpen, area: "documents" },
    { to: "/mous", label: "MOU", icon: Handshake, area: "documents" },
    { to: "/letters/offer", label: "Offer letters", icon: Send, area: "documents" },
    { to: "/letters/joining", label: "Joining letters", icon: BriefcaseBusiness, area: "documents" },
    { to: "/letters/relieving", label: "Relieving letters", icon: DoorOpen, area: "documents" },
  ] },
  { label: "Finance", items: [
    { to: "/finance", label: "Balance", icon: Scale, end: true, area: "finance" },
    { to: "/finance/income", label: "Income", icon: TrendingUp, area: "finance" },
    { to: "/finance/expenses", label: "Expenses", icon: TrendingDown, area: "finance" },
    { to: "/finance/invoices", label: "Invoices", icon: ReceiptText, area: "finance" },
  ] },
  { label: "Clients", items: [
    { to: "/followups", label: "Follow-ups", icon: PhoneCall, badge: "followups_due", area: "followups" },
  ] },
];

const MY_WORKSPACE: NavItem[] = [
  { to: "/me/profile", label: "My profile", icon: User },
  { to: "/me/documents", label: "My documents", icon: FileText },
  { to: "/me/payslips", label: "My payslips", icon: Receipt },
];

const EMPLOYEE_NAV: NavGroup[] = [
  { items: [
    { to: "/me", label: "Dashboard", icon: LayoutDashboard, end: true },
    { to: "/tasks", label: "Tasks", icon: ListTodo, badge: "my_open_tasks" },
    { to: "/leaves", label: "Leaves", icon: CalendarDays },
    { to: "/announcements", label: "Announcements", icon: Megaphone, badge: "unread_announcements" },
    { to: "/projects", label: "Project documents", icon: FolderKanban },
    { to: "/shared-links", label: "Shared links", icon: Link2 },
    { to: "/complaints", label: "Complaints", icon: MessageSquareWarning },
    { to: "/team", label: "Team tree", icon: Network },
  ] },
  { label: "Me", items: MY_WORKSPACE },
];

/** Keep only what the user's granted areas allow; drop groups left empty. */
export function allowed<T extends { area?: Area }>(user: SessionUser | null, items: T[]) {
  return items.filter((i) => !i.area || can(user, i.area));
}

function trim(user: SessionUser | null, groups: NavGroup[]) {
  return groups.map((g) => ({ ...g, items: allowed(user, g.items) })).filter((g) => g.items.length);
}

export function navFor(user: SessionUser | null): NavGroup[] {
  if (!user) return [];
  if (!user.is_admin) return EMPLOYEE_NAV;
  const groups = [...ADMIN_NAV];
  if (user.employee) groups.push({ label: "My workspace", items: MY_WORKSPACE });
  else if (user.is_owner) groups.push({ label: "Me", items: [{ to: "/profile", label: "My profile", icon: User }] });
  groups.push({ items: [{ to: "/settings", label: "Settings", icon: Settings, area: "settings" }] });
  return trim(user, groups);
}

/** Flat list used by the command palette. */
export const FOUNDER_NAV = ADMIN_NAV.concat([{ items: [{ to: "/settings", label: "Settings", icon: Settings, area: "settings" }] }]);

export const QUICK_ACTIONS: { to: string; label: string; icon: LucideIcon; area?: Area }[] = [
  { to: "/employees/new", label: "Add employee", icon: UserPlus, area: "employees" },
  { to: "/tasks?new=1", label: "Assign a task", icon: ListTodo },
  { to: "/announcements", label: "Post an announcement", icon: Megaphone, area: "announcements" },
  { to: "/leaves?new=1", label: "Add leave / holiday", icon: CalendarDays },
  { to: "/payroll", label: "Run payroll", icon: Wallet, area: "payroll" },
  { to: "/letters/offer/new", label: "Create offer letter", icon: Send, area: "documents" },
  { to: "/letters/joining/new", label: "Create joining letter", icon: FileSignature, area: "documents" },
  { to: "/letters/relieving/new", label: "Create relieving letter", icon: DoorOpen, area: "documents" },
  { to: "/mous/new", label: "Create MOU", icon: Handshake, area: "documents" },
  { to: "/projects?new=1", label: "Share a project document", icon: FolderKanban, area: "projects" },
  { to: "/followups?new=1", label: "Add client follow-up", icon: PhoneCall, area: "followups" },
  { to: "/finance/invoices/new", label: "Create invoice", icon: ReceiptText, area: "finance" },
  { to: "/finance/income?new=1", label: "Record income", icon: TrendingUp, area: "finance" },
  { to: "/finance/expenses?new=1", label: "Record expense", icon: Banknote, area: "finance" },
];
