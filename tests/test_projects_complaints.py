"""Project documents (shared with everyone or chosen people) and the complaints box."""
import io
import os
import shutil
import tempfile
import unittest

os.environ.setdefault("CRAFTLANEE_SECRET_KEY", "test-secret")

from craftlanee import create_app  # noqa: E402
from test_flow import PNG, Api  # noqa: E402


class ProjectsComplaintsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.app = create_app({"SQLALCHEMY_DATABASE_URI": "sqlite:///" + os.path.join(cls.tmp, "p.db"),
                              "STORAGE_DIR": os.path.join(cls.tmp, "storage")})
        f = cls.f = Api(cls.app)
        f.post("/api/auth/setup", {"company_name": "CraftLanee", "name": "Arjun", "email": "craftlanee@gmail.com",
                                   "password": "founderpass"})
        cls.people = {}
        for name, email, t in (("Pam PM", "pm@c.in", "Full-time"), ("Ivy Intern", "ivy@c.in", "Intern"),
                               ("Ian Intern", "ian@c.in", "Intern")):
            e = f.post("/api/employees", form={"full_name": name, "employment_type": t, "roles": '["X"]',
                                               "monthly_salary": "1000", "end_date": "2027-01-01"}).get_json()["employee"]
            f.post(f"/api/employees/{e['id']}/login", {"email": email, "password": "password123"})
            cls.people[email] = e
        f.post(f"/api/employees/{cls.people['pm@c.in']['id']}/admin", {"permissions": ["projects", "complaints"]})
        cls.pm, cls.ivy, cls.ian = (cls.login(e) for e in ("pm@c.in", "ivy@c.in", "ian@c.in"))

    @classmethod
    def login(cls, email):
        c = Api(cls.app)
        c.post("/api/auth/login", {"email": email, "password": "password123"})
        return c

    @classmethod
    def tearDownClass(cls):
        from craftlanee.extensions import db
        with cls.app.app_context():
            db.engine.dispose()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def ok(self, r, code=200):
        self.assertEqual(r.status_code, code, r.data[:400].decode("utf-8", "replace"))
        return r.get_json()

    def test_project_documents(self):
        ivy_id = self.people["ivy@c.in"]["id"]
        # validation: need a project, title and a file or link
        self.assertEqual(self.f.post("/api/projects", form={"project": "Acme", "title": "Brief"}).status_code, 400)
        everyone = self.ok(self.f.post("/api/projects", form={"project": "Acme Website", "title": "Project brief",
                                                              "file": (io.BytesIO(PNG), "brief.png")}), 201)["document"]
        chosen = self.ok(self.pm.post("/api/projects", form={
            "project": "Acme Website", "title": "Design specs", "link": "figma.com/file/abc",
            "audience": "selected", "recipient_ids": f"[{ivy_id}]", "file": (io.BytesIO(PNG), "specs.png")}), 201)["document"]
        self.assertEqual(chosen["link"], "https://figma.com/file/abc")
        self.assertEqual(self.f.post("/api/projects", form={"project": "X", "title": "Y", "link": "javascript:alert(1)"}).status_code, 400)

        titles = lambda c: [d["title"] for d in self.ok(c.get("/api/projects"))["documents"]]  # noqa: E731
        self.assertEqual(sorted(titles(self.ivy)), ["Design specs", "Project brief"])
        self.assertEqual(titles(self.ian), ["Project brief"])
        self.assertEqual(sorted(titles(self.pm)), ["Design specs", "Project brief"])
        self.assertFalse(self.ok(self.ian.get("/api/projects"))["can_manage"])

        # files: shared people can open them, others can't
        self.assertEqual(self.ivy.get(chosen["file_url"]).status_code, 200)
        self.assertEqual(self.ian.get(chosen["file_url"]).status_code, 404)
        self.assertEqual(self.ian.get(everyone["file_url"]).status_code, 200)

        # only managers upload, change or delete
        self.assertEqual(self.ian.post("/api/projects", form={"project": "X", "title": "Y", "link": "a.com"}).status_code, 403)
        self.assertEqual(self.ian.delete(f"/api/projects/{everyone['id']}").status_code, 403)
        self.ok(self.pm.post(f"/api/projects/{chosen['id']}", form={"project": "Acme Website", "title": "Design specs",
                                                                   "link": "figma.com/file/abc", "audience": "all"}))
        self.assertIn("Design specs", titles(self.ian))
        self.ok(self.pm.delete(f"/api/projects/{chosen['id']}"))
        self.assertNotIn("Design specs", titles(self.ivy))

    def test_complaints(self):
        named = self.ok(self.ivy.post("/api/complaints", {"subject": "Laptop is slow", "category": "Facilities & equipment",
                                                          "message": "It takes 10 minutes to build."}), 201)["complaint"]
        anon = self.ok(self.ian.post("/api/complaints", {"subject": "Too much overtime", "message": "Every day till 10pm.",
                                                         "anonymous": True}), 201)["complaint"]
        private = self.ok(self.ian.post("/api/complaints", {"subject": "About my PM", "message": "…",
                                                            "founder_only": True}), 201)["complaint"]
        self.assertEqual(self.ivy.post("/api/complaints", {"subject": "", "message": "x"}).status_code, 400)
        self.assertEqual(self.f.post("/api/complaints", {"subject": "a", "message": "b"}).status_code, 403)  # no employee record

        # each person sees only their own; interns can't see everyone's
        ivy = self.ok(self.ivy.get("/api/complaints"))
        self.assertEqual(([c["subject"] for c in ivy["mine"]], ivy["all"], ivy["can_review"]), (["Laptop is slow"], [], False))
        self.assertEqual(len(self.ok(self.ian.get("/api/complaints"))["mine"]), 2)

        # the PM sees all except founder-only; anonymous hides the name
        pm = self.ok(self.pm.get("/api/complaints"))
        by_id = {c["id"]: c for c in pm["all"]}
        self.assertEqual(set(by_id), {named["id"], anon["id"]})
        self.assertEqual(by_id[named["id"]]["raised_by"]["full_name"], "Ivy Intern")
        self.assertIsNone(by_id[anon["id"]]["raised_by"])
        self.assertEqual(pm["open"], 2)
        self.assertEqual(self.pm.put(f"/api/complaints/{private['id']}", {"status": "resolved"}).status_code, 404)
        # the founder sees everything, still without the anonymous name
        f = {c["id"]: c for c in self.ok(self.f.get("/api/complaints"))["all"]}
        self.assertEqual(len(f), 3)
        self.assertIsNone(f[anon["id"]]["raised_by"])
        self.assertEqual(self.ok(self.f.get("/api/nav-counts"))["open_complaints"], 3)

        # reply + resolve; the person who raised it sees the reply
        self.ok(self.pm.put(f"/api/complaints/{named['id']}", {"response": "New laptop ordered.", "status": "resolved"}))
        mine = self.ok(self.ivy.get("/api/complaints"))["mine"][0]
        self.assertEqual((mine["status"], mine["response"], mine["responded_by"]), ("resolved", "New laptop ordered.", "Pam PM"))
        self.assertEqual(self.ivy.put(f"/api/complaints/{named['id']}", {"status": "open"}).status_code, 403)
        self.assertEqual(self.ok(self.pm.get("/api/nav-counts"))["open_complaints"], 1)

        # nothing in the audit log names the anonymous person
        log = self.ok(self.f.get("/api/audit"))["entries"]
        self.assertFalse(any(anon["code"] in (e["details"] or "") for e in log))


if __name__ == "__main__":
    unittest.main()
