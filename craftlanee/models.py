"""Database models.

Money is stored as Numeric(12, 2). Every table carries created_at / updated_at.
Generated PDFs and uploads live under instance/storage and are only ever served
through the authorised /files routes.
"""
import json
import re
from datetime import datetime
from decimal import Decimal

from flask_login import UserMixin
from werkzeug.security import check_password_hash, generate_password_hash

from .extensions import db

Money = db.Numeric(12, 2)

ROLE_FOUNDER = "founder"
ROLE_EMPLOYEE = "employee"

EMPLOYMENT_TYPES = ["Full-time", "Part-time", "Contract", "Freelancer", "Intern", "Trainee"]
FIXED_TERM_TYPES = {"Contract", "Freelancer", "Intern", "Trainee"}   # have an end date
STIPEND_TYPES = {"Intern", "Trainee"}                                  # paid a stipend, get internship letters
OPTIONAL_PAY_TYPES = {"Intern", "Trainee", "Contract"}                 # stipend / pay may be left blank (unpaid)
EXPERIENCE_LEVELS = ["fresher", "experienced"]
# Each employment type has its own ID series: CL-EMP-0001, CL-INT-0001, CL-FREE-0001, ...
EMP_CODE_PREFIX = {"Full-time": "CL-EMP", "Part-time": "CL-PT", "Contract": "CL-CON",
                   "Freelancer": "CL-FREE", "Intern": "CL-INT", "Trainee": "CL-TRN"}
LEAVE_TYPES = ["Casual", "Sick", "Earned", "Unpaid", "Work from home", "Other"]
TASK_PRIORITIES = ["Low", "Medium", "High", "Urgent"]
TASK_STATUSES = ["todo", "in_progress", "done"]
EXPENSE_CATEGORIES = ["Salary", "Server/Hosting", "Software", "Office", "Travel",
                      "Marketing", "Equipment", "Other"]
PAYMENT_METHODS = ["Bank Transfer", "UPI", "Cash", "Card", "Cheque", "Other"]
INCOME_STATUSES = ["Received", "Pending", "Partially Received"]
INVOICE_STATUSES = ["unpaid", "paid", "cancelled"]
LEAD_STATUSES = ["new", "contacted", "in_talks", "proposal", "won", "lost"]
LEAD_CLOSED = {"won", "lost"}                                          # no further follow-up needed
LEAD_SOURCES = ["Referral", "Website", "Social media", "Cold call", "Event", "Existing client", "Other"]
LEAD_ACTIVITY_KINDS = ["Call", "Meeting", "Email", "WhatsApp", "Note"]

# Areas of the admin console the founder can grant to an employee, one by one.
PERMISSIONS = {
    "employees": ("Employees", "View, add and edit employees — including salary and bank details — their logins and uploaded files"),
    "payroll": ("Payroll & payslips", "Run and finalise payroll, generate and view payslips"),
    "documents": ("Letters & MOUs", "Offer, joining and relieving letters, MOUs and the documents library"),
    "finance": ("Finance", "Income, expenses, receipts and the company balance"),
    "leaves": ("Leaves & holidays", "Approve or reject leave, add leave for others, manage holidays and imports"),
    "team": ("Team & tasks", "Rearrange the team tree, assign tasks to anyone and see every task"),
    "announcements": ("Announcements", "Post announcements with links and photos to everyone or chosen people"),
    "followups": ("Client follow-ups", "Clients and leads, their status, next follow-up dates and call / meeting notes"),
    "settings": ("Settings & audit log", "Company details, logo, signature, default letter terms and the audit log"),
}
ALL_PERMISSIONS = list(PERMISSIONS)


def now():
    return datetime.now()


def cap_words(text):
    """Capitalise the first letter of every word, leaving the rest as typed ("ui/ux designer" -> "Ui/Ux Designer",
    "HR executive" -> "HR Executive")."""
    return re.sub(r"(?<![A-Za-z'])[a-z]", lambda m: m.group().upper(), text) if text else text


