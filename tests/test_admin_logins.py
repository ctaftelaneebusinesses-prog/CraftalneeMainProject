"""Extra founder logins: a second email with full access, managed only by a founder."""
import os
import shutil
import tempfile
import unittest

os.environ.setdefault("CRAFTLANEE_SECRET_KEY", "test-secret")

from craftlanee import create_app  # noqa: E402
from test_flow import Api  # noqa: E402


class AdminLoginsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.app = create_app({"SQLALCHEMY_DATABASE_URI": "sqlite:///" + os.path.join(cls.tmp, "a.db"),
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

    def test_second_admin_login(self):
        f = Api(self.app)
        self.ok(f.post("/api/auth/setup", {"company_name": "CraftLanee", "name": "Arjun", "email": "craftlanee@gmail.com",
                                           "password": "founderpass"}))
        self.ok(f.post("/api/auth/admins", {"name": "Arjun", "email": "A2@c.in", "password": "secondpass"}))
        self.ok(f.post("/api/auth/admins", {"name": "X", "email": "a2@c.in", "password": "secondpass"}), 400)
        admins = self.ok(f.get("/api/auth/admins"))["admins"]
        self.assertEqual([a["email"] for a in admins], ["craftlanee@gmail.com", "a2@c.in"])

        # The second email signs in with full founder access...
        s = Api(self.app)
        me = self.ok(s.post("/api/auth/login", {"email": "a2@c.in", "password": "secondpass"}))["user"]
        self.assertTrue(me["is_owner"])
        self.assertFalse(me["is_primary"])
        self.ok(s.get("/api/settings"))

        # ...but only the main founder adds or removes admins, or grants admin access to employees.
        first_id = next(a["id"] for a in admins if a["email"] == "craftlanee@gmail.com")
        second_id = next(a["id"] for a in admins if a["email"] == "a2@c.in")
        self.ok(s.get("/api/auth/admins"), 403)
        self.ok(s.post("/api/auth/admins", {"name": "Y", "email": "a3@c.in", "password": "thirdpass1"}), 403)
        self.ok(s.delete(f"/api/auth/admins/{first_id}"), 403)
        emp = self.ok(f.post("/api/employees", form={"full_name": "Sam", "monthly_salary": "1", "roles": '["Staff"]'}), 201)["employee"]
        self.ok(f.post(f"/api/employees/{emp['id']}/login", {"email": "sam@c.in", "password": "password123"}))
        self.ok(s.get("/api/permissions"), 403)
        self.ok(s.post(f"/api/employees/{emp['id']}/admin", {"permissions": ["leaves"]}), 403)
        self.ok(f.post(f"/api/employees/{emp['id']}/admin", {"permissions": ["leaves"]}))

        # The main founder can't remove itself, but can remove the other login.
        self.ok(f.delete(f"/api/auth/admins/{first_id}"), 400)
        self.ok(f.delete(f"/api/auth/admins/{second_id}"))
        self.ok(s.post("/api/auth/login", {"email": "a2@c.in", "password": "secondpass"}), 401)


if __name__ == "__main__":
    unittest.main()
