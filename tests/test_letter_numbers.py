"""A letter's number follows the person's ID, and creating it again reissues the same letter."""
import os
import shutil
import tempfile
import unittest
from datetime import date

os.environ.setdefault("CRAFTLANEE_SECRET_KEY", "test-secret")

from craftlanee import create_app  # noqa: E402
from test_flow import Api  # noqa: E402

Y = date.today().year


class LetterNumbersTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.app = create_app({"SQLALCHEMY_DATABASE_URI": "sqlite:///" + os.path.join(cls.tmp, "n.db"),
                              "STORAGE_DIR": os.path.join(cls.tmp, "storage")})

    @classmethod
    def tearDownClass(cls):
        from craftlanee.extensions import db
        with cls.app.app_context():
            db.engine.dispose()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_numbers_follow_the_person(self):
        c = Api(self.app)
        c.post("/api/auth/setup", {"company_name": "CraftLanee", "name": "Arjun", "email": "craftlanee@gmail.com",
                                   "password": "founderpass"})
        mk = lambda name, t: c.post("/api/employees", form={"full_name": name, "employment_type": t, "roles": '["X"]',  # noqa: E731
                                                            "monthly_salary": "1000", "end_date": "2027-01-01"}).get_json()["employee"]
        i1, i2, ft, pt = mk("Koti", "Intern"), mk("Prathik", "Intern"), mk("Ravi", "Full-time"), mk("Pooja", "Part-time")
        self.assertEqual((i2["emp_code"], ft["emp_code"], pt["emp_code"]), ("CL-INT-0002", "CL-EMP-0001", "CL-PT-0001"))

        def create(emp, kind="offer"):
            d = c.get(f"/api/letters/{kind}/draft?employee_id={emp['id']}").get_json()
            r = c.post(f"/api/letters/{kind}", d["draft"] | {"employee_id": emp["id"]})
            self.assertEqual(r.status_code, 201, r.data[:300])
            return d["number_preview"], r.get_json()["letter"]

        preview, l1 = create(i2)
        self.assertEqual(preview, f"CL-INTERN-{Y}-0002")
        self.assertEqual(l1["number"], f"CL-INTERN-{Y}-0002")
        # creating it again for the same intern reissues the same letter, same number
        for _ in range(3):
            preview, again = create(i2)
            self.assertEqual((preview, again["number"], again["id"]), (f"CL-INTERN-{Y}-0002", l1["number"], l1["id"]))
        self.assertEqual(len(c.get("/api/letters/offer").get_json()["letters"]), 1)

        self.assertEqual(create(i1)[1]["number"], f"CL-INTERN-{Y}-0001")
        self.assertEqual(create(ft)[1]["number"], f"CL-OFFER-{Y}-0001")
        # IDs from another series keep their tag, so they never clash with CL-EMP-0001
        self.assertEqual(create(pt)[1]["number"], f"CL-OFFER-PT-{Y}-0001")
        self.assertEqual(create(pt)[1]["number"], f"CL-OFFER-PT-{Y}-0001")
        self.assertEqual(create(i2, "joining")[1]["number"], f"CL-JOIN-INT-{Y}-0002")
        self.assertEqual(create(ft, "joining")[1]["number"], f"CL-JOIN-{Y}-0001")

    def test_old_numbers_are_aligned(self):
        """Letters numbered by the old running count are renumbered to match their owner's ID on startup."""
        from craftlanee.api.documents import align_letter_numbers
        from craftlanee.extensions import db
        from craftlanee.models import Employee, OfferLetter
        with self.app.app_context():
            koti = Employee.query.filter_by(emp_code="CL-INT-0001").first()
            prathik = Employee.query.filter_by(emp_code="CL-INT-0002").first()
            OfferLetter.query.delete()
            # the live situation: Koti holds 0002, Prathik has three copies (0001, 0003, 0004)
            for num, emp in ((f"CL-INTERN-{Y}-0001", prathik), (f"CL-INTERN-{Y}-0002", koti),
                             (f"CL-INTERN-{Y}-0003", prathik), (f"CL-INTERN-{Y}-0004", prathik)):
                db.session.add(OfferLetter(number=num, employee_id=emp.id, letter_date=date.today(),
                                           candidate_name=emp.full_name, letter_type="internship"))
            db.session.commit()
            align_letter_numbers()
            got = {(l.employee_id, l.number) for l in OfferLetter.query}
            self.assertEqual(got, {(koti.id, f"CL-INTERN-{Y}-0001"), (prathik.id, f"CL-INTERN-{Y}-0002"),
                                   (prathik.id, f"CL-INTERN-{Y}-0002-R1"), (prathik.id, f"CL-INTERN-{Y}-0002-R2")})
            self.assertTrue(all(l.file_path for l in OfferLetter.query))  # PDFs regenerated with the new numbers
            self.assertEqual(align_letter_numbers(), [])  # idempotent


if __name__ == "__main__":
    unittest.main()
