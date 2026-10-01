"""Professional letter defaults: work-policy fields, blank departments, and upgrading untouched saved texts."""
import os
import shutil
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock

os.environ.setdefault("CRAFTLANEE_SECRET_KEY", "test-secret")

from craftlanee import create_app, defaults, pdf  # noqa: E402
from test_flow import Api  # noqa: E402


class LetterDefaultsTest(unittest.TestCase):
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
        return r

    def test_blank_department_reads_cleanly(self):
        emp = SimpleNamespace(full_name="Sneha", roles_label="Intern", designation=None, department=None,
                              joining_date=None, manager=None, reporting_person=None, emp_code="CL-INT-0001", end_date=None)
        s = SimpleNamespace(company_name="CraftLanee", founder_name="Arjun")
        self.assertIn("as <b>Intern</b> at <b>CraftLanee</b>", defaults.fill_template(defaults.DEFAULT_INTERNSHIP_INTRO, emp, s))
        # older saved templates that use "{department} team" / "department" read cleanly too
        old = defaults.fill_template("<p>as {designation} with the {department} team at {company} in the {department} department.</p>", emp, s)
        self.assertEqual(old, "<p>as Intern at CraftLanee.</p>")
        self.assertNotIn("the  ", old)
        self.assertNotIn("the team", old)
        emp.department = "Design"
        self.assertIn(" in the Design team at", defaults.fill_template(defaults.DEFAULT_INTERNSHIP_INTRO, emp, s))

    def test_upgrade_and_is_default(self):
        s = SimpleNamespace(offer_terms=defaults._V1_OFFER_TERMS.replace("<li>", "<li> "), internship_terms="<p>My own terms</p>",
                            joining_body=None, relieving_body=defaults._V1_RELIEVING_BODY, mou_terms=defaults.DEFAULT_MOU_TERMS)
        self.assertEqual(defaults.upgrade_saved_defaults(s), ["offer_terms", "relieving_body"])
        self.assertIsNone(s.offer_terms)
        self.assertEqual(s.internship_terms, "<p>My own terms</p>")  # edited text is never touched
        self.assertTrue(defaults.is_default("offer_terms", "<div>" + defaults.DEFAULT_OFFER_TERMS + "</div>"))
        self.assertFalse(defaults.is_default("offer_terms", "<p>custom</p>"))

    def test_letters_carry_work_policy(self):
        c = Api(self.app)
        self.ok(c.post("/api/auth/setup", {"company_name": "CraftLanee", "name": "Arjun", "email": "craftlanee@gmail.com",
                                           "password": "founderpass"}))
        # company work policy in Settings feeds new drafts; saving an unchanged default stores nothing
        self.ok(c.post("/api/settings", form={"company_name": "CraftLanee", "hr_name": "Priya", "hr_designation": "HR",
                                              "work_hours": "10 AM to 7 PM", "work_days": "Monday to Saturday",
                                              "notice_period": "60 days", "offer_terms": defaults.DEFAULT_OFFER_TERMS}))
        st = c.get("/api/settings").get_json()
        self.assertIsNone(st["settings"]["offer_terms"])
        self.assertEqual(st["defaults"]["probation_period"], "3 months")

        dev = c.post("/api/employees", form={"full_name": "Ravi", "employment_type": "Full-time", "roles": '["Dev"]',
                                             "monthly_salary": "40000", "work_location": "Kuppam office"}).get_json()["employee"]
        intern = c.post("/api/employees", form={"full_name": "Sneha", "employment_type": "Intern", "roles": '["Intern"]',
                                                "end_date": "2027-01-01"}).get_json()["employee"]
        d = c.get(f"/api/letters/offer/draft?employee_id={dev['id']}").get_json()["draft"]
        self.assertEqual((d["working_hours"], d["work_days"], d["probation_period"], d["notice_period"]),
                         ("10 AM to 7 PM", "Monday to Saturday", "3 months", "60 days"))
        self.assertIn("Confidentiality and non-disclosure", d["terms"])
        i = c.get(f"/api/letters/offer/draft?employee_id={intern['id']}").get_json()["draft"]
        self.assertIsNone(i["probation_period"])
        self.assertIsNone(i["notice_period"])

        seen = []
        real = pdf.P
        with mock.patch.object(pdf, "P", side_effect=lambda t, *a, **k: (seen.append(str(t)), real(t, *a, **k))[1]):
            self.ok(c.post("/api/letters/offer/preview", d | {"employee_id": dev["id"]}))
        for label in ("Place of work", "Working hours", "Working days", "Probation period", "Notice period"):
            self.assertIn(label, seen)

        saved = self.ok(c.post("/api/letters/offer", d | {"employee_id": dev["id"]}), 201).get_json()["letter"]
        self.assertEqual((saved["working_hours"], saved["notice_period"]), ("10 AM to 7 PM", "60 days"))
        jd = c.get(f"/api/letters/joining/draft?employee_id={dev['id']}").get_json()["draft"]
        joined = self.ok(c.post("/api/letters/joining", jd | {"employee_id": dev["id"]}), 201).get_json()["letter"]
        self.assertEqual((joined["work_days"], joined["probation_period"]), ("Monday to Saturday", "3 months"))


if __name__ == "__main__":
    unittest.main()
