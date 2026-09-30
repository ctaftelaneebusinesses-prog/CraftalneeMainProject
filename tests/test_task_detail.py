"""Inside a task: the assignee's checklist and progress notes, and who may see them."""
import os
import shutil
import tempfile
import unittest

os.environ.setdefault("CRAFTLANEE_SECRET_KEY", "test-secret")

from craftlanee import create_app  # noqa: E402
from test_flow import Api  # noqa: E402


class TaskDetailTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.app = create_app({"SQLALCHEMY_DATABASE_URI": "sqlite:///" + os.path.join(cls.tmp, "d.db"),
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

    def person(self, f, name, email, **extra):
        form = {"full_name": name, "monthly_salary": "10000", "roles": '["Staff"]'} | extra
        emp = self.ok(f.post("/api/employees", form=form), 201)["employee"]
        self.ok(f.post(f"/api/employees/{emp['id']}/login", {"email": email, "password": "password123"}))
        c = Api(self.app)
        self.ok(c.post("/api/auth/login", {"email": email, "password": "password123"}))
        return emp, c

    def test_checklist_and_notes(self):
        f = Api(self.app)
        self.ok(f.post("/api/auth/setup", {"company_name": "CraftLanee", "name": "Arjun", "email": "a@c.in",
                                           "password": "founderpass"}))
        lead, lc = self.person(f, "Lead", "l@c.in")
        dev, dc = self.person(f, "Dev", "d@c.in", manager_id=str(lead["id"]))
        _, oc = self.person(f, "Other", "o@c.in")

        t = self.ok(f.post("/api/tasks", {"title": "Update UI", "assignee_id": dev["id"]}), 201)["task"]
        self.assertEqual((t["items_total"], t["notes_count"]), (0, 0))

        # the assignee builds a checklist and ticks items off
        d = self.ok(dc.post(f"/api/tasks/{t['id']}/items", {"title": "Header"}), 201)["task"]
        d = self.ok(dc.post(f"/api/tasks/{t['id']}/items", {"title": "Footer"}), 201)["task"]
        self.assertTrue(d["can_work"])
        self.assertFalse(d["can_manage"])
        header = d["items"][0]
        d = self.ok(dc.put(f"/api/tasks/items/{header['id']}", {"done": True}))["task"]
        self.assertEqual((d["items_done"], d["items_total"]), (1, 2))
        self.assertIsNotNone(d["items"][0]["done_at"])
        d = self.ok(dc.put(f"/api/tasks/items/{header['id']}", {"done": False}))["task"]
        self.assertEqual(d["items_done"], 0)
        self.assertEqual(dc.post(f"/api/tasks/{t['id']}/items", {"title": "  "}).status_code, 400)

        # notes from the assignee; the founder and the lead read everything
        note = self.ok(dc.post(f"/api/tasks/{t['id']}/notes", {"body": "Blocked on the logo file"}), 201)["task"]["notes"][0]
        for viewer in (f, lc):
            seen = self.ok(viewer.get(f"/api/tasks/{t['id']}"))["task"]
            self.assertEqual([i["title"] for i in seen["items"]], ["Header", "Footer"])
            self.assertEqual(seen["notes"][0]["body"], "Blocked on the logo file")
            self.assertEqual(seen["notes"][0]["author_name"], "Dev")
        self.ok(f.post(f"/api/tasks/{t['id']}/notes", {"body": "Logo is in Drive"}), 201)
        board = self.ok(f.get("/api/tasks?scope=all"))["tasks"][0]
        self.assertEqual((board["items_total"], board["notes_count"]), (2, 2))

        # the lead can read and comment, but the checklist belongs to the assignee / assigner
        self.assertFalse(self.ok(lc.get(f"/api/tasks/{t['id']}"))["task"]["can_work"])
        self.assertEqual(lc.post(f"/api/tasks/{t['id']}/items", {"title": "x"}).status_code, 403)
        self.ok(lc.post(f"/api/tasks/{t['id']}/notes", {"body": "Nice"}), 201)

        # an unrelated colleague sees nothing
        self.assertEqual(oc.get(f"/api/tasks/{t['id']}").status_code, 404)
        self.assertEqual(oc.post(f"/api/tasks/{t['id']}/notes", {"body": "hi"}).status_code, 404)
        self.assertEqual(oc.put(f"/api/tasks/items/{header['id']}", {"done": True}).status_code, 404)

        # only the author (or a Team admin) deletes a note
        self.assertEqual(lc.delete(f"/api/tasks/notes/{note['id']}").status_code, 403)
        self.ok(dc.delete(f"/api/tasks/notes/{note['id']}"))
        d = self.ok(dc.delete(f"/api/tasks/items/{header['id']}"))["task"]
        self.assertEqual([i["title"] for i in d["items"]], ["Footer"])

        # deleting the task takes its checklist and notes with it
        self.ok(f.delete(f"/api/tasks/{t['id']}"))
        from craftlanee.models import TaskItem, TaskNote
        with self.app.app_context():
            self.assertEqual((TaskItem.query.count(), TaskNote.query.count()), (0, 0))


if __name__ == "__main__":
    unittest.main()
