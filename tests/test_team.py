"""Roles, admin access, self-service, leaves, tasks, org tree, rich text and PDF previews."""
import io
import os
import shutil
import tempfile
import unittest
from datetime import date, timedelta

os.environ.setdefault("CRAFTLANEE_SECRET_KEY", "test-secret")

from craftlanee import create_app  # noqa: E402
from craftlanee.richtext import sanitize_html  # noqa: E402
from test_flow import PNG, Api  # noqa: E402


class TeamTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.app = create_app({"SQLALCHEMY_DATABASE_URI": "sqlite:///" + os.path.join(cls.tmp, "t.db"),
                              "STORAGE_DIR": os.path.join(cls.tmp, "storage")})

    @classmethod
    def tearDownClass(cls):
        from craftlanee.extensions import db
        with cls.app.app_context():
            db.engine.dispose()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def ok(self, r, code=200):
        self.assertEqual(r.status_code, code, r.data[:400].decode("utf-8", "replace"))
        return r.get_json()

    def employee(self, f, name, **extra):
        form = {"full_name": name, "monthly_salary": "20000", "employment_type": "Full-time",
                "roles": '["Developer"]', "joining_date": "2026-01-10"} | extra
        return self.ok(f.post("/api/employees", form=form), 201)["employee"]

    def login(self, email, password):
        c = Api(self.app)
        self.ok(c.post("/api/auth/login", {"email": email, "password": password}))
        return c

    def test_everything(self):
        f = Api(self.app)
        self.ok(f.post("/api/auth/setup", {"company_name": "CraftLanee", "name": "Arjun", "email": "craftlanee@gmail.com",
                                           "password": "founderpass"}))
        # --- multiple roles + new employment types
        b = self.employee(f, "Bala CTO", roles='["CEO", "Full Stack Developer", "Project Manager", "HR"]')
        self.assertEqual(b["roles"], ["CEO", "Full Stack Developer", "Project Manager", "HR"])
        self.assertEqual(b["designation"], "CEO")
        c = self.employee(f, "Chitra Lead", manager_id=str(b["id"]), roles='["Team Lead"]')
        d = self.employee(f, "Dev Intern", manager_id=str(c["id"]), employment_type="Intern",
                          end_date="2026-06-30", monthly_salary="8000", roles='["Frontend Intern"]')
        e = self.employee(f, "Esha Freelancer", employment_type="Freelancer", end_date="2026-12-31")
        self.assertEqual(d["end_date"], "2026-06-30")
        self.assertEqual(c["manager"]["id"], b["id"])
        # reporting loop is rejected
        self.assertEqual(f.put(f"/api/employees/{b['id']}", form={"full_name": "Bala CTO", "monthly_salary": "90000",
                                                                  "manager_id": str(d["id"]), "roles": '["CEO"]'}).status_code, 400)
        lst = self.ok(f.get("/api/employees?type=Intern"))
        self.assertEqual([x["full_name"] for x in lst["employees"]], ["Dev Intern"])
        self.assertEqual(self.ok(f.get("/api/employees?role=HR"))["employees"][0]["id"], b["id"])
        self.assertEqual(lst["multi_role"], 1)

        # --- logins; founder grants admin to B
        for emp, email in ((b, "b@c.in"), (c, "c@c.in"), (d, "d@c.in"), (e, "e@c.in")):
            self.ok(f.post(f"/api/employees/{emp['id']}/login", {"email": email, "password": "password123"}))
        bc, cc, dc, ec = (self.login(x, "password123") for x in ("b@c.in", "c@c.in", "d@c.in", "e@c.in"))
        self.assertEqual(bc.get("/api/dashboard").status_code, 403)
        self.assertEqual(cc.post(f"/api/employees/{c['id']}/admin", {"grant": True}).status_code, 403)  # only founder
        self.ok(f.post(f"/api/employees/{b['id']}/admin", {"grant": True}))
        self.assertTrue(self.ok(bc.get("/api/auth/session"))["user"]["is_admin"])
        self.ok(bc.get("/api/dashboard"))                       # admin sees everything
        self.ok(bc.get("/api/finance/summary"))
        self.assertEqual(bc.post(f"/api/employees/{c['id']}/admin", {"grant": True}).status_code, 403)  # can't grant
        # admin cannot raise own salary or deactivate self
        self.ok(bc.put(f"/api/employees/{b['id']}", form={"full_name": "Bala CTO", "monthly_salary": "999999",
                                                          "roles": '["CEO"]'}))
        self.assertEqual(self.ok(f.get(f"/api/employees/{b['id']}"))["employee"]["monthly_salary"], 20000)
        self.assertEqual(bc.post(f"/api/employees/{b['id']}/toggle-status").status_code, 403)

        # --- employee self-service: allowed fields only
        r = self.ok(dc.put("/api/me/profile", form={"phone": "+91 99999", "address": "New address",
                                                     "monthly_salary": "500000", "roles": '["CEO"]',
                                                     "photo": (io.BytesIO(PNG), "me.png")}))
        self.assertEqual(r["employee"]["phone"], "+91 99999")
        self.assertIsNotNone(r["employee"]["photo_url"])
        prof = self.ok(f.get(f"/api/employees/{d['id']}"))["employee"]
        self.assertEqual(prof["monthly_salary"], 8000)
        self.assertEqual(prof["roles"], ["Frontend Intern"])
        self.assertIsNotNone(prof["photo_url"])  # admin sees the new photo

        # --- leaves: request → approve → calendar visible to all
        start = date.today() + timedelta(days=3)
        lv = self.ok(dc.post("/api/leaves", {"leave_type": "Sick", "start_date": start.isoformat(),
                                             "end_date": (start + timedelta(days=1)).isoformat(),
                                             "reason": "Fever"}), 201)["leave"]
        self.assertEqual(lv["status"], "pending")
        self.assertEqual(dc.post("/api/leaves", {"leave_type": "Casual", "start_date": start.isoformat(),
                                                 "end_date": start.isoformat()}).status_code, 400)  # overlap
        self.assertEqual(dc.get("/api/leaves").status_code, 403)
        self.assertEqual(self.ok(f.get("/api/nav-counts"))["pending_leaves"], 1)
        self.assertEqual(dc.post(f"/api/leaves/{lv['id']}/decide", {"decision": "approve"}).status_code, 403)
        self.ok(bc.post(f"/api/leaves/{lv['id']}/decide", {"decision": "approve"}))  # admin approves
        month = start.strftime("%Y-%m")
        cal = self.ok(ec.get(f"/api/leaves/calendar?month={month}"))
        self.assertEqual(len(cal["leaves"]), 1)
        self.assertNotIn("reason", cal["leaves"][0])          # colleagues don't see the reason
        self.assertIn("reason", self.ok(dc.get(f"/api/leaves/calendar?month={month}"))["leaves"][0])
        # admin's own leave cannot be self-approved
        own = self.ok(bc.post("/api/leaves", {"leave_type": "Casual", "start_date": (start + timedelta(days=10)).isoformat(),
                                              "end_date": (start + timedelta(days=10)).isoformat()}), 201)["leave"]
        self.assertEqual(bc.post(f"/api/leaves/{own['id']}/decide", {"decision": "approve"}).status_code, 403)
        self.ok(f.post(f"/api/leaves/{own['id']}/decide", {"decision": "reject", "note": "Busy week"}))

        # --- Excel import (template round-trip) + CSV holidays
        tpl = f.get("/api/leaves/template")
        self.assertEqual(tpl.status_code, 200)
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(tpl.data))
        ws = wb.active
        ws.delete_rows(2, 5)
        nxt = (date.today().replace(day=1) + timedelta(days=75)).replace(day=5)
        ws.append([c["emp_code"], nxt.isoformat(), (nxt + timedelta(days=2)).isoformat(), "Earned", "N", "Trip"])
        ws.append(["", nxt.replace(day=15).isoformat(), "", "Holiday", "", "Founders Day"])
        ws.append(["CL-EMP-9999", nxt.isoformat(), nxt.isoformat(), "Casual", "", ""])
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        res = self.ok(f.post("/api/leaves/import", form={"file": (buf, "leaves.xlsx")}))
        self.assertEqual((res["added_leaves"], res["added_holidays"], len(res["errors"])), (1, 1, 1))
        cal = self.ok(dc.get(f"/api/leaves/calendar?month={nxt.strftime('%Y-%m')}"))
        self.assertEqual(len(cal["leaves"]), 1)
        self.assertEqual(cal["holidays"][0]["name"], "Founders Day")
        csv_data = io.BytesIO(b"Employee ID,From,To,Type,Half day,Reason\nALL,2026-12-25,,Holiday,,Christmas\n")
        self.assertEqual(self.ok(f.post("/api/leaves/import", form={"file": (csv_data, "h.csv")}))["added_holidays"], 1)
        self.assertEqual(dc.post("/api/leaves/import", form={"file": (io.BytesIO(b"x"), "a.csv")}).status_code, 403)

        # --- tasks: leader C can assign to D (report) but not E (not in line)
        self.assertEqual({x["id"] for x in self.ok(cc.get("/api/tasks/assignable"))["employees"]}, {d["id"]})
        self.assertEqual(cc.post("/api/tasks", {"title": "X", "assignee_id": e["id"]}).status_code, 403)
        t = self.ok(cc.post("/api/tasks", {"title": "Build login page", "assignee_id": d["id"],
                                           "priority": "High", "due_date": start.isoformat()}), 201)["task"]
        self.assertEqual(self.ok(dc.get("/api/nav-counts"))["my_open_tasks"], 1)
        self.assertEqual(ec.put(f"/api/tasks/{t['id']}", {"status": "done"}).status_code, 403)
        self.ok(dc.put(f"/api/tasks/{t['id']}", {"status": "done", "title": "hijack"}))
        done = self.ok(cc.get("/api/tasks?scope=assigned"))["tasks"][0]
        self.assertEqual((done["status"], done["title"]), ("done", "Build login page"))
        self.assertEqual(self.ok(f.get("/api/dashboard"))["tasks"]["done"], 1)
        self.assertEqual(dc.delete(f"/api/tasks/{t['id']}").status_code, 403)
        self.assertEqual(dc.get("/api/tasks?scope=all").status_code, 403)
        self.ok(bc.get("/api/tasks?scope=all"))

        # --- org tree: everyone reads, only admins move
        org = self.ok(ec.get("/api/org"))
        self.assertEqual(org["founder"]["name"], "Arjun")
        byid = {n["id"]: n for n in org["nodes"]}
        self.assertEqual(byid[d["id"]]["manager_id"], c["id"])
        self.assertFalse(org["can_edit"])
        self.assertNotIn("monthly_salary_hidden", byid[d["id"]])
        self.assertEqual(ec.put(f"/api/org/{d['id']}", {"manager_id": b["id"]}).status_code, 403)
        self.assertEqual(f.put(f"/api/org/{b['id']}", {"manager_id": d["id"]}).status_code, 400)  # loop
        self.ok(bc.put(f"/api/org/{d['id']}", {"manager_id": b["id"]}))

        # --- internship offer letter + rich text + live previews
        draft = self.ok(f.get(f"/api/letters/offer/draft?employee_id={d['id']}"))["draft"]
        self.assertEqual(draft["letter_type"], "internship")
        self.assertIn("<ol>", draft["terms"])
        draft["terms"] = '<ol><li><b>Bold</b> term<script>alert(1)</script></li></ol><p style="text-align:center">Centered</p>'
        prev = f.post("/api/letters/offer/preview", draft)
        self.assertEqual(prev.status_code, 200)
        self.assertTrue(prev.data.startswith(b"%PDF"))
        letter = self.ok(f.post("/api/letters/offer", draft), 201)["letter"]
        self.assertNotIn("<script", letter["terms"])
        self.assertEqual(letter["letter_type"], "internship")
        mp = f.post("/api/mous/preview", {"party_name": "Acme", "terms": "<ul><li>One</li></ul>"})
        self.assertTrue(mp.data.startswith(b"%PDF"))
        self.assertEqual(dc.post("/api/mous/preview", {"party_name": "x"}).status_code, 403)

    def test_sanitizer(self):
        out = sanitize_html('<p onclick="x()">Hi <b>there</b><img src=x onerror=1><a href="javascript:1">link</a></p>'
                            '<div style="text-align: right; color: red">R</div><font face="Georgia" size="5">F</font>')
        self.assertEqual(out, '<p>Hi <b>there</b>link</p><div style="text-align:right">R</div>'
                              '<font face="serif" size="5">F</font>')
        self.assertEqual(sanitize_html("Line one\n\nLine two"), "<p>Line one</p><p>Line two</p>")


if __name__ == "__main__":
    unittest.main()
