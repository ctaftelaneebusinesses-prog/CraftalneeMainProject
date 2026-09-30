"""Putting several people (e.g. a batch of interns) under one employee at once."""
import os
import shutil
import tempfile
import unittest

os.environ.setdefault("CRAFTLANEE_SECRET_KEY", "test-secret")

from craftlanee import create_app  # noqa: E402
from test_flow import Api  # noqa: E402


class ReportsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.app = create_app({"SQLALCHEMY_DATABASE_URI": "sqlite:///" + os.path.join(cls.tmp, "r.db"),
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

    def add(self, f, name, etype="Full-time", **extra):
        form = {"full_name": name, "monthly_salary": "10000", "employment_type": etype, "roles": '["Staff"]'} | extra
        return self.ok(f.post("/api/employees", form=form), 201)["employee"]

    def test_bulk_reports(self):
        f = Api(self.app)
        self.ok(f.post("/api/auth/setup", {"company_name": "CraftLanee", "name": "Arjun", "email": "a@c.in",
                                           "password": "founderpass"}))
        lead = self.add(f, "Lead")
        boss = self.add(f, "Boss")
        self.ok(f.put(f"/api/employees/{lead['id']}", form={"full_name": "Lead", "monthly_salary": "10000",
                                                            "roles": '["Staff"]', "manager_id": str(boss["id"])}))
        a, b, c = (self.add(f, n, "Intern") for n in ("A", "B", "C"))

        res = self.ok(f.post(f"/api/employees/{lead['id']}/reports", {"add": [a["id"], b["id"], c["id"]]}))
        self.assertEqual(sorted(r["full_name"] for r in res["employee"]["reports"]), ["A", "B", "C"])
        self.assertIn("3 now report to Lead", res["message"])
        prof = self.ok(f.get(f"/api/employees/{a['id']}"))["employee"]
        self.assertEqual(prof["manager"]["id"], lead["id"])
        self.assertEqual(prof["reporting_person"], "Lead")

        # someone above the lead can't be put under them
        self.assertEqual(f.post(f"/api/employees/{lead['id']}/reports", {"add": [boss["id"]]}).status_code, 400)
        self.assertEqual(f.post(f"/api/employees/{lead['id']}/reports", {"add": [lead["id"]]}).status_code, 400)

        # remove one: back under the founder
        res = self.ok(f.post(f"/api/employees/{lead['id']}/reports", {"remove": [b["id"]]}))
        self.assertEqual(sorted(r["full_name"] for r in res["employee"]["reports"]), ["A", "C"])
        self.assertIsNone(self.ok(f.get(f"/api/employees/{b['id']}"))["employee"]["manager"])

        # plain employees can't do it
        self.ok(f.post(f"/api/employees/{c['id']}/login", {"email": "c@c.in", "password": "password123"}))
        cc = Api(self.app)
        self.ok(cc.post("/api/auth/login", {"email": "c@c.in", "password": "password123"}))
        self.assertEqual(cc.post(f"/api/employees/{lead['id']}/reports", {"add": [b["id"]]}).status_code, 403)


if __name__ == "__main__":
    unittest.main()
