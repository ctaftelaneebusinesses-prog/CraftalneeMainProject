"""Each employment type gets its own ID series (CL-EMP-0001, CL-INT-0001, CL-FREE-0001, ...)."""
import os
import shutil
import tempfile
import unittest

os.environ.setdefault("CRAFTLANEE_SECRET_KEY", "test-secret")

from craftlanee import create_app  # noqa: E402
from test_flow import Api  # noqa: E402


class EmpCodeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.app = create_app({"SQLALCHEMY_DATABASE_URI": "sqlite:///" + os.path.join(cls.tmp, "c.db"),
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

    def add(self, f, name, etype, **extra):
        form = {"full_name": name, "monthly_salary": "10000", "employment_type": etype, "roles": '["Staff"]'} | extra
        return self.ok(f.post("/api/employees", form=form), 201)["employee"]["emp_code"]

    def test_series_per_type(self):
        f = Api(self.app)
        self.ok(f.post("/api/auth/setup", {"company_name": "CraftLanee", "name": "Arjun", "email": "a@c.in",
                                           "password": "founderpass"}))
        codes = self.ok(f.get("/api/employees?status=all"))["next_codes"]
        self.assertEqual(codes["Intern"], "CL-INT-0001")
        self.assertEqual(codes["Freelancer"], "CL-FREE-0001")

        self.assertEqual(self.add(f, "A", "Full-time"), "CL-EMP-0001")
        self.assertEqual(self.add(f, "B", "Intern"), "CL-INT-0001")
        self.assertEqual(self.add(f, "C", "Intern"), "CL-INT-0002")
        self.assertEqual(self.add(f, "D", "Freelancer"), "CL-FREE-0001")
        self.assertEqual(self.add(f, "E", "Full-time"), "CL-EMP-0002")
        self.assertEqual(self.add(f, "F", "Trainee"), "CL-TRN-0001")
        self.assertEqual(self.add(f, "G", "Contract"), "CL-CON-0001")
        self.assertEqual(self.add(f, "H", "Part-time"), "CL-PT-0001")
        # a hand-typed ID is kept, and the suggestion moves past it
        self.assertEqual(self.add(f, "I", "Intern", emp_code="cl-int-0010"), "CL-INT-0010")
        self.assertEqual(self.ok(f.get("/api/employees?status=all"))["next_codes"]["Intern"], "CL-INT-0011")


if __name__ == "__main__":
    unittest.main()
