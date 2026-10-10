"""Daily updates: team members send call numbers; founders and the project manager read them."""
import os
import shutil
import tempfile
import unittest
from datetime import date, timedelta

os.environ.setdefault("CRAFTLANEE_SECRET_KEY", "test-secret")

from craftlanee import create_app  # noqa: E402
from test_flow import Api  # noqa: E402


class DailyUpdatesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.app = create_app({"SQLALCHEMY_DATABASE_URI": "sqlite:///" + os.path.join(cls.tmp, "d.db"),
                              "STORAGE_DIR": os.path.join(cls.tmp, "storage")})
        f = cls.f = Api(cls.app)
        f.post("/api/auth/setup", {"company_name": "CraftLanee", "name": "Arjun", "email": "craftlanee@gmail.com",
                                   "password": "founderpass"})
        cls.people = {}
        for name, email in (("Pam PM", "pm@c.in"), ("Ivy", "ivy@c.in"), ("Ian", "ian@c.in")):
            e = f.post("/api/employees", form={"full_name": name, "employment_type": "Intern", "roles": '["X"]',
                                               "monthly_salary": "1000", "end_date": "2027-01-01"}).get_json()["employee"]
            f.post(f"/api/employees/{e['id']}/login", {"email": email, "password": "password123"})
            cls.people[email] = e
        f.post(f"/api/employees/{cls.people['pm@c.in']['id']}/admin", {"permissions": ["projects"]})
        cls.pm, cls.ivy = (cls.login(e) for e in ("pm@c.in", "ivy@c.in"))

    @classmethod
    def login(cls, email):
        c = Api(cls.app)
        c.post("/api/auth/login", {"email": email, "password": "password123"})
        return c

    @classmethod
    def tearDownClass(cls):
        from craftlanee.extensions import db
        with cls.app.app_context():
            db.engine.dispose()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_flow(self):
        good = {"calls_total": 40, "calls_left": 10, "rejected": 12, "no_response": 20, "demo_requested": 3,
                "video_requested": 2, "followup_details": "Ravi (demo)"}
        r = self.ivy.post("/api/daily-updates", good)
        self.assertEqual(r.status_code, 201, r.data[:300])
        r = self.ivy.post("/api/daily-updates", {**good, "calls_total": 45})   # same day → replaced
        self.assertEqual(r.status_code, 200, r.data[:300])
        self.assertEqual(self.ivy.post("/api/daily-updates", {**good, "calls_total": 5}).status_code, 400)
        future = (date.today() + timedelta(days=1)).isoformat()
        self.assertEqual(self.ivy.post("/api/daily-updates", {**good, "day": future}).status_code, 400)
        self.assertEqual(self.pm.post("/api/daily-updates", good).status_code, 403)   # PM reviews, doesn't send

        mine = self.ivy.get("/api/daily-updates").get_json()
        self.assertFalse(mine["can_review"])
        self.assertNotIn("updates", mine)
        self.assertEqual(len(mine["mine"]), 1)

        for c in (self.pm, self.f):
            d = c.get("/api/daily-updates").get_json()
            self.assertTrue(d["can_review"])
            self.assertEqual(d["totals"]["calls_total"], 45)
            self.assertEqual([m["full_name"] for m in d["missing"]], ["Ian"])


if __name__ == "__main__":
    unittest.main()
