# CraftLanee — Company Manager

A small internal system for CraftLanee: **Founder → Employees → Documents → Payroll → Payslips → Income → Expenses → Balance.** Nothing else.

- **Founder (owner)**: everything. The founder can also give any employee **admin access** and chooses exactly which areas it covers.
- **Admins**: employees the founder has granted one or more areas: *Employees*, *Payroll & payslips*, *Letters & MOUs*, *Finance*, *Leaves & holidays*, *Team & tasks*, *Settings & audit log*. They only see those areas in the menu, the dashboard and search, and the API refuses everything else. They can never grant access or change their own salary.
- **Employees**: their own profile (they can edit contact details and photo), documents and payslips, plus Leaves, Tasks and the Team tree.

**Stack**
- **Frontend:** React 19 + TypeScript, Vite, Tailwind CSS 4, Framer Motion, TanStack Query, Recharts and a ⌘K command palette (`frontend/`).
- **Backend:** a Python/Flask JSON API with SQLite and ReportLab for the PDFs (`craftlanee/`). It enforces every permission check.
- **Production:** one server (Waitress) serves both the API and the built React app.

## Run it

**Windows, simplest:** double-click `start.bat`. The first time, it sets up Python, builds the React UI (this needs [Node.js](https://nodejs.org)), then opens http://127.0.0.1:8080.

**Manually:**

```bash
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
cd frontend && npm install && npm run build && cd ..
.venv\Scripts\python serve.py            # http://127.0.0.1:8080
```

**Developing the UI.** Run the API and the Vite dev server together; the page reloads instantly as you edit.

```bash
.venv\Scripts\python run.py              # API on :5000
cd frontend && npm run dev                 # UI on http://127.0.0.1:5173 (proxies /api and /files)
```

After changing UI code, run `npm run build` in `frontend/` so the production server picks it up. You don't need to restart it.

On first visit you'll see **Create your workspace**, where you set up the founder account. Then complete **Settings** (address, logo, signature). Those details appear on every PDF.

## Everyday flow

1. **Employees → Add employee.** Pick the employment type first. It sets the ID series: `CL-EMP-0001` (full-time), `CL-PT-` (part-time), `CL-CON-` (contract), `CL-FREE-` (freelancer), `CL-INT-` (intern), `CL-TRN-` (trainee). Then add salary and optional bank details.
2. On the employee's profile: **Offer letter** / **Joining letter**. The form is pre-filled from the employee record; edit anything, then generate. The PDF is saved to the profile with a number like `CL-OFFER-2026-0001` or `CL-JOIN-2026-0001`.
3. Profile → **Login access** gives the employee a portal login. Leave the password blank to generate a temporary one. Under **Admin access**, the founder ticks the areas this person may manage.
4. **Payroll → Create payroll** for a month. This makes draft rows for active employees. Adjust allowances, bonus and deductions, then use **Save & finalise**. Finalising:
   - locks the rows,
   - posts one *Salary* expense with the total net pay, so the balance stays accurate,
   - generates payslips (`CL-PS-2026-0001`) into each employee's profile.
5. **Finance → Invoices** to bill clients. Add line items, tax (GST shows as CGST + SGST; use IGST for inter-state) and a discount, and watch the live PDF preview. The PDF uses your letterhead and is numbered like `CL-INV-2026-0001`. **Mark paid** adds the amount to Income as Received and locks that entry. **Mark unpaid** removes it again. The list shows what's outstanding and overdue, and payment details and tax rate carry over to your next invoice.
6. **Finance → Income / Expenses** to record everything else. **Balance** shows *received income − all expenses*, filterable by this month, last month, this year, or a custom range.

## People, leaves, tasks & the team tree

- **Multiple roles.** One person can hold several roles, e.g. CEO, Full Stack Developer, Project Manager and HR. The first role is the primary designation used in letters.
- **Employment types.** Full-time, Part-time, Contract, Freelancer, Intern and Trainee. Contract, freelance, intern and trainee records get an end date; interns and trainees are paid a stipend and get internship offer letters.
- **Reporting line.** The "Reports to" field builds the **team tree**. The founder sits at the top, with admins beside them, and everyone else flows down. Everyone can view the tree; admins can drag a person onto someone else to move them. To put several people under one person at once (for example three interns under a team lead), open that person's profile → **Team → Add people**, filter by type and tick them. Or select people on the Employees list and use **Put under…**.
- **Leaves.** Employees request leave, and the founder or an admin approves or rejects it (admins can't approve their own). Approved leaves and company holidays appear on a calendar everyone can see; reasons stay private. Use **Import Excel** with the downloadable template to load leaves or holidays in bulk. Imported leaves are approved immediately.
- **Tasks.** Anyone can assign tasks to people below them in the tree; admins can assign to anyone. The assignee moves the card from To do to In progress to Done, and completion shows up for the person who assigned it and on the admin dashboard. Click a task to open it. The assignee can break it into a **checklist** of steps, marking each one pending or complete, and add **notes** such as updates, blockers or links. The founder, admins with Team access, the person who assigned the task and leads above the assignee can all read the checklist and notes; cards show checklist progress (e.g. 2/5).
- **Self-service.** Employees can edit their phone, email, date of birth, address and photo. Salary, bank details, roles, department, employment type, dates and reporting line are admin-only.

## Announcements

**Announcements** (in everyone's sidebar) is the company notice board. The founder, and admins given the **Announcements** access area, can post to **everyone** or to **selected people** (one or many). A post can include a message, links and up to 12 photos. YouTube links play inside the post, pasted links become clickable, and photos open full-size. Pin important posts to the top. Everyone gets an unread badge until they open the page. Whoever posts sees **"Seen by X of Y"** on each post, with the list of who has and hasn't read it.

## Documents & rich text

Offer letters (employment and internship), joining letters, MOUs and payslips use a corporate letterhead layout. Terms & conditions, letter bodies and MOU clauses are edited in a rich-text editor (bold, italic, underline, bullets, numbered points, alignment, font and size); the formatting carries into the PDF. The editor shows a **live preview of the real PDF** as you type. Default T&C for offers, internships, joining letters and MOUs are set in **Settings**; each document can still be edited individually.

## Themes

Dark and light themes are available from the sun/moon button in the top bar. Each person's choice is remembered on their device.

## How the numbers work

| Figure | Definition |
|---|---|
| Total Income | Sum of income marked **Received**. Pending and partial amounts are shown but not counted. |
| Total Expenses | All expenses, including finalised payroll. |
| Current Balance | Total Income − Total Expenses |
| Monthly Payroll (dashboard) | Sum of monthly salaries of **active** employees |

Payroll expenses are locked. They can't be edited or deleted from Finance, which keeps them in step with the payroll that created them.

## Security

- All permissions are enforced in the backend API, not in the UI. Founder endpoints use `@founder_required`, and the employee portal endpoint (`/api/me`) reads data only through the signed-in user, never through IDs sent by the browser.
- Files (PDFs, photos, receipts, uploads) live in `instance/storage` locally, or in a **private** Supabase Storage bucket when hosted. Either way they're outside the web root. They are served only by `/files/...`, which checks ownership on every request. When an employee requests anything that isn't theirs, the server returns 404.
- Every write request carries a CSRF token header. Passwords are salted hashes. Session cookies are HttpOnly and SameSite=Lax. Failed logins are throttled.
- Deactivating an employee, or disabling their login, ends their access immediately.
- The audit log (Settings → Audit log) records who did what and when.

If you expose the app beyond your office network, put it behind HTTPS and set `CRAFTLANEE_SECURE_COOKIES=1`. Render (below) gives you HTTPS automatically. On a public server also set `CRAFTLANEE_SETUP_CODE`, so nobody else can claim the founder account before you do.

## Host it online (Render + Supabase, free)

The app runs on **Render** (free web service). Data lives in **Supabase**: Postgres for the database, and Storage for PDFs, photos, logo and signature. Render's disk is wiped on every restart, so nothing important is kept there.

**Free-tier limits to know about:**
- Render's free service **sleeps after about 15 minutes** without visits. The first visit afterwards takes 30–60 seconds.
- A Supabase free project **pauses after a week** with no activity. Un-pause it from the Supabase dashboard.
- Supabase free includes 500 MB of database and 1 GB of files.

### 1. Supabase
1. Create a project at [supabase.com](https://supabase.com). Pick the **Southeast Asia (Singapore)** region, the same as Render below, and save the database password.
2. Click **Connect** at the top, choose **Session pooler**, and copy the URI. Replace `[YOUR-PASSWORD]` with your password. This is `CRAFTLANEE_DATABASE_URL`.
   Use the *pooler* string. The "Direct connection" uses IPv6, which Render's free tier can't reach.
3. Open **Project Settings → Data API** and copy the **Project URL**. This is `SUPABASE_URL`.
4. Open **Project Settings → API Keys** and copy the **service_role** secret key (under "Legacy API keys"), or a new **secret** key. This is `SUPABASE_SERVICE_KEY`.
   It stays on the server only. Never put it in the frontend or share it.

The app creates its tables and its private `craftlanee` storage bucket by itself on first start.

### 2. GitHub
Render deploys from a GitHub repository. Push this folder to a new **private** repo. `.gitignore` already keeps out `instance/` (your local database and files), `.venv` and `node_modules`.

### 3. Render
1. Go to [render.com](https://render.com) → **New → Blueprint**, connect your GitHub, and pick the repo. It reads `render.yaml`.
2. When asked, paste `CRAFTLANEE_DATABASE_URL`, `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`. Also choose a `CRAFTLANEE_SETUP_CODE`: any phrase only you know.
3. Deploy. The first build takes a few minutes. It uses the `Dockerfile`, which builds the React UI and then runs the Python server.
4. Open the `https://….onrender.com` URL, enter your setup code and create the founder account. Then fill in **Settings**: logo, signature and address.

Every `git push` to the main branch redeploys automatically.

**Backups:** the Supabase free plan has no restorable backups. Now and then, export the database from **Supabase → Database → Backups**, or run `pg_dump` with your connection string.

## Configuration (optional environment variables)

| Variable | Default |
|---|---|
| `CRAFTLANEE_PORT` (or `PORT`) / `CRAFTLANEE_HOST` | `8080` / `0.0.0.0` |
| `CRAFTLANEE_SECRET_KEY` | Generated once, stored in `instance/secret_key`. **Must** be set on hosts with a throwaway disk. |
| `CRAFTLANEE_DATABASE_URL` (or `DATABASE_URL`) | `sqlite:///instance/craftlanee.db`. A Supabase/Postgres URL works as-is. |
| `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` | unset = files on local disk. Set both to keep files in Supabase Storage. |
| `SUPABASE_BUCKET` | `craftlanee` (created automatically as a private bucket) |
| `CRAFTLANEE_SETUP_CODE` | unset. When set, creating the founder account requires this code. |
| `CRAFTLANEE_SECURE_COOKIES` | unset (set to `1` behind HTTPS) |
| `CRAFTLANEE_BEHIND_PROXY` | unset (set to `1` behind Render or another reverse proxy) |

Admin commands:

```bash
.venv\Scripts\flask --app run reset-password     # reset any user's password from the console
.venv\Scripts\flask --app run create-founder
```

## Backups

Before upgrades, a full copy is written to `instance/backups/`. To take one yourself while the app runs, use SQLite's backup (a plain file copy can miss recent data held in the `-wal` file):

```bash
.venv\Scripts\python -c "import sqlite3; sqlite3.connect('instance/craftlanee.db').backup(sqlite3.connect('instance/backups/manual.db'))"
```


Everything lives in the **`instance/`** folder: the database, secret key, generated PDFs and uploads. Back up that folder, and never commit it. It's already in `.gitignore`.

## PDFs and fonts

PDFs use **Noto Sans**, bundled in `craftlanee/fonts/` (SIL Open Font License, see `OFL.txt`), so they look the same on Windows and on the server and ₹ always renders. To use your brand font instead, replace the four `Body-*.ttf` files.

## Tests

```bash
.venv\Scripts\python -m unittest discover -s tests -v
```

The test runs the full founder flow and checks that employees can't reach founder pages, finance data or other employees' files.

## Project layout

```
craftlanee/                 Python backend
  api/                      JSON API: auth, employees, documents (letters/MOUs), payroll, finance, settings + portal
  models.py                 users, employees, employee_documents, offer_letters, joining_letters,
                            mous, payroll, payslips, income, expenses, company_settings, audit_logs
  security.py               founder_required / employee_required, CSRF, security headers
  files.py                  the only route that serves files, with an ownership check on every request
  pdf.py                    branded PDF layouts (offer, joining, relieving, MOU, payslip, invoice)
  storage.py                where files live: local disk, or Supabase Storage when configured
  services.py, utils.py     finance totals, ₹ formatting, document numbering, uploads, audit
frontend/                   React + TypeScript app
  src/components/ui/        design system: buttons, fields, cards, modals, drawers, animated numbers
  src/components/layout/    sidebar, top bar, ⌘K command palette
  src/pages/founder/        dashboard, employees, letters, MOUs, payroll, finance, settings…
  src/pages/portal/         employee self-service
  src/index.css             dark-premium theme tokens
tests/test_flow.py          end-to-end API test, including the security boundaries
tests/test_team.py          roles, admin access, self-service, leaves, Excel import, tasks, org tree, rich text
```

To add a module later:
1. Add a model in `models.py`.
2. Add endpoints in `craftlanee/api/`.
3. Add a page in `frontend/src/pages/`.
4. Add a route in `App.tsx` and a link in `components/layout/nav.ts`.
#   C r a f t a l n e e M a i n P r o j e c t  
 