class TimestampMixin:
    created_at = db.Column(db.DateTime, default=now, nullable=False)
    updated_at = db.Column(db.DateTime, default=now, onupdate=now, nullable=False)


class User(UserMixin, TimestampMixin, db.Model):
    __tablename__ = "users"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False)
    email = db.Column(db.String(160), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(20), nullable=False, default=ROLE_EMPLOYEE)
    employee_id = db.Column(db.Integer, db.ForeignKey("employees.id", ondelete="CASCADE"),
                            unique=True, nullable=True)
    active = db.Column(db.Boolean, default=True, nullable=False)
    is_admin = db.Column(db.Boolean, default=False, nullable=False)  # founder-granted console access
    permissions = db.Column(db.Text)  # JSON list of PERMISSIONS keys; NULL on an admin = everything (older grants)
    last_login_at = db.Column(db.DateTime)

    employee = db.relationship("Employee", back_populates="user", lazy="selectin")

    @property
    def is_active(self):
        if not self.active:
            return False
        if self.role == ROLE_EMPLOYEE:
            return self.employee is not None and self.employee.status == "active"
        return True

    @property
    def is_founder(self):
        return self.role == ROLE_FOUNDER

    @property
    def has_admin(self):
        """Founder, or an employee the founder has granted at least one area of the console."""
        return self.is_founder or bool(self.perms)

    @property
    def perms(self):
        """The console areas this user may use. The founder always has every one."""
        if self.is_founder:
            return set(ALL_PERMISSIONS)
        if not self.is_admin or self.employee is None:
            return set()
        if self.permissions is None:
            return set(ALL_PERMISSIONS)
        try:
            granted = json.loads(self.permissions)
        except ValueError:
            return set()
        return {p for p in granted if p in PERMISSIONS} if isinstance(granted, list) else set()

    @property
    def full_access(self):
        return self.perms == set(ALL_PERMISSIONS)

    def can(self, perm):
        return perm in self.perms

    def set_perms(self, perms):
        chosen = [p for p in ALL_PERMISSIONS if p in set(perms or [])]
        self.is_admin = bool(chosen)
        self.permissions = json.dumps(chosen) if chosen else None

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)


