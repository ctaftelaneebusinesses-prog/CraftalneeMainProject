"""Only the main founder login (craftlanee@gmail.com) may change signatures or read the audit log."""
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
        self.assertTrue(me["is_primary"])
        self.ok(owner.post("/api/auth/admins", {"name": "Co Founder", "email": "co@c.in", "password": "password123"}))
        other = Api(self.app)
        me = self.ok(other.post("/api/auth/login", {"email": "co@c.in", "password": "password123"}))["user"]
        self.assertTrue(me["is_owner"])
        self.assertFalse(me["is_primary"])

        base = {"company_name": "CraftLanee", "hr_name": "Hari", "hr_designation": "Manager"}
        for key in ("signature", "hr_signature"):
            r = other.post("/api/settings", form=base | {key: (io.BytesIO(PNG), "s.png")})
            self.assertEqual(r.status_code, 403, key)
            self.assertEqual(r.get_json()["error"], "Signatures are locked.")  # the owner's email isn't revealed
        self.assertIsNone(self.ok(owner.get("/api/settings"))["settings"]["signature_url"])

        self.ok(owner.post("/api/settings", form=base | {"signature": (io.BytesIO(PNG), "s.png"),
                                                         "hr_signature": (io.BytesIO(PNG), "h.png")}))
        st = self.ok(owner.get("/api/settings"))
        self.assertNotIn("craftlanee@gmail.com", other.get("/api/settings").get_data(as_text=True))
        self.assertIsNotNone(st["settings"]["signature_url"])

        # the other founder can still save everything else, but not remove a signature
        self.ok(other.post("/api/settings", form=base | {"tagline": "Hi", "remove_signature": "false",
                                                         "logo": (io.BytesIO(PNG), "l.png")}))
        self.assertEqual(other.post("/api/settings", form=base | {"remove_hr_signature": "true"}).status_code, 403)
        self.assertIsNotNone(self.ok(owner.get("/api/settings"))["settings"]["hr_signature_url"])
        self.ok(owner.post("/api/settings", form=base | {"remove_hr_signature": "true"}))
        self.assertIsNone(self.ok(owner.get("/api/settings"))["settings"]["hr_signature_url"])

        # audit log: only the main founder sees what everyone (other founders included) did
        entries = self.ok(owner.get("/api/audit"))["entries"]
        self.assertTrue(any(e["user_name"].startswith("Co Founder") for e in entries))
        self.assertTrue(self.ok(owner.get("/api/dashboard"))["activity"])
        self.assertEqual(other.get("/api/audit").status_code, 403)
        self.assertEqual(self.ok(other.get("/api/dashboard"))["activity"], [])


if __name__ == "__main__":
    unittest.main()
