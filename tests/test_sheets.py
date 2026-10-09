"""Sheets: Drive links shared with chosen people; founders and the project manager see all."""
import os
import shutil
import tempfile
import unittest

os.environ.setdefault("CRAFTLANEE_SECRET_KEY", "test-secret")

from craftlanee import create_app  # noqa: E402
from test_flow import Api  # noqa: E402


class SheetsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.app = create_app({"SQLALCHEMY_DATABASE_URI": "sqlite:///" + os.path.join(cls.tmp, "s.db"),
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
        cls.pm, cls.ivy, cls.ian = (cls.login(e) for e in ("pm@c.in", "ivy@c.in", "ian@c.in"))

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

    def titles(self, c):
        r = c.get("/api/sheets")
        self.assertEqual(r.status_code, 200, r.data[:300])
        return {s["title"] for s in r.get_json()["sheets"]}

    def test_sharing(self):
        r = self.ivy.post("/api/sheets", {"title": "Leads", "link": "drive.google.com/x",
                                          "recipient_ids": [self.people["ian@c.in"]["id"]]})
        self.assertEqual(r.status_code, 201, r.data[:300])
        sid = r.get_json()["sheet"]["id"]
        self.assertTrue(r.get_json()["sheet"]["link"].startswith("https://"))
        self.ivy.post("/api/sheets", {"title": "Private", "link": "https://drive.google.com/y"})
        self.assertEqual(self.titles(self.ivy), {"Leads", "Private"})
        self.assertEqual(self.titles(self.ian), {"Leads"})
        self.assertEqual(self.titles(self.pm), {"Leads", "Private"})
        self.assertEqual(self.titles(self.f), {"Leads", "Private"})
        self.assertEqual(self.ian.delete(f"/api/sheets/{sid}").status_code, 404)
        self.assertEqual(self.ivy.post("/api/sheets", {"title": "Bad", "link": "javascript:alert(1)"}).status_code, 400)


if __name__ == "__main__":
    unittest.main()