class Employee(TimestampMixin, db.Model):
    __tablename__ = "employees"
    id = db.Column(db.Integer, primary_key=True)
    emp_code = db.Column(db.String(30), unique=True, nullable=False, index=True)
    full_name = db.Column(db.String(120), nullable=False)
    photo_path = db.Column(db.String(255))
    phone = db.Column(db.String(30))
    email = db.Column(db.String(160))
    date_of_birth = db.Column(db.Date)
    address = db.Column(db.Text)

    designation = db.Column(db.String(120))
    department = db.Column(db.String(120))
    joining_date = db.Column(db.Date)
    employment_type = db.Column(db.String(30), default="Full-time")
    work_location = db.Column(db.String(120))
    reporting_person = db.Column(db.String(120))
    roles = db.Column(db.Text)  # JSON list, e.g. ["Full Stack Developer", "Project Manager", "HR"]
    manager_id = db.Column(db.Integer, db.ForeignKey("employees.id", ondelete="SET NULL"), index=True)
    end_date = db.Column(db.Date)  # contract / internship end
    # interns & trainees
    college = db.Column(db.String(160))
    study_department = db.Column(db.String(120))  # department / course at college, e.g. "CSE"
    # everyone else
    experience_level = db.Column(db.String(20))  # EXPERIENCE_LEVELS
    experience_years = db.Column(db.Numeric(4, 1))
    previous_company = db.Column(db.String(160))
    resume_path = db.Column(db.String(255))
    resume_name = db.Column(db.String(255))

    monthly_salary = db.Column(Money, default=0, nullable=False)
    salary_effective_date = db.Column(db.Date)
    bank_name = db.Column(db.String(120))
    bank_account_name = db.Column(db.String(120))
    bank_account_number = db.Column(db.String(40))
    bank_ifsc = db.Column(db.String(20))

    status = db.Column(db.String(20), default="active", nullable=False)  # active | inactive

    manager = db.relationship("Employee", remote_side="Employee.id", backref="reports", lazy="selectin")
    user = db.relationship("User", back_populates="employee", uselist=False, lazy="selectin",
                           cascade="all, delete-orphan", passive_deletes=True)
    documents = db.relationship("EmployeeDocument", back_populates="employee",
                                cascade="all, delete-orphan", passive_deletes=True,
                                order_by="EmployeeDocument.created_at.desc()")
    offer_letters = db.relationship("OfferLetter", back_populates="employee",
                                    cascade="all, delete-orphan", passive_deletes=True,
                                    order_by="OfferLetter.created_at.desc()")
    joining_letters = db.relationship("JoiningLetter", back_populates="employee",
                                      cascade="all, delete-orphan", passive_deletes=True,
                                      order_by="JoiningLetter.created_at.desc()")
    relieving_letters = db.relationship("RelievingLetter", back_populates="employee",
                                        cascade="all, delete-orphan", passive_deletes=True,
                                        order_by="RelievingLetter.created_at.desc()")
    payroll_entries = db.relationship("Payroll", back_populates="employee",
                                      cascade="all, delete-orphan", passive_deletes=True,
                                      order_by="Payroll.month.desc()")
    payslips = db.relationship("Payslip", back_populates="employee",
                               cascade="all, delete-orphan", passive_deletes=True,
                               order_by="Payslip.month.desc()")

    leaves = db.relationship("Leave", back_populates="employee", cascade="all, delete-orphan",
                             passive_deletes=True, order_by="Leave.start_date.desc()")
    tasks = db.relationship("Task", back_populates="assignee", cascade="all, delete-orphan",
                            passive_deletes=True)

    @property
    def is_active(self):
        return self.status == "active"

    @property
    def role_list(self):
        try:
            data = json.loads(self.roles) if self.roles else []
        except ValueError:
            data = []
        if not data and self.designation:
            data = [self.designation]
        return [r for r in data if isinstance(r, str) and r.strip()]

    def set_roles(self, roles):
        clean = []
        for r in roles or []:
            r = cap_words(str(r).strip()[:60])
            if r and r.lower() not in {c.lower() for c in clean}:
                clean.append(r)
        self.roles = json.dumps(clean[:12])
        self.designation = clean[0] if clean else None

    @property
    def roles_label(self):
        return ", ".join(self.role_list)

    @property
    def is_stipend(self):
        return self.employment_type in STIPEND_TYPES

    @property
    def initials(self):
        parts = [p for p in (self.full_name or "").split() if p]
        return "".join(p[0] for p in parts[:2]).upper() or "?"

    @property
    def masked_account(self):
        acc = self.bank_account_number or ""
        return ("•••• " + acc[-4:]) if len(acc) > 4 else acc


class EmployeeDocument(TimestampMixin, db.Model):
    """'Other documents' uploaded against an employee (ID proofs, certificates...)."""
    __tablename__ = "employee_documents"
    id = db.Column(db.Integer, primary_key=True)
    employee_id = db.Column(db.Integer, db.ForeignKey("employees.id", ondelete="CASCADE"),
                            nullable=False, index=True)
    title = db.Column(db.String(160), nullable=False)
    notes = db.Column(db.Text)
    file_path = db.Column(db.String(255), nullable=False)
    original_name = db.Column(db.String(255))
    visible_to_employee = db.Column(db.Boolean, default=True, nullable=False)
    archived = db.Column(db.Boolean, default=False, nullable=False)

    employee = db.relationship("Employee", back_populates="documents", lazy="selectin")


