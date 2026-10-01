"""Announcements: audience (everyone / chosen people), links, photos, read tracking and access."""
import io
import json
import os
import shutil
import tempfile
import unittest

os.environ.setdefault("CRAFTLANEE_SECRET_KEY", "test-secret")

from craftlanee import create_app  # noqa: E402
from test_flow import PNG, Api  # noqa: E402


class AnnouncementTest(unittest.TestCase):
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

    def person(self, f, name, email):
        emp = self.ok(f.post("/api/employees", form={"full_name": name, "monthly_salary": "1", "roles": '["Dev"]'}), 201)["employee"]
        self.ok(f.post(f"/api/employees/{emp['id']}/login", {"email": email, "password": "password123"}))
        c = Api(self.app)
        self.ok(c.post("/api/auth/login", {"email": email, "password": "password123"}))
        return emp, c

    def test_announcements(self):
        f = Api(self.app)
        self.ok(f.post("/api/auth/setup", {"company_name": "CraftLanee", "name": "Arjun", "email": "craftlanee@gmail.com",
                                           "password": "founderpass"}))
        a, ac = self.person(f, "Anu", "anu@c.in")
        b, bc = self.person(f, "Bala", "bala@c.in")

        # to everyone, with a YouTube link and two photos
        form = {"title": "Diwali party 🎉", "body": "Friday 5pm at the office.", "audience": "all", "pinned": "1",
                "links": json.dumps([{"url": "https://youtu.be/dQw4w9WgXcQ", "label": "Teaser"}, {"url": "craftlanee.com"}]),
                "photos": [(io.BytesIO(PNG), "one.png"), (io.BytesIO(PNG), "two.png")]}
        post = self.ok(f.post("/api/announcements", form=form), 201)["announcement"]
        self.assertEqual(len(post["photos"]), 2)
        self.assertEqual(post["links"][1]["url"], "https://craftlanee.com")   # scheme added
        self.assertEqual((post["reach"], post["seen"]), (2, 0))

        # only to Bala
        secret = self.ok(f.post("/api/announcements", {"title": "Your appraisal", "audience": "selected",
                                                       "recipient_ids": json.dumps([b["id"]])}), 201)["announcement"]
        self.assertEqual([r["full_name"] for r in secret["recipients"]], ["Bala"])

        # bad input
        self.assertEqual(f.post("/api/announcements", {"title": ""}).status_code, 400)
        self.assertEqual(f.post("/api/announcements", {"title": "x", "audience": "selected",
                                                       "recipient_ids": "[]"}).status_code, 400)
        self.assertEqual(f.post("/api/announcements", {"title": "x", "links": json.dumps([{"url": "javascript:alert(1)"}])}).status_code, 400)

        # Anu sees only the public one; Bala sees both; unread badges
        self.assertEqual([x["title"] for x in self.ok(ac.get("/api/announcements"))["announcements"]], ["Diwali party 🎉"])
        self.assertEqual(self.ok(bc.get("/api/nav-counts"))["unread_announcements"], 2)
        self.assertEqual(self.ok(ac.get("/api/nav-counts"))["unread_announcements"], 1)

        # photos: recipients can open them, others can't; Anu can't reach Bala's private post at all
        self.assertEqual(ac.get(post["photos"][0]["url"]).status_code, 200)
        self.assertEqual(ac.post("/api/announcements", {"title": "hi"}).status_code, 403)
        self.assertEqual(ac.delete(f"/api/announcements/{post['id']}").status_code, 403)
        self.assertEqual(ac.get(f"/api/announcements/{post['id']}/readers").status_code, 403)

        # reading clears the badge and shows up in "seen by"
        self.ok(ac.post("/api/announcements/read", {}))
        self.assertEqual(self.ok(ac.get("/api/nav-counts"))["unread_announcements"], 0)
        listed = self.ok(ac.get("/api/announcements"))
        self.assertTrue(listed["announcements"][0]["read"])
        self.assertFalse(listed["can_post"])
        readers = self.ok(f.get(f"/api/announcements/{post['id']}/readers"))
        self.assertEqual([p["full_name"] for p in readers["seen"]], ["Anu"])
        self.assertEqual([p["full_name"] for p in readers["not_seen"]], ["Bala"])

        # edit: remove a photo, change audience; delete removes files
        edited = self.ok(f.put(f"/api/announcements/{post['id']}", form={
            "title": "Diwali party — moved to Saturday", "audience": "selected", "recipient_ids": json.dumps([a["id"]]),
            "links": "[]", "remove_photo_ids": json.dumps([post["photos"][0]["id"]])}))["announcement"]
        self.assertEqual(len(edited["photos"]), 1)
        self.assertEqual(self.ok(bc.get("/api/announcements"))["announcements"][0]["title"], "Your appraisal")
        self.assertEqual(bc.get(edited["photos"][0]["url"]).status_code, 404)   # no longer addressed to Bala

        # an admin with the Announcements area can post
        self.ok(f.post(f"/api/employees/{a['id']}/admin", {"permissions": ["announcements"]}))
        self.ok(ac.post("/api/announcements", {"title": "From Anu"}), 201)

        self.ok(f.delete(f"/api/announcements/{post['id']}"))
        self.assertEqual(f.get(edited["photos"][0]["url"]).status_code, 404)


if __name__ == "__main__":
    unittest.main()
