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

    def test_complaints_manager(self):
        f = self.f
        sai = self.ok(f.post("/api/employees", form={"full_name": "P.Sai Greeshmitha", "roles": '["Project Manager"]',
                                                     "monthly_salary": "1000"}), 201)["employee"]
        f.post(f"/api/employees/{sai['id']}/login", {"email": "sai@c.in", "password": "password123"})
        sai_c = self.login("sai@c.in")
        ivy_id, pm_id = self.people["ivy@c.in"]["id"], self.people["pm@c.in"]["id"]

        # only the main founder sets the complaints manager
        self.assertEqual(self.pm.put("/api/settings/complaints-manager", {"employee_id": sai["id"]}).status_code, 403)
        self.ok(f.put("/api/settings/complaints-manager", {"employee_id": sai["id"]}))
        self.assertEqual(self.ok(f.get("/api/settings"))["complaints_manager_id"], sai["id"])

        # she is always offered first, before the tree and the complaints area
        self.assertEqual([p["id"] for p in self.ok(self.ian.get("/api/complaints"))["recipients"]], [sai["id"], ivy_id, pm_id])

        to_pm = self.ok(self.ian.post("/api/complaints", {"subject": "Desk", "message": "Broken chair",
                                                          "recipient_id": pm_id, "anonymous": True}), 201)["complaint"]
        to_sai = self.ok(self.ian.post("/api/complaints", {"subject": "Hours", "message": "Too long",
                                                           "recipient_id": sai["id"], "anonymous": True}), 201)["complaint"]
        to_founder = self.ok(self.ian.post("/api/complaints", {"subject": "Pay", "message": "Late"}), 201)["complaint"]
        # "hide my name" is accepted for any recipient; she and the founder still see the name
        self.assertTrue(to_sai["anonymous"] and to_pm["anonymous"])

        # she sees everything, chosen or not, with names; the other PM still sees only theirs, without the name
        seen = {c["id"]: c for c in self.ok(sai_c.get("/api/complaints"))["all"]}
        self.assertTrue({to_pm["id"], to_sai["id"], to_founder["id"]} <= set(seen))
        self.assertEqual(seen[to_pm["id"]]["raised_by"]["full_name"], "Ian Intern")
        pm_seen = {c["id"]: c for c in self.ok(self.pm.get("/api/complaints"))["all"]}
        self.assertNotIn(to_founder["id"], pm_seen)
        self.assertIsNone(pm_seen[to_pm["id"]]["raised_by"])
        # she can reply to any complaint, but can't delete
        self.ok(sai_c.put(f"/api/complaints/{to_founder['id']}", {"response": "Looking into it", "status": "in_review"}))
        self.assertEqual(sai_c.delete(f"/api/complaints/{to_founder['id']}").status_code, 403)

        # clearing the setting: she keeps only what was sent to her
        self.ok(f.put("/api/settings/complaints-manager", {"employee_id": None}))
        self.assertEqual([c["id"] for c in self.ok(sai_c.get("/api/complaints"))["all"]], [to_sai["id"]])

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
        ivy_id, ian_id, pm_id = (self.people[e]["id"] for e in ("ivy@c.in", "ian@c.in", "pm@c.in"))
        self.ok(self.f.put(f"/api/org/{ian_id}", {"manager_id": ivy_id}))  # Ian reports to Ivy

        # who each person can send to: people above them in the tree + whoever has the complaints area
        opts = lambda c: [p["id"] for p in self.ok(c.get("/api/complaints"))["recipients"]]  # noqa: E731
        self.assertEqual(opts(self.ian), [ivy_id, pm_id])
        self.assertEqual(opts(self.ivy), [pm_id])

        to_pm = self.ok(self.ivy.post("/api/complaints", {"subject": "Laptop is slow", "category": "Facilities & equipment",
                                                          "message": "It takes 10 minutes to build.", "recipient_id": pm_id}), 201)["complaint"]
        hidden = self.ok(self.ian.post("/api/complaints", {"subject": "Too much overtime", "message": "Every day till 10pm.",
                                                           "anonymous": True, "recipient_id": ivy_id}), 201)["complaint"]
        founder_only = self.ok(self.ian.post("/api/complaints", {"subject": "About my lead", "message": "…"}), 201)["complaint"]
        self.assertEqual(self.ian.post("/api/complaints", {"subject": "x", "message": "y", "recipient_id": ian_id}).status_code, 400)
        self.assertEqual(self.ivy.post("/api/complaints", {"subject": "", "message": "x"}).status_code, 400)
        self.assertEqual(self.f.post("/api/complaints", {"subject": "a", "message": "b"}).status_code, 403)  # no employee record

        # each recipient sees only what was sent to them; a hidden name stays hidden from them
        received = lambda c: {x["id"]: x for x in self.ok(c.get("/api/complaints"))["all"]}  # noqa: E731
        self.assertEqual(set(received(self.pm)), {to_pm["id"]})
        self.assertEqual(received(self.pm)[to_pm["id"]]["raised_by"]["full_name"], "Ivy Intern")
        ivy_inbox = received(self.ivy)
        self.assertEqual(set(ivy_inbox), {hidden["id"]})
        self.assertIsNone(ivy_inbox[hidden["id"]]["raised_by"])
        self.assertTrue(self.ok(self.ivy.get("/api/complaints"))["can_review"])
        self.assertFalse(self.ok(self.ian.get("/api/complaints"))["can_review"])

        # the founder sees every complaint, chosen or not, with every name
        f = received(self.f)
        self.assertEqual(set(f), {to_pm["id"], hidden["id"], founder_only["id"]})
        self.assertEqual(f[hidden["id"]]["raised_by"]["full_name"], "Ian Intern")
        self.assertIsNone(f[founder_only["id"]]["sent_to"])
        self.assertEqual(self.ok(self.f.get("/api/nav-counts"))["open_complaints"], 3)
        self.assertEqual(self.ok(self.ivy.get("/api/nav-counts"))["open_complaints"], 1)

        # the sender sees their own, with who it went to
        mine = {x["id"]: x for x in self.ok(self.ian.get("/api/complaints"))["mine"]}
        self.assertEqual(mine[hidden["id"]]["sent_to"]["full_name"], "Ivy Intern")

        # only the recipient (or a founder) replies; the sender sees the reply
        self.assertEqual(self.pm.put(f"/api/complaints/{hidden['id']}", {"status": "resolved"}).status_code, 404)
        self.ok(self.pm.put(f"/api/complaints/{to_pm['id']}", {"response": "New laptop ordered.", "status": "resolved"}))
        reply = self.ok(self.ivy.get("/api/complaints"))["mine"][0]
        self.assertEqual((reply["status"], reply["response"], reply["responded_by"]), ("resolved", "New laptop ordered.", "Pam PM"))
        self.assertEqual(self.ivy.put(f"/api/complaints/{to_pm['id']}", {"status": "open"}).status_code, 404)

        # only founders delete
        self.assertEqual(self.pm.delete(f"/api/complaints/{to_pm['id']}").status_code, 403)
        self.ok(self.f.delete(f"/api/complaints/{to_pm['id']}"))
        self.assertNotIn(to_pm["id"], received(self.f))
        self.assertEqual(self.ok(self.ivy.get("/api/complaints"))["mine"], [])

        # the audit log doesn't record who raised a hidden-name complaint
        log = self.ok(self.f.get("/api/audit"))["entries"]
        self.assertFalse(any(hidden["code"] in (e["details"] or "") and e["action"] == "raised a complaint" for e in log))


if __name__ == "__main__":
    unittest.main()