class OfferLetter(TimestampMixin, db.Model):
    __tablename__ = "offer_letters"
    id = db.Column(db.Integer, primary_key=True)
    number = db.Column(db.String(40), unique=True, nullable=False, index=True)
    employee_id = db.Column(db.Integer, db.ForeignKey("employees.id", ondelete="CASCADE"),
                            nullable=False, index=True)
    letter_date = db.Column(db.Date, nullable=False)
    candidate_name = db.Column(db.String(120), nullable=False)
    address = db.Column(db.Text)
    designation = db.Column(db.String(120))
    department = db.Column(db.String(120))
    joining_date = db.Column(db.Date)
    salary = db.Column(Money, default=0)
    employment_type = db.Column(db.String(30))
    work_location = db.Column(db.String(120))
    reporting_person = db.Column(db.String(120))
    end_date = db.Column(db.Date)
    letter_type = db.Column(db.String(20), default="employment")  # employment | internship
    intro = db.Column(db.Text)
    terms = db.Column(db.Text)
    file_path = db.Column(db.String(255))
    archived = db.Column(db.Boolean, default=False, nullable=False)

    employee = db.relationship("Employee", back_populates="offer_letters", lazy="selectin")


class JoiningLetter(TimestampMixin, db.Model):
    __tablename__ = "joining_letters"
    id = db.Column(db.Integer, primary_key=True)
    number = db.Column(db.String(40), unique=True, nullable=False, index=True)
    employee_id = db.Column(db.Integer, db.ForeignKey("employees.id", ondelete="CASCADE"),
                            nullable=False, index=True)
    letter_date = db.Column(db.Date, nullable=False)
    employee_name = db.Column(db.String(120), nullable=False)
    emp_code = db.Column(db.String(30))
    designation = db.Column(db.String(120))
    department = db.Column(db.String(120))
    joining_date = db.Column(db.Date)
    salary = db.Column(Money, default=0)
    reporting_person = db.Column(db.String(120))
    employment_type = db.Column(db.String(30))
    work_location = db.Column(db.String(120))
    body = db.Column(db.Text)
    file_path = db.Column(db.String(255))
    archived = db.Column(db.Boolean, default=False, nullable=False)

    employee = db.relationship("Employee", back_populates="joining_letters", lazy="selectin")


class Mou(TimestampMixin, db.Model):
    __tablename__ = "mous"
    id = db.Column(db.Integer, primary_key=True)
    number = db.Column(db.String(40), unique=True, nullable=False, index=True)
    party_name = db.Column(db.String(160), nullable=False)
    contact_person = db.Column(db.String(120))
    address = db.Column(db.Text)
    start_date = db.Column(db.Date)
    end_date = db.Column(db.Date)
    purpose = db.Column(db.Text)
    scope = db.Column(db.Text)
    payment_terms = db.Column(db.Text)
    responsibilities = db.Column(db.Text)
    terms = db.Column(db.Text)
    signatory = db.Column(db.String(120))
    signatory_designation = db.Column(db.String(120))
    file_path = db.Column(db.String(255))
    archived = db.Column(db.Boolean, default=False, nullable=False)


class Payroll(TimestampMixin, db.Model):
    """One row per employee per month. Editable while 'draft'; locked once 'finalized'."""
    __tablename__ = "payroll"
    __table_args__ = (db.UniqueConstraint("employee_id", "month", name="uq_payroll_employee_month"),)
    id = db.Column(db.Integer, primary_key=True)
    employee_id = db.Column(db.Integer, db.ForeignKey("employees.id", ondelete="CASCADE"),
                            nullable=False, index=True)
    month = db.Column(db.String(7), nullable=False, index=True)  # YYYY-MM
    basic = db.Column(Money, default=0, nullable=False)
    allowances = db.Column(Money, default=0, nullable=False)
    deductions = db.Column(Money, default=0, nullable=False)
    bonus = db.Column(Money, default=0, nullable=False)
    net = db.Column(Money, default=0, nullable=False)
    notes = db.Column(db.String(255))
    status = db.Column(db.String(20), default="draft", nullable=False)  # draft | finalized
    finalized_at = db.Column(db.DateTime)
    expense_id = db.Column(db.Integer, db.ForeignKey("expenses.id", ondelete="SET NULL"))

    employee = db.relationship("Employee", back_populates="payroll_entries", lazy="selectin")
    payslip = db.relationship("Payslip", back_populates="payroll", uselist=False, lazy="selectin",
                              cascade="all, delete-orphan", passive_deletes=True)

    def recalc(self):
        self.net = (Decimal(self.basic or 0) + Decimal(self.allowances or 0)
                    + Decimal(self.bonus or 0) - Decimal(self.deductions or 0))

    @property
    def gross(self):
        return Decimal(self.basic or 0) + Decimal(self.allowances or 0) + Decimal(self.bonus or 0)


