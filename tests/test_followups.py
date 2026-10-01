"""Client / lead follow-ups: CRUD, logging calls, due dates, and the "followups" admin area."""
import os
import shutil
import tempfile
import unittest
from datetime import date, timedelta

os.environ.setdefault("CRAFTLANEE_SECRET_KEY", "test-secret")

from craftlanee import create_app  # noqa: E402
from test_flow import Api  # noqa: E402


class FollowupsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.app = create_app({"SQLALCHEMY_DATABASE_URI": "sqlite:///" + os.path.join(cls.tmp, "f.db"),
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

    def test_followups(self):
        f = Api(self.app)
        self.ok(f.post("/api/auth/setup", {"company_name": "CraftLanee", "name": "Arjun", "email": "craftlanee@gmail.com",
                                           "password": "founderpass"}))
        today = date.today()
        iso = lambda d: d.isoformat()  # noqa: E731

        # validation
        self.assertEqual(f.post("/api/followups", {"name": ""}).status_code, 400)

        late = self.ok(f.post("/api/followups", {"name": "Acme Corp", "contact_person": "Ravi", "phone": "98400",
                                                 "source": "Referral", "interest": "Website",
                                                 "est_value": "50000",
                                                 "next_followup": iso(today - timedelta(days=2))}), 201)["lead"]
        self.assertEqual(late["code"], f"LEAD-{late['id']:04d}")
        self.assertEqual((late["status"], late["due"], late["est_value"]), ("new", "overdue", 50000.0))
        due_today = self.ok(f.post("/api/followups", {"name": "Globex", "next_followup": iso(today)}), 201)["lead"]
        self.assertEqual(due_today["due"], "today")
        self.ok(f.post("/api/followups", {"name": "Initech", "next_followup": iso(today + timedelta(days=3))}), 201)
        self.ok(f.post("/api/followups", {"name": "Umbrella", "status": "bogus"}), 201)

        data = self.ok(f.get("/api/followups"))
        self.assertEqual([r["name"] for r in data["rows"]], ["Acme Corp", "Globex", "Initech", "Umbrella"])
        c = data["counts"]
        self.assertEqual((c["overdue"], c["today"], c["week"], c["open"], c["no_date"], c["pipeline"]),
                         (1, 1, 1, 4, 1, 50000.0))
        self.assertEqual([r["name"] for r in self.ok(f.get("/api/followups?due=overdue"))["rows"]], ["Acme Corp"])
        self.assertEqual([r["name"] for r in self.ok(f.get("/api/followups?due=none"))["rows"]], ["Umbrella"])
        self.assertEqual([r["name"] for r in self.ok(f.get("/api/followups?q=ravi"))["rows"]], ["Acme Corp"])
        self.assertEqual(self.ok(f.get("/api/nav-counts"))["followups_due"], 2)
        dash = self.ok(f.get("/api/dashboard"))["followups"]
        self.assertEqual([d["name"] for d in dash["due"]], ["Acme Corp", "Globex"])

        # logging a call moves a new lead to "contacted" and sets the next date
        self.assertEqual(f.post(f"/api/followups/{late['id']}/log", {"body": ""}).status_code, 400)
        lead = self.ok(f.post(f"/api/followups/{late['id']}/log",
                              {"kind": "Call", "body": "Wants a quote by Friday",
                               "next_followup": iso(today + timedelta(days=4))}))["lead"]
        self.assertEqual((lead["status"], lead["due"], lead["activity_count"]), ("contacted", "upcoming", 1))
        self.assertEqual(lead["activities"][0]["body"], "Wants a quote by Friday")

        # closing as won clears the date and drops it from the open pipeline
        lead = self.ok(f.post(f"/api/followups/{late['id']}/log", {"kind": "Meeting", "body": "Signed",
                                                                   "status": "won"}))["lead"]
        self.assertEqual((lead["status"], lead["due"], lead["next_followup"]), ("won", "closed", None))
        self.assertIsNotNone(lead["closed_at"])
        c = self.ok(f.get("/api/followups"))["counts"]
        self.assertEqual((c["open"], c["won"], c["pipeline"]), (3, 1, 0.0))
        self.assertEqual(self.ok(f.get("/api/followups"))["rows"][-1]["name"], "Acme Corp")  # closed sink

        # edit and reopen; delete an activity; delete the lead
        lead = self.ok(f.put(f"/api/followups/{late['id']}", {"name": "Acme Corp Ltd", "status": "in_talks",
                                                              "next_followup": iso(today)}))["lead"]
        self.assertEqual((lead["name"], lead["status"], lead["closed_at"]), ("Acme Corp Ltd", "in_talks", None))
        act = lead["activities"][0]["id"]
        self.assertEqual(f.delete(f"/api/followups/{due_today['id']}/log/{act}").status_code, 404)
        self.assertEqual(self.ok(f.delete(f"/api/followups/{late['id']}/log/{act}"))["lead"]["activity_count"], 1)
        self.ok(f.delete(f"/api/followups/{late['id']}"))
        self.assertEqual(f.get(f"/api/followups/{late['id']}").status_code, 404)

        # the area is grantable; admins without it are refused
        keys = [p["key"] for p in self.ok(f.get("/api/permissions"))["permissions"]]
        self.assertIn("followups", keys)
        people = {}
        for name, email in (("Sales Sita", "s@c.in"), ("Hari HR", "h@c.in")):
            emp = self.ok(f.post("/api/employees", form={"full_name": name, "monthly_salary": "30000",
                                                         "roles": '["Staff"]'}), 201)["employee"]
            self.ok(f.post(f"/api/employees/{emp['id']}/login", {"email": email, "password": "password123"}))
            people[email] = emp
        self.ok(f.post(f"/api/employees/{people['s@c.in']['id']}/admin", {"permissions": ["followups"]}))
        self.ok(f.post(f"/api/employees/{people['h@c.in']['id']}/admin", {"permissions": ["employees"]}))
        sales, hr = self.login("s@c.in"), self.login("h@c.in")
        self.ok(sales.get("/api/followups"))
        self.ok(sales.post("/api/followups", {"name": "Soylent"}), 201)
        self.assertIsNotNone(self.ok(sales.get("/api/dashboard"))["followups"])
        self.assertEqual(hr.get("/api/followups").status_code, 403)
        self.assertEqual(hr.post("/api/followups", {"name": "x"}).status_code, 403)
        self.assertIsNone(self.ok(hr.get("/api/dashboard"))["followups"])
        self.assertEqual(self.ok(hr.get("/api/nav-counts"))["followups_due"], 0)


if __name__ == "__main__":
    unittest.main()
