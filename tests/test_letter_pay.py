"""Internship pay (stipend or % per product) and leaving blank / zero details off the letter PDFs."""
import os
import shutil
import tempfile
import unittest
from unittest import mock

os.environ.setdefault("CRAFTLANEE_SECRET_KEY", "test-secret")

from craftlanee import create_app, pdf  # noqa: E402
from test_flow import Api  # noqa: E402


class LetterPayTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.app = create_app({"SQLALCHEMY_DATABASE_URI": "sqlite:///" + os.path.join(cls.tmp, "l.db"),
                              "STORAGE_DIR": os.path.join(cls.tmp, "storage")})

    @classmethod
    def tearDownClass(cls):
        from craftlanee.extensions import db
        with cls.app.app_context():
            db.engine.dispose()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def ok(self, r, code=200):
        self.assertEqual(r.status_code, code, r.data[:400].decode("utf-8", "replace"))
        return r

    def text(self, c, kind, payload):
        """Every paragraph the PDF builder wrote, joined (what a reader of the PDF would see)."""
        seen = []
        real_p, real_m = pdf.P, pdf.M
        with mock.patch.object(pdf, "P", side_effect=lambda t, *a, **k: (seen.append(str(t)), real_p(t, *a, **k))[1]), \
                mock.patch.object(pdf, "M", side_effect=lambda t, *a, **k: (seen.append(str(t)), real_m(t, *a, **k))[1]):
            r = self.ok(c.post(f"/api/letters/{kind}/preview", payload))
        self.assertTrue(r.data.startswith(b"%PDF"))
        return "\n".join(seen)

    def test_internship_pay_and_blanks(self):
        c = Api(self.app)
        self.ok(c.post("/api/auth/setup", {"company_name": "CraftLanee", "name": "Arjun", "email": "craftlanee@gmail.com",
                                           "password": "founderpass"}))
        emp = c.post("/api/employees", form={"full_name": "Ravi Intern", "employment_type": "Intern", "roles": '["Intern"]',
                                             "end_date": "2027-01-01"}).get_json()["employee"]
        draft = c.get(f"/api/letters/offer/draft?employee_id={emp['id']}").get_json()["draft"]
        self.assertEqual(draft["pay_basis"], "stipend")
        base = draft | {"employee_id": emp["id"], "letter_type": "internship", "joining_date": "", "end_date": "",
                        "work_location": "", "department": ""}

        # stipend left at 0 and other blanks: none of those rows are printed
        t = self.text(c, "offer", base | {"salary": 0})
        for gone in ("Monthly stipend", "Unpaid", "Duration", "Work location", "Department", "Start date"):
            self.assertNotIn(gone, t, gone)
        self.assertNotIn("—", t.splitlines())  # no blank placeholder values
        self.assertIn("Internship role", t)

        # stipend set: printed
        t = self.text(c, "offer", base | {"salary": 5000})
        self.assertIn("Monthly stipend", t)

        # percentage based: shows the percentage, never the stipend
        t = self.text(c, "offer", base | {"pay_basis": "percentage", "commission_percent": "12.5", "salary": 5000})
        self.assertIn("12.5% per product", t)
        self.assertNotIn("Monthly stipend", t)
        t = self.text(c, "offer", base | {"pay_basis": "percentage", "commission_percent": "0"})
        self.assertNotIn("per product", t)
        self.assertNotIn("Compensation", t)
        self.ok(c.post("/api/letters/offer/preview", base | {"pay_basis": "percentage", "commission_percent": "150"}))

        # saved letters keep the pay type; > 100% is refused
        self.assertEqual(c.post("/api/letters/offer", base | {"pay_basis": "percentage", "commission_percent": "150"}).status_code, 400)
        saved = self.ok(c.post("/api/letters/offer", base | {"pay_basis": "percentage", "commission_percent": "10"}), 201).get_json()["letter"]
        self.assertEqual((saved["pay_basis"], saved["commission_percent"], saved["salary"]), ("percentage", 10.0, 0))

        # joining letter with no salary / ID: no "Monthly salary" or "Employee ID: —"
        jd = c.get(f"/api/letters/joining/draft?employee_id={emp['id']}").get_json()["draft"]
        t = self.text(c, "joining", jd | {"employee_id": emp["id"], "salary": 0, "emp_code": ""})
        for gone in ("Monthly salary", "Unpaid", "Employee ID"):
            self.assertNotIn(gone, t, gone)
        self.assertNotIn("—", t.splitlines())


if __name__ == "__main__":
    unittest.main()
