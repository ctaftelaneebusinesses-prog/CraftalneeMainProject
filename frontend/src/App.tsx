import { lazy, Suspense, useEffect, type ComponentType, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { can, useSession } from "@/lib/session";
import type { Area } from "@/lib/types";
import { AppShell } from "@/components/layout/AppShell";
import { PageSkeleton } from "@/components/ui/core";
import { Splash } from "@/components/Splash";
import Login from "@/pages/auth/Login";
import Setup from "@/pages/auth/Setup";

// Every page is code-split; once signed in, all of them are fetched in the background so switching pages
// (or going back) never waits on a download.
const loaders: (() => Promise<unknown>)[] = [];
function page<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {  // eslint-disable-line @typescript-eslint/no-explicit-any
  loaders.push(load);
  return lazy(load);
}
function preloadPages() {
  const run = () => loaders.forEach((load) => { load().catch(() => {}); });
  if ("requestIdleCallback" in window) window.requestIdleCallback(run, { timeout: 3000 });
  else setTimeout(run, 1500);
}

const Dashboard = page(() => import("@/pages/founder/Dashboard"));
const Employees = page(() => import("@/pages/founder/Employees"));
const EmployeeForm = page(() => import("@/pages/founder/EmployeeForm"));
const EmployeeProfile = page(() => import("@/pages/founder/EmployeeProfile"));
const Letters = page(() => import("@/pages/founder/Letters"));
const LetterEditor = page(() => import("@/pages/founder/LetterEditor"));
const Mous = page(() => import("@/pages/founder/Mous"));
const MouEditor = page(() => import("@/pages/founder/MouEditor"));
const MouView = page(() => import("@/pages/founder/MouView"));
const Payroll = page(() => import("@/pages/founder/Payroll"));
const PayrollMonth = page(() => import("@/pages/founder/PayrollMonth"));
const Payslips = page(() => import("@/pages/founder/Payslips"));
const Documents = page(() => import("@/pages/founder/Documents"));
const Finance = page(() => import("@/pages/founder/Finance"));
const IncomePage = page(() => import("@/pages/founder/Income"));
const ExpensesPage = page(() => import("@/pages/founder/Expenses"));
const Invoices = page(() => import("@/pages/founder/Invoices"));
const InvoiceEditor = page(() => import("@/pages/founder/InvoiceEditor"));
const InvoiceView = page(() => import("@/pages/founder/InvoiceView"));
const Followups = page(() => import("@/pages/founder/Followups"));
const Settings = page(() => import("@/pages/founder/Settings"));
const AuditLog = page(() => import("@/pages/founder/AuditLog"));
const Account = page(() => import("@/pages/Account"));
const Leaves = page(() => import("@/pages/Leaves"));
const Tasks = page(() => import("@/pages/Tasks"));
const TeamTree = page(() => import("@/pages/TeamTree"));
const Announcements = page(() => import("@/pages/Announcements"));
const Projects = page(() => import("@/pages/Projects"));
const Complaints = page(() => import("@/pages/Complaints"));
const Sheets = page(() => import("@/pages/Sheets"));
const PortalHome = page(() => import("@/pages/portal/Home"));
const PortalProfile = page(() => import("@/pages/portal/Profile"));
const PortalDocuments = page(() => import("@/pages/portal/Documents"));
const PortalPayslips = page(() => import("@/pages/portal/Payslips"));


/** "founder" = admin console (founder or founder-granted admin), optionally one granted `area`;
 *  "employee" = needs an employee record. */
function RequireRole({ role, area, children }: { role: "founder" | "employee"; area?: Area; children: ReactNode }) {
  const { user } = useSession();
  const location = useLocation();
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  const allowed = role === "founder" ? user.is_admin && (!area || can(user, area)) : !!user.employee;
  if (!allowed) return <Navigate to={user.is_admin ? "/dashboard" : "/me"} replace />;
  return <>{children}</>;
}

function Home() {
  const { user } = useSession();
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={user.is_admin ? "/dashboard" : "/me"} replace />;
}

export default function App() {
  const { session, user, loading } = useSession();
  useEffect(() => { if (user) preloadPages(); }, [user]);
  if (loading || !session) return <Splash />;
  if (session.setup_required) return <Routes><Route path="*" element={<Setup />} /></Routes>;

  const founder = (el: ReactNode, area?: Area) => <RequireRole role="founder" area={area}>{el}</RequireRole>;
  const employee = (el: ReactNode) => <RequireRole role="employee">{el}</RequireRole>;

  return (
    <Suspense fallback={<Splash />}>
      <Routes>
        <Route path="/login" element={user ? <Home /> : <Login />} />
        <Route path="/setup" element={<Navigate to="/" replace />} />
        <Route path="/" element={<Home />} />
        <Route element={user ? <AppShell /> : <Navigate to="/login" replace />}>
          <Route path="/account" element={<Suspense fallback={<PageSkeleton />}><Account /></Suspense>} />
          <Route path="/leaves" element={<Leaves />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/team" element={<TeamTree />} />
          <Route path="/announcements" element={<Announcements />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/complaints" element={<Complaints />} />
          <Route path="/sheets" element={<Sheets />} />
          {/* founder */}
          <Route path="/dashboard" element={founder(<Dashboard />)} />
          <Route path="/employees" element={founder(<Employees />, "employees")} />
          <Route path="/employees/new" element={founder(<EmployeeForm />, "employees")} />
          <Route path="/employees/:id" element={founder(<EmployeeProfile />, "employees")} />
          <Route path="/employees/:id/edit" element={founder(<EmployeeForm />, "employees")} />
          <Route path="/letters/:kind" element={founder(<Letters />, "documents")} />
          <Route path="/letters/:kind/new" element={founder(<LetterEditor />, "documents")} />
          <Route path="/letters/:kind/:id" element={founder(<LetterEditor />, "documents")} />
          <Route path="/mous" element={founder(<Mous />, "documents")} />
          <Route path="/mous/new" element={founder(<MouEditor />, "documents")} />
          <Route path="/mous/:id" element={founder(<MouView />, "documents")} />
          <Route path="/mous/:id/edit" element={founder(<MouEditor />, "documents")} />
          <Route path="/payroll" element={founder(<Payroll />, "payroll")} />
          <Route path="/payroll/:month" element={founder(<PayrollMonth />, "payroll")} />
          <Route path="/payslips" element={founder(<Payslips />, "payroll")} />
          <Route path="/documents" element={founder(<Documents />, "documents")} />
          <Route path="/finance" element={founder(<Finance />, "finance")} />
          <Route path="/finance/income" element={founder(<IncomePage />, "finance")} />
          <Route path="/finance/expenses" element={founder(<ExpensesPage />, "finance")} />
          <Route path="/finance/invoices" element={founder(<Invoices />, "finance")} />
          <Route path="/finance/invoices/new" element={founder(<InvoiceEditor />, "finance")} />
          <Route path="/finance/invoices/:id" element={founder(<InvoiceView />, "finance")} />
          <Route path="/finance/invoices/:id/edit" element={founder(<InvoiceEditor />, "finance")} />
          <Route path="/followups" element={founder(<Followups />, "followups")} />
          <Route path="/settings" element={founder(<Settings />, "settings")} />
          <Route path="/settings/audit" element={user?.is_primary ? <AuditLog /> : <Navigate to="/dashboard" replace />} />
          {/* employee */}
          <Route path="/me" element={employee(<PortalHome />)} />
          <Route path="/me/profile" element={employee(<PortalProfile />)} />
          <Route path="/me/documents" element={employee(<PortalDocuments />)} />
          <Route path="/me/payslips" element={employee(<PortalPayslips />)} />
        </Route>
        <Route path="*" element={<Home />} />
      </Routes>
    </Suspense>
  );
}
