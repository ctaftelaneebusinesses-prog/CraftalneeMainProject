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
        self.ok(f.post("/api/auth/setup", {"company_name": "CraftLanee", "name": "Arjun", "email": "a@c.in",
                                           "password": "founderpass"}))
        self.ok(f.post("/api/auth/admins", {"name": "Arjun", "email": "A2@c.in", "password": "secondpass"}))
        self.ok(f.post("/api/auth/admins", {"name": "X", "email": "a2@c.in", "password": "secondpass"}), 400)
        admins = self.ok(f.get("/api/auth/admins"))["admins"]
        self.assertEqual([a["email"] for a in admins], ["a@c.in", "a2@c.in"])

        # The second email signs in with full founder access.
        s = Api(self.app)
        me = self.ok(s.post("/api/auth/login", {"email": "a2@c.in", "password": "secondpass"}))["user"]
        self.assertTrue(me["is_owner"])
        self.ok(s.get("/api/settings"))

        # Can't remove yourself; can remove the other; the last one always stays.
        first_id = next(a["id"] for a in admins if a["email"] == "a@c.in")
        second_id = next(a["id"] for a in admins if a["email"] == "a2@c.in")
        self.ok(s.delete(f"/api/auth/admins/{second_id}"), 400)
        self.ok(s.delete(f"/api/auth/admins/{first_id}"))
        self.ok(s.post("/api/auth/login", {"email": "a2@c.in", "password": "secondpass"}))


if __name__ == "__main__":
    unittest.main()
