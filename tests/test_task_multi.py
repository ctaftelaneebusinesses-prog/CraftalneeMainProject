"""Assigning one task to several people at once: each gets their own copy."""
import os
import shutil
import tempfile
import unittest

os.environ.setdefault("CRAFTLANEE_SECRET_KEY", "test-secret")

from craftlanee import create_app  # noqa: E402
from test_flow import Api  # noqa: E402


class TaskMultiTest(unittest.TestCase):
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

    def test_assign_to_many(self):
        f = Api(self.app)
        self.ok(f.post("/api/auth/setup", {"company_name": "CraftLanee", "name": "Arjun", "email": "craftlanee@gmail.com",
                                           "password": "founderpass"}))
        mk = lambda name, **x: self.ok(f.post("/api/employees", form={"full_name": name, "employment_type": "Intern",  # noqa: E731
                                                                      "roles": '["Intern"]', "end_date": "2027-01-01"} | x), 201)["employee"]
        lead = mk("Lead")
        a, b, c = (mk(n, manager_id=str(lead["id"])) for n in ("Asha", "Bala", "Chitra"))
        outsider = mk("Other")
        self.ok(f.post(f"/api/employees/{lead['id']}/login", {"email": "lead@c.in", "password": "password123"}))
        lc = Api(self.app)
        self.ok(lc.post("/api/auth/login", {"email": "lead@c.in", "password": "password123"}))

        r = self.ok(lc.post("/api/tasks", {"title": "Design the landing page", "priority": "High", "due_date": "2026-12-01",
                                           "assignee_ids": [a["id"], b["id"], c["id"], a["id"]]}), 201)
        self.assertEqual(sorted(t["assignee"]["full_name"] for t in r["tasks"]), ["Asha", "Bala", "Chitra"])
        self.assertTrue(all(t["title"] == "Design the landing page" and t["priority"] == "High" for t in r["tasks"]))
        self.assertEqual(len({t["id"] for t in r["tasks"]}), 3)  # separate copies

        # one person outside the lead's reporting line rejects the whole request, nothing is created
        self.assertEqual(lc.post("/api/tasks", {"title": "X", "assignee_ids": [a["id"], outsider["id"]]}).status_code, 403)
        self.assertEqual(lc.post("/api/tasks", {"title": "X", "assignee_ids": []}).status_code, 400)
        self.assertEqual(lc.post("/api/tasks", {"title": "", "assignee_ids": [a["id"]]}).status_code, 400)
        all_tasks = self.ok(f.get("/api/tasks?scope=all"))["tasks"]
        self.assertEqual(len(all_tasks), 3)

        # the single-person form still works
        self.ok(f.post("/api/tasks", {"title": "Solo", "assignee_id": outsider["id"]}), 201)


if __name__ == "__main__":
    unittest.main()