class Payslip(TimestampMixin, db.Model):
    __tablename__ = "payslips"
    id = db.Column(db.Integer, primary_key=True)
    number = db.Column(db.String(40), unique=True, nullable=False, index=True)
    payroll_id = db.Column(db.Integer, db.ForeignKey("payroll.id", ondelete="CASCADE"),
                           unique=True, nullable=False)
    employee_id = db.Column(db.Integer, db.ForeignKey("employees.id", ondelete="CASCADE"),
                            nullable=False, index=True)
    month = db.Column(db.String(7), nullable=False)
    net = db.Column(Money, default=0, nullable=False)
    file_path = db.Column(db.String(255))

    payroll = db.relationship("Payroll", back_populates="payslip")
    employee = db.relationship("Employee", back_populates="payslips", lazy="selectin")


class Income(TimestampMixin, db.Model):
    __tablename__ = "income"
    id = db.Column(db.Integer, primary_key=True)
    date = db.Column(db.Date, nullable=False, index=True)
    source = db.Column(db.String(160), nullable=False)
    client = db.Column(db.String(160))
    description = db.Column(db.Text)
    amount = db.Column(Money, nullable=False)
    payment_status = db.Column(db.String(30), default="Received", nullable=False)
    notes = db.Column(db.Text)

    invoice = db.relationship("Invoice", back_populates="income", uselist=False, lazy="selectin")

    @property
    def code(self):
        return f"INC-{self.id:04d}"


class Invoice(TimestampMixin, db.Model):
    """A bill sent to a client. Marking it paid records the matching Income row (and locks it)."""
    __tablename__ = "invoices"
    id = db.Column(db.Integer, primary_key=True)
    number = db.Column(db.String(40), unique=True, nullable=False, index=True)  # CL-INV-2026-0001
    client_name = db.Column(db.String(160), nullable=False)
    client_address = db.Column(db.Text)
    client_email = db.Column(db.String(160))
    client_phone = db.Column(db.String(30))
    client_gstin = db.Column(db.String(20))
    invoice_date = db.Column(db.Date, nullable=False, index=True)
    due_date = db.Column(db.Date)
    items = db.Column(db.Text, nullable=False, default="[]")  # JSON: [{"description", "qty", "rate"}]
    tax_label = db.Column(db.String(30), default="GST")
    tax_rate = db.Column(db.Numeric(5, 2), default=0, nullable=False)  # percent
    discount = db.Column(Money, default=0, nullable=False)
    notes = db.Column(db.Text)   # payment details: bank, UPI, ...
    terms = db.Column(db.Text)
    status = db.Column(db.String(20), default="unpaid", nullable=False, index=True)
    paid_date = db.Column(db.Date)
    payment_method = db.Column(db.String(30))
    income_id = db.Column(db.Integer, db.ForeignKey("income.id", ondelete="SET NULL"))
    file_path = db.Column(db.String(255))

    income = db.relationship("Income", back_populates="invoice", lazy="selectin")

    @property
    def lines(self):
        try:
            data = json.loads(self.items or "[]")
        except ValueError:
            return []
        out = []
        for row in data if isinstance(data, list) else []:
            qty, rate = Decimal(str(row.get("qty") or 0)), Decimal(str(row.get("rate") or 0))
            out.append({"description": row.get("description") or "", "qty": qty, "rate": rate,
                        "amount": (qty * rate).quantize(Decimal("0.01"))})
        return out

    @property
    def subtotal(self):
        return sum((line["amount"] for line in self.lines), Decimal("0"))

    @property
    def taxable(self):
        return max(self.subtotal - Decimal(self.discount or 0), Decimal("0"))

    @property
    def tax_amount(self):
        return (self.taxable * Decimal(self.tax_rate or 0) / 100).quantize(Decimal("0.01"))

    @property
    def total(self):
        return self.taxable + self.tax_amount

    @property
    def is_overdue(self):
        from datetime import date
        return self.status == "unpaid" and bool(self.due_date) and self.due_date < date.today()


