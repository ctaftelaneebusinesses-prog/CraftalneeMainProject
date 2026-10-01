"""Only the craftlanee@gmail.com founder login may upload, replace or remove the founder / HR signatures."""
import io
import os
import shutil
import tempfile
import unittest

os.environ.setdefault("CRAFTLANEE_SECRET_KEY", "test-secret")

from craftlanee import create_app  # noqa: E402
from test_flow import PNG, Api  # noqa: E402


class SignaturesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.app = create_app({"SQLALCHEMY_DATABASE_URI": "sqlite:///" + os.path.join(cls.tmp, "s.db"),
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

    def test_signature_owner(self):
        owner = Api(self.app)
        me = self.ok(owner.post("/api/auth/setup", {"company_name": "CraftLanee", "name": "Arjun",
                                                    "email": "CraftLanee@Gmail.com", "password": "founderpass"}))["user"]
        self.assertTrue(me["can_edit_signatures"])
        self.ok(owner.post("/api/auth/admins", {"name": "Co Founder", "email": "co@c.in", "password": "password123"}))
        other = Api(self.app)
        me = self.ok(other.post("/api/auth/login", {"email": "co@c.in", "password": "password123"}))["user"]
        self.assertTrue(me["is_owner"])
        self.assertFalse(me["can_edit_signatures"])

        base = {"company_name": "CraftLanee", "hr_name": "Hari", "hr_designation": "Manager"}
        for key in ("signature", "hr_signature"):
            r = other.post("/api/settings", form=base | {key: (io.BytesIO(PNG), "s.png")})
            self.assertEqual(r.status_code, 403, key)
            self.assertIn("craftlanee@gmail.com", r.get_json()["error"])
        self.assertIsNone(self.ok(owner.get("/api/settings"))["settings"]["signature_url"])

        self.ok(owner.post("/api/settings", form=base | {"signature": (io.BytesIO(PNG), "s.png"),
                                                         "hr_signature": (io.BytesIO(PNG), "h.png")}))
        st = self.ok(owner.get("/api/settings"))
        self.assertEqual(st["signature_owner"], "craftlanee@gmail.com")
        self.assertIsNotNone(st["settings"]["signature_url"])

        # the other founder can still save everything else, but not remove a signature
        self.ok(other.post("/api/settings", form=base | {"tagline": "Hi", "remove_signature": "false",
                                                         "logo": (io.BytesIO(PNG), "l.png")}))
        self.assertEqual(other.post("/api/settings", form=base | {"remove_hr_signature": "true"}).status_code, 403)
        self.assertIsNotNone(self.ok(owner.get("/api/settings"))["settings"]["hr_signature_url"])
        self.ok(owner.post("/api/settings", form=base | {"remove_hr_signature": "true"}))
        self.assertIsNone(self.ok(owner.get("/api/settings"))["settings"]["hr_signature_url"])


if __name__ == "__main__":
    unittest.main()
