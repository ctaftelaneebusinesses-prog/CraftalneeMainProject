"""Sign-out with "remember me", relieving letters and employee deletion."""
import os
import shutil
import tempfile
import unittest

os.environ.setdefault("CRAFTLANEE_SECRET_KEY", "test-secret")

from craftlanee import create_app  # noqa: E402
from test_flow import Api  # noqa: E402


class RelievingTest(unittest.TestCase):
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

    def test_logout_with_remember_me(self):
        f = Api(self.app)
        self.ok(f.post("/api/auth/setup", {"name": "A", "email": "a@b.c", "password": "password1"}))
        self.ok(f.post("/api/auth/logout"))
        self.ok(f.post("/api/auth/login", {"email": "a@b.c", "password": "password1", "remember": True}))
        self.assertIsNotNone(f.c.get_cookie("remember_token"))   # the cookie that used to survive logout
        self.ok(f.post("/api/auth/logout"))
        self.assertIsNone(self.ok(f.get("/api/auth/session"))["user"])
        self.assertEqual(f.get("/api/dashboard").status_code, 401)

    def test_relieving_letter(self):
        f = Api(self.app)
        if self.ok(f.get("/api/auth/session"))["setup_required"]:
            self.ok(f.post("/api/auth/setup", {"name": "A", "email": "a@b.c", "password": "password1"}))
        else:
            self.ok(f.post("/api/auth/login", {"email": "a@b.c", "password": "password1"}))
        emp = self.ok(f.post("/api/employees", form={"full_name": "Ravi Kumar", "roles": '["Developer"]',
                                                     "monthly_salary": "30000", "joining_date": "2025-01-06"}), 201)["employee"]
        other = self.ok(f.post("/api/employees", form={"full_name": "Other", "roles": '["QA"]', "monthly_salary": "1"}), 201)["employee"]
        self.ok(f.post(f"/api/employees/{emp['id']}/login", {"email": "ravi@b.c", "password": "password123"}))
        self.ok(f.post(f"/api/employees/{other['id']}/login", {"email": "o@b.c", "password": "password123"}))

        d = self.ok(f.get(f"/api/letters/relieving/draft?employee_id={emp['id']}"))
        self.assertTrue(d["number_preview"].startswith("CL-REL-"))
        self.assertIn("Ravi Kumar", d["draft"]["body"])
        draft = d["draft"] | {"last_working_day": "2026-09-30", "resignation_date": "2026-08-31", "mark_inactive": True}
        prev = f.post("/api/letters/relieving/preview", draft)
        self.assertTrue(prev.data.startswith(b"%PDF"))
        bad = draft | {"last_working_day": "2024-01-01"}
        self.assertEqual(f.post("/api/letters/relieving", bad).status_code, 400)
        letter = self.ok(f.post("/api/letters/relieving", draft), 201)["letter"]

        prof = self.ok(f.get(f"/api/employees/{emp['id']}"))["employee"]
        self.assertEqual(prof["status"], "inactive")          # relieved → deactivated
        self.assertEqual(len(prof["relieving_letters"]), 1)
        self.assertIn(letter["number"], {i["number"] for i in self.ok(f.get("/api/documents?category=relieving"))["items"]})
        r = f.get(letter["file_url"])
        self.assertTrue(r.data.startswith(b"%PDF"))
        r.close()

        o = Api(self.app)
        self.ok(o.post("/api/auth/login", {"email": "o@b.c", "password": "password123"}))
        self.assertEqual(o.get(letter["file_url"]).status_code, 404)  # colleagues can't open it

        # delete from the list requires the exact Employee ID
        self.assertEqual(f.delete(f"/api/employees/{emp['id']}", {"confirm_code": "nope"}).status_code, 400)
        self.ok(f.delete(f"/api/employees/{emp['id']}", {"confirm_code": emp["emp_code"]}))
        self.assertEqual(f.get(f"/api/employees/{emp['id']}").status_code, 404)


if __name__ == "__main__":
    unittest.main()
