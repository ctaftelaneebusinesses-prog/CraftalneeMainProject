"""Intern college details, fresher/experienced, optional pay, and the optional resume upload."""
import io
import os
import shutil
import tempfile
import unittest

os.environ.setdefault("CRAFTLANEE_SECRET_KEY", "test-secret")

from craftlanee import create_app  # noqa: E402
from test_flow import Api  # noqa: E402

PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"


class EmployeeFieldsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.app = create_app({"SQLALCHEMY_DATABASE_URI": "sqlite:///" + os.path.join(cls.tmp, "e.db"),
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

    def files(self):
        root = os.path.join(self.tmp, "storage", "resumes")
        return set(os.listdir(root)) if os.path.isdir(root) else set()

    def test_fields_and_resume(self):
        f = Api(self.app)
        self.ok(f.post("/api/auth/setup", {"company_name": "CraftLanee", "name": "Arjun", "email": "a@c.in",
                                           "password": "founderpass"}))
        # intern: college + department, no stipend, with a resume
        intern = self.ok(f.post("/api/employees", form={
            "full_name": "Isha Intern", "employment_type": "Intern", "roles": '["Frontend Intern"]',
            "college": "NIT Warangal", "study_department": "Computer Science", "monthly_salary": "",
            "resume": (io.BytesIO(PDF), "isha-cv.pdf")}), 201)["employee"]
        self.assertEqual((intern["college"], intern["study_department"]), ("NIT Warangal", "Computer Science"))
        self.assertEqual(intern["monthly_salary"], 0)
        self.assertEqual(intern["resume_name"], "isha-cv.pdf")
        self.assertEqual(f.get(intern["resume_url"]).data, PDF)
        self.assertEqual(len(self.files()), 1)

        # experienced employee: years + previous company; fresher clears them
        dev = self.ok(f.post("/api/employees", form={
            "full_name": "Dev Senior", "employment_type": "Full-time", "roles": '["Dev"]', "monthly_salary": "90000",
            "experience_level": "experienced", "experience_years": "4.5", "previous_company": "Infosys"}), 201)["employee"]
        self.assertEqual((dev["experience_level"], dev["experience_years"], dev["previous_company"]),
                         ("experienced", 4.5, "Infosys"))
        dev = self.ok(f.put(f"/api/employees/{dev['id']}", form={
            "full_name": "Dev Senior", "employment_type": "Full-time", "roles": '["Dev"]', "monthly_salary": "90000",
            "experience_level": "fresher", "experience_years": "4.5", "previous_company": "Infosys"}))["employee"]
        self.assertEqual((dev["experience_level"], dev["experience_years"], dev["previous_company"]), ("fresher", None, None))
        self.assertEqual(f.post("/api/employees", form={"full_name": "X", "roles": '["Dev"]', "experience_level": "experienced",
                                                        "experience_years": "99"}).status_code, 400)
        self.assertEqual(f.post("/api/employees", form={"full_name": "X", "roles": '["Dev"]',
                                                        "resume": (io.BytesIO(b"x"), "cv.exe")}).status_code, 400)

        # the intern sees their own resume; a colleague can't
        self.ok(f.post(f"/api/employees/{intern['id']}/login", {"email": "i@c.in", "password": "password123"}))
        self.ok(f.post(f"/api/employees/{dev['id']}/login", {"email": "d@c.in", "password": "password123"}))
        ic, dc = Api(self.app), Api(self.app)
        self.ok(ic.post("/api/auth/login", {"email": "i@c.in", "password": "password123"}))
        self.ok(dc.post("/api/auth/login", {"email": "d@c.in", "password": "password123"}))
        self.assertEqual(ic.get(intern["resume_url"]).status_code, 200)
        self.assertEqual(dc.get(intern["resume_url"]).status_code, 404)

        # replacing swaps the file; removing deletes it
        base = {"full_name": "Isha Intern", "employment_type": "Intern", "roles": '["Frontend Intern"]'}
        new = self.ok(f.put(f"/api/employees/{intern['id']}", form=base | {"resume": (io.BytesIO(PDF + b"v2"), "cv-v2.pdf")}))["employee"]
        self.assertEqual(new["resume_name"], "cv-v2.pdf")
        self.assertEqual(len(self.files()), 1)
        gone = self.ok(f.put(f"/api/employees/{intern['id']}", form=base | {"remove_resume": "1"}))["employee"]
        self.assertIsNone(gone["resume_url"])
        self.assertEqual(self.files(), set())


if __name__ == "__main__":
    unittest.main()
