"""Founder-chosen access areas: an admin only reaches the parts of the console they were granted."""
import os
import shutil
import tempfile
import unittest

os.environ.setdefault("CRAFTLANEE_SECRET_KEY", "test-secret")

from craftlanee import create_app  # noqa: E402
from test_flow import Api  # noqa: E402


class PermissionsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.app = create_app({"SQLALCHEMY_DATABASE_URI": "sqlite:///" + os.path.join(cls.tmp, "p.db"),
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

    def login(self, email):
        c = Api(self.app)
        self.ok(c.post("/api/auth/login", {"email": email, "password": "password123"}))
        return c

    def test_partial_access(self):
        f = Api(self.app)
        self.ok(f.post("/api/auth/setup", {"company_name": "CraftLanee", "name": "Arjun", "email": "a@c.in",
                                           "password": "founderpass"}))
        people = {}
        for name, email in (("Hari HR", "h@c.in"), ("Priya Payroll", "p@c.in"), ("Sam Staff", "s@c.in")):
            emp = self.ok(f.post("/api/employees", form={"full_name": name, "monthly_salary": "50000",
                                                         "roles": '["Staff"]'}), 201)["employee"]
            self.ok(f.post(f"/api/employees/{emp['id']}/login", {"email": email, "password": "password123"}))
            people[email] = emp
        hr, pay, staff = (self.login(e) for e in ("h@c.in", "p@c.in", "s@c.in"))

        # the founder lists the grantable areas; nobody else can
        keys = [p["key"] for p in self.ok(f.get("/api/permissions"))["permissions"]]
        self.assertIn("payroll", keys)
        self.assertEqual(hr.get("/api/permissions").status_code, 403)

        # unknown areas are rejected; only the founder can grant
        self.assertEqual(f.post(f"/api/employees/{people['h@c.in']['id']}/admin",
                                {"permissions": ["leaves", "root"]}).status_code, 400)
        self.assertEqual(hr.post(f"/api/employees/{people['h@c.in']['id']}/admin",
                                 {"permissions": ["leaves"]}).status_code, 403)

        prof = self.ok(f.post(f"/api/employees/{people['h@c.in']['id']}/admin",
                              {"permissions": ["employees", "leaves"]}))["employee"]
        self.assertEqual(prof["login"]["permissions"], ["employees", "leaves"])
        self.ok(f.post(f"/api/employees/{people['p@c.in']['id']}/admin", {"permissions": ["payroll"]}))

        me = self.ok(hr.get("/api/auth/session"))["user"]
        self.assertTrue(me["is_admin"])
        self.assertEqual(me["permissions"], ["employees", "leaves"])

        # HR: employees + leaves, nothing else
        self.ok(hr.get("/api/employees"))
        self.ok(hr.get("/api/leaves?status=pending"))
        self.ok(hr.get("/api/employees/options"))
        for url in ("/api/payroll", "/api/payslips", "/api/finance/summary", "/api/income", "/api/mous",
                    "/api/documents", "/api/settings", "/api/audit"):
            self.assertEqual(hr.get(url).status_code, 403, url)
        self.assertEqual(hr.post("/api/income", {"source": "x", "amount": 10}).status_code, 403)
        self.assertEqual(hr.put(f"/api/org/{people['s@c.in']['id']}", {"manager_id": None}).status_code, 403)

        # Payroll admin: payroll only; sees salaries in pickers but not the employee list
        self.ok(pay.get("/api/payroll"))
        self.assertEqual(pay.get("/api/employees").status_code, 403)
        opts = self.ok(pay.get("/api/employees/options"))["employees"]
        self.assertTrue(all(o["monthly_salary"] == 50000 for o in opts))
        self.assertEqual(pay.get("/api/leaves?status=pending").status_code, 403)

        # dashboard: open to any admin, sections trimmed to their areas
        dash = self.ok(hr.get("/api/dashboard"))
        self.assertIsNone(dash["totals"])
        self.assertEqual(dash["activity"], [])
        self.assertEqual(dash["draft_months"], [])
        self.assertEqual(self.ok(f.get("/api/dashboard"))["totals"]["balance"], 0)
        self.assertEqual(staff.get("/api/dashboard").status_code, 403)

        # search leaves out areas the admin can't open
        res = self.ok(pay.get("/api/search?q=Sam"))["results"]
        self.assertEqual(res["employees"], [])

        # ordinary employees never see colleagues' salaries (team tree, pickers)
        nodes = self.ok(staff.get("/api/org"))["nodes"]
        others = [n for n in nodes if n["id"] != people["s@c.in"]["id"]]
        self.assertTrue(others and all(n["monthly_salary"] is None for n in others))
        self.assertEqual([n["monthly_salary"] for n in nodes if n["id"] == people["s@c.in"]["id"]], [50000])
        # partial admins show as admins, but not with the founder's full access
        hari = next(n for n in nodes if n["id"] == people["h@c.in"]["id"])
        self.assertTrue(hari["is_admin"])
        self.assertFalse(hari["full_access"])

        # changing access takes effect immediately; empty list revokes
        self.ok(f.post(f"/api/employees/{people['h@c.in']['id']}/admin", {"permissions": ["finance"]}))
        self.ok(hr.get("/api/finance/summary"))
        self.assertEqual(hr.get("/api/employees").status_code, 403)
        self.ok(f.post(f"/api/employees/{people['h@c.in']['id']}/admin", {"permissions": []}))
        self.assertFalse(self.ok(hr.get("/api/auth/session"))["user"]["is_admin"])
        self.assertEqual(hr.get("/api/dashboard").status_code, 403)

        # older "grant: true" still means full access
        self.ok(f.post(f"/api/employees/{people['h@c.in']['id']}/admin", {"grant": True}))
        me = self.ok(hr.get("/api/auth/session"))["user"]
        self.assertEqual(len(me["permissions"]), len(keys))
        actions = [a["action"] for a in self.ok(f.get("/api/audit"))["entries"]]
        self.assertTrue(any("changed admin access for Hari HR" in a for a in actions))


if __name__ == "__main__":
    unittest.main()