class Expense(TimestampMixin, db.Model):
    __tablename__ = "expenses"
    id = db.Column(db.Integer, primary_key=True)
    date = db.Column(db.Date, nullable=False, index=True)
    category = db.Column(db.String(40), nullable=False, index=True)
    description = db.Column(db.Text, nullable=False)
    amount = db.Column(Money, nullable=False)
    paid_by = db.Column(db.String(120))
    payment_method = db.Column(db.String(40))
    receipt_path = db.Column(db.String(255))
    receipt_name = db.Column(db.String(255))
    notes = db.Column(db.Text)
    payroll_month = db.Column(db.String(7))  # set when created by payroll finalisation

    @property
    def code(self):
        return f"EXP-{self.id:04d}"

    @property
    def is_payroll(self):
        return bool(self.payroll_month)


class CompanySettings(TimestampMixin, db.Model):
    __tablename__ = "company_settings"
    id = db.Column(db.Integer, primary_key=True)
    company_name = db.Column(db.String(160), default="CraftLanee", nullable=False)
    tagline = db.Column(db.String(200))
    address = db.Column(db.Text)
    phone = db.Column(db.String(40))
    email = db.Column(db.String(160))
    website = db.Column(db.String(160))
    gstin = db.Column(db.String(30))
    founder_name = db.Column(db.String(120))
    founder_designation = db.Column(db.String(120), default="Founder & CEO")
    logo_path = db.Column(db.String(255))
    signature_path = db.Column(db.String(255))
    # HR co-signs employee documents (offer/joining/relieving letters, payslips) next to the founder.
    hr_name = db.Column(db.String(120))
    hr_designation = db.Column(db.String(120), default="Manager")
    hr_signature_path = db.Column(db.String(255))
    letterhead_path = db.Column(db.String(255))
    # Most logos already contain the company name (a wordmark). Only print the name as text too if asked.
    show_name_with_logo = db.Column(db.Boolean, default=False, nullable=False)
    offer_terms = db.Column(db.Text)
    internship_terms = db.Column(db.Text)
    joining_body = db.Column(db.Text)
    relieving_body = db.Column(db.Text)
    mou_terms = db.Column(db.Text)


class AuditLog(db.Model):
    __tablename__ = "audit_logs"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"))
    user_name = db.Column(db.String(120))
    action = db.Column(db.String(200), nullable=False)
    category = db.Column(db.String(40))  # employee | document | payroll | finance | settings
    details = db.Column(db.String(255))
    created_at = db.Column(db.DateTime, default=now, nullable=False, index=True)


class Leave(TimestampMixin, db.Model):
    __tablename__ = "leaves"
    id = db.Column(db.Integer, primary_key=True)
    employee_id = db.Column(db.Integer, db.ForeignKey("employees.id", ondelete="CASCADE"),
                            nullable=False, index=True)
    leave_type = db.Column(db.String(30), nullable=False, default="Casual")
    start_date = db.Column(db.Date, nullable=False, index=True)
    end_date = db.Column(db.Date, nullable=False, index=True)
    half_day = db.Column(db.Boolean, default=False, nullable=False)
    days = db.Column(db.Float, default=1, nullable=False)
    reason = db.Column(db.Text)
    status = db.Column(db.String(20), default="pending", nullable=False, index=True)  # pending|approved|rejected|cancelled
    source = db.Column(db.String(20), default="request")  # request | admin | import
    decided_by = db.Column(db.String(120))
    decided_at = db.Column(db.DateTime)
    decision_note = db.Column(db.String(255))

    employee = db.relationship("Employee", back_populates="leaves", lazy="selectin")


