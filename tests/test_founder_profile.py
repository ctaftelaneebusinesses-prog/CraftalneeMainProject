"""Founder profile: name, title, phone, date of birth, address and photo on the founder's own login."""
import io
import os
import shutil
import tempfile
import unittest

os.environ.setdefault("CRAFTLANEE_SECRET_KEY", "test-secret")

from craftlanee import create_app  # noqa: E402
from test_flow import PNG, Api  # noqa: E402


class FounderProfileTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.app = create_app({"SQLALCHEMY_DATABASE_URI": "sqlite:///" + os.path.join(cls.tmp, "f.db"),
                              "STORAGE_DIR": os.path.join(cls.tmp, "storage")})
        f = cls.f = Api(cls.app)
        f.post("/api/auth/setup", {"company_name": "CraftLanee", "name": "Arjun", "email": "craftlanee@gmail.com",
                                   "password": "founderpass"})
        e = f.post("/api/employees", form={"full_name": "Ivy", "employment_type": "Intern", "roles": '["X"]',
                                           "monthly_salary": "1000", "end_date": "2027-01-01"}).get_json()["employee"]
        f.post(f"/api/employees/{e['id']}/login", {"email": "ivy@c.in", "password": "password123"})
        cls.ivy = Api(cls.app)
        cls.ivy.post("/api/auth/login", {"email": "ivy@c.in", "password": "password123"})

    @classmethod
    def tearDownClass(cls):
        from craftlanee.extensions import db
        with cls.app.app_context():
            db.engine.dispose()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_profile(self):
        r = self.f.put("/api/auth/profile", form={"name": "Arjun K", "designation": "Founder & CEO", "phone": "99999",
                                                  "date_of_birth": "1998-04-12", "address": "Hyderabad"})
        self.assertEqual(r.status_code, 200, r.data[:300])
        p = r.get_json()["profile"]
        self.assertEqual((p["name"], p["date_of_birth"], p["phone"]), ("Arjun K", "1998-04-12", "99999"))
        self.assertEqual(self.f.put("/api/auth/profile", form={"date_of_birth": "nope"}).status_code, 400)
        self.assertEqual(self.f.put("/api/auth/profile", form={"name": " "}).status_code, 400)

        r = self.f.put("/api/auth/profile", form={"photo": (io.BytesIO(PNG), "me.png")})
        self.assertEqual(r.status_code, 200, r.data[:300])
        url = r.get_json()["user"]["photo_url"]
        self.assertTrue(url)
        self.assertEqual(self.ivy.get(url).status_code, 200)   # colleagues see the founder's photo
        self.assertEqual(self.f.get("/api/auth/session").get_json()["user"]["photo_url"], url)
        r = self.f.put("/api/auth/profile", form={"remove_photo": "true"})
        self.assertIsNone(r.get_json()["profile"]["photo_url"])

        self.assertEqual(self.ivy.get("/api/auth/profile").status_code, 404)  # employees use /me/profile


if __name__ == "__main__":
    unittest.main()