class Holiday(TimestampMixin, db.Model):
    __tablename__ = "holidays"
    id = db.Column(db.Integer, primary_key=True)
    date = db.Column(db.Date, nullable=False, unique=True, index=True)
    name = db.Column(db.String(120), nullable=False)


class Task(TimestampMixin, db.Model):
    __tablename__ = "tasks"
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text)
    assignee_id = db.Column(db.Integer, db.ForeignKey("employees.id", ondelete="CASCADE"),
                            nullable=False, index=True)
    created_by_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), index=True)
    created_by_name = db.Column(db.String(120))
    due_date = db.Column(db.Date)
    priority = db.Column(db.String(20), default="Medium", nullable=False)
    status = db.Column(db.String(20), default="todo", nullable=False, index=True)
    completed_at = db.Column(db.DateTime)

    assignee = db.relationship("Employee", back_populates="tasks", lazy="selectin")
    items = db.relationship("TaskItem", back_populates="task", cascade="all, delete-orphan", lazy="selectin",
                            order_by="TaskItem.position, TaskItem.id")
    notes = db.relationship("TaskNote", back_populates="task", cascade="all, delete-orphan", lazy="selectin",
                            order_by="TaskNote.created_at")


class TaskItem(TimestampMixin, db.Model):
    """One line of a task's checklist — the assignee breaks the task into steps and ticks them off."""
    __tablename__ = "task_items"
    id = db.Column(db.Integer, primary_key=True)
    task_id = db.Column(db.Integer, db.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    title = db.Column(db.String(300), nullable=False)
    done = db.Column(db.Boolean, default=False, nullable=False)
    done_at = db.Column(db.DateTime)
    position = db.Column(db.Integer, default=0, nullable=False)
    created_by_name = db.Column(db.String(120))

    task = db.relationship("Task", back_populates="items")


class TaskNote(TimestampMixin, db.Model):
    """Progress note on a task, visible to everyone who can see the task (founder, admins, assigner, leads)."""
    __tablename__ = "task_notes"
    id = db.Column(db.Integer, primary_key=True)
    task_id = db.Column(db.Integer, db.ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    author_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"))
    author_name = db.Column(db.String(120))
    body = db.Column(db.Text, nullable=False)

    task = db.relationship("Task", back_populates="notes")


announcement_recipients = db.Table(
    "announcement_recipients",
    db.Column("announcement_id", db.Integer, db.ForeignKey("announcements.id", ondelete="CASCADE"), primary_key=True),
    db.Column("employee_id", db.Integer, db.ForeignKey("employees.id", ondelete="CASCADE"), primary_key=True),
)


class Announcement(TimestampMixin, db.Model):
    """A post to everyone (audience "all") or to chosen employees (audience "selected")."""
    __tablename__ = "announcements"
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    body = db.Column(db.Text)
    links = db.Column(db.Text, default="[]", nullable=False)  # JSON: [{"url", "label"}]
    audience = db.Column(db.String(20), default="all", nullable=False)
    pinned = db.Column(db.Boolean, default=False, nullable=False)
    author_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"))
    author_name = db.Column(db.String(120))

    recipients = db.relationship("Employee", secondary=announcement_recipients, lazy="selectin")
    photos = db.relationship("AnnouncementPhoto", back_populates="announcement", cascade="all, delete-orphan", lazy="selectin",
                             order_by="AnnouncementPhoto.position, AnnouncementPhoto.id")
    reads = db.relationship("AnnouncementRead", back_populates="announcement", cascade="all, delete-orphan",
                            lazy="selectin")

    @property
    def link_list(self):
        try:
            data = json.loads(self.links or "[]")
        except ValueError:
            return []
        return [l for l in data if isinstance(l, dict) and l.get("url")] if isinstance(data, list) else []

    def visible_to(self, employee_id):
        return self.audience == "all" or any(e.id == employee_id for e in self.recipients)


class AnnouncementPhoto(TimestampMixin, db.Model):
    __tablename__ = "announcement_photos"
    id = db.Column(db.Integer, primary_key=True)
    announcement_id = db.Column(db.Integer, db.ForeignKey("announcements.id", ondelete="CASCADE"),
                                nullable=False, index=True)
    file_path = db.Column(db.String(255), nullable=False)
    original_name = db.Column(db.String(255))
    position = db.Column(db.Integer, default=0, nullable=False)

    announcement = db.relationship("Announcement", back_populates="photos")


class AnnouncementRead(db.Model):
    """When an employee first saw an announcement (drives unread badges and "seen by")."""
    __tablename__ = "announcement_reads"
    announcement_id = db.Column(db.Integer, db.ForeignKey("announcements.id", ondelete="CASCADE"), primary_key=True)
    employee_id = db.Column(db.Integer, db.ForeignKey("employees.id", ondelete="CASCADE"), primary_key=True)
    read_at = db.Column(db.DateTime, default=now, nullable=False)

    announcement = db.relationship("Announcement", back_populates="reads")


class RelievingLetter(TimestampMixin, db.Model):
    """Issued when an employee / intern leaves: confirms tenure, last working day and relieving."""
    __tablename__ = "relieving_letters"
    id = db.Column(db.Integer, primary_key=True)
    number = db.Column(db.String(40), unique=True, nullable=False, index=True)
    employee_id = db.Column(db.Integer, db.ForeignKey("employees.id", ondelete="CASCADE"),
                            nullable=False, index=True)
    letter_date = db.Column(db.Date, nullable=False)
    employee_name = db.Column(db.String(120), nullable=False)
    emp_code = db.Column(db.String(30))
    designation = db.Column(db.String(200))
    department = db.Column(db.String(120))
    employment_type = db.Column(db.String(30))
    joining_date = db.Column(db.Date)
    resignation_date = db.Column(db.Date)
    last_working_day = db.Column(db.Date)
    body = db.Column(db.Text)
    file_path = db.Column(db.String(255))
    archived = db.Column(db.Boolean, default=False, nullable=False)

    employee = db.relationship("Employee", back_populates="relieving_letters", lazy="selectin")


class Lead(TimestampMixin, db.Model):
    """A client or prospect the founder is following up with."""
    __tablename__ = "leads"
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(160), nullable=False)          # client / company
    contact_person = db.Column(db.String(120))
    phone = db.Column(db.String(40))
    email = db.Column(db.String(160))
    source = db.Column(db.String(40))
    interest = db.Column(db.String(200))                       # what they want: website, app, training…
    est_value = db.Column(Money)
    status = db.Column(db.String(20), default="new", nullable=False, index=True)
    next_followup = db.Column(db.Date, index=True)
    notes = db.Column(db.Text)
    closed_at = db.Column(db.DateTime)
    created_by_name = db.Column(db.String(120))

    activities = db.relationship("LeadActivity", back_populates="lead", cascade="all, delete-orphan", lazy="selectin",
                                 order_by="LeadActivity.created_at.desc()")

    @property
    def code(self):
        return f"LEAD-{self.id:04d}" if self.id else ""

    @property
    def is_open(self):
        return self.status not in LEAD_CLOSED


class LeadActivity(TimestampMixin, db.Model):
    """One logged follow-up on a lead: a call, meeting, email, message or plain note."""
    __tablename__ = "lead_activities"
    id = db.Column(db.Integer, primary_key=True)
    lead_id = db.Column(db.Integer, db.ForeignKey("leads.id", ondelete="CASCADE"), nullable=False, index=True)
    kind = db.Column(db.String(20), default="Note", nullable=False)
    body = db.Column(db.Text, nullable=False)
    author_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"))
    author_name = db.Column(db.String(120))

    lead = db.relationship("Lead", back_populates="activities")
