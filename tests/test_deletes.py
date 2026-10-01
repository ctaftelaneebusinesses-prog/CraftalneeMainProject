"""Deleting letters and MOUs removes the record and its PDF; access follows the Documents area."""
import os
import shutil
import tempfile
import unittest

os.environ.setdefault("CRAFTLANEE_SECRET_KEY", "test-secret")

from craftlanee import create_app  # noqa: E402
from test_flow import Api  # noqa: E402


class DeleteTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.app = create_app({"SQLALCHEMY_DATABASE_URI": "sqlite:///" + os.path.join(cls.tmp, "x.db"),
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

    def pdf_files(self):
        root = os.path.join(self.tmp, "storage")
        return {f for _, _, files in os.walk(root) for f in files if f.endswith(".pdf")}

    def test_delete_letters_and_mous(self):
        f = Api(self.app)
        self.ok(f.post("/api/auth/setup", {"company_name": "CraftLanee", "name": "Arjun", "email": "craftlanee@gmail.com",
                                           "password": "founderpass"}))
        emp = self.ok(f.post("/api/employees", form={"full_name": "Greeshmitha", "monthly_salary": "20000",
                                                     "roles": '["Developer"]', "joining_date": "2026-02-12"}), 201)["employee"]
        before = self.pdf_files()
        offer = self.ok(f.post("/api/letters/offer", {"employee_id": emp["id"], "candidate_name": "Greeshmitha",
                                                      "joining_date": "2026-02-12", "salary": "20000"}), 201)["letter"]
        joining = self.ok(f.post("/api/letters/joining", {"employee_id": emp["id"], "employee_name": "Greeshmitha",
                                                          "joining_date": "2026-02-12"}), 201)["letter"]
        mou = self.ok(f.post("/api/mous", {"party_name": "Sree College"}), 201)["mou"]
        self.assertEqual(len(self.pdf_files() - before), 3)

        # a plain employee can't delete
        self.ok(f.post(f"/api/employees/{emp['id']}/login", {"email": "g@c.in", "password": "password123"}))
        g = Api(self.app)
        self.ok(g.post("/api/auth/login", {"email": "g@c.in", "password": "password123"}))
        self.assertEqual(g.delete(f"/api/letters/offer/{offer['id']}").status_code, 403)
        self.assertEqual(g.delete(f"/api/mous/{mou['id']}").status_code, 403)

        self.ok(f.delete(f"/api/letters/offer/{offer['id']}"))
        self.ok(f.delete(f"/api/letters/joining/{joining['id']}"))
        self.ok(f.delete(f"/api/mous/{mou['id']}"))
        self.assertEqual(self.pdf_files(), before)  # PDFs removed from storage
        self.assertEqual(f.get(f"/api/mous/{mou['id']}").status_code, 404)
        self.assertEqual(f.delete(f"/api/letters/offer/{offer['id']}").status_code, 404)
        prof = self.ok(f.get(f"/api/employees/{emp['id']}"))["employee"]
        self.assertEqual((prof["offer_letters"], prof["joining_letters"]), ([], []))
        actions = [a["action"] for a in self.ok(f.get("/api/audit"))["entries"]]
        self.assertTrue(any(a.startswith("deleted offer letter") for a in actions))
        self.assertTrue(any(a.startswith("deleted MOU") for a in actions))

    def test_reopen_payroll_removes_expense(self):
        f = Api(self.app)
        f.post("/api/auth/setup", {"company_name": "CraftLanee", "name": "Arjun", "email": "craftlanee@gmail.com",
                                   "password": "founderpass"})  # no-op if the other test ran first
        self.ok(f.post("/api/auth/login", {"email": "craftlanee@gmail.com", "password": "founderpass"}))
        self.ok(f.post("/api/employees", form={"full_name": "Pay Me", "monthly_salary": "30000",
                                               "roles": '["Dev"]'}), 201)
        self.ok(f.post("/api/payroll", {"month": "2026-09"}), 201)
        done = self.ok(f.post("/api/payroll/2026-09/finalize", {}))
        self.assertEqual(done["generated"], done["finalized"])
        exp = done["expenses"][0]
        before = self.pdf_files()
        slips = self.ok(f.get("/api/payslips?month=2026-09"))["payslips"]
        self.assertTrue(slips)

        self.assertEqual(f.delete(f"/api/expenses/{exp['id']}").status_code, 409)   # still guarded
        res = self.ok(f.post("/api/payroll/2026-09/reopen"))
        self.assertEqual(res["finalized"], 0)
        self.assertEqual(res["expenses"], [])
        self.assertEqual(self.ok(f.get("/api/payslips?month=2026-09"))["payslips"], [])
        self.assertEqual(len(before - self.pdf_files()), len(slips))                 # payslip PDFs gone
        self.assertEqual(self.ok(f.get("/api/finance/summary"))["overall"]["expenses"], 0)
        self.assertEqual(f.post("/api/payroll/2026-09/reopen").status_code, 400)     # nothing left to reopen

        # finalising again works and posts a fresh expense
        again = self.ok(f.post("/api/payroll/2026-09/finalize", {}))
        self.assertEqual(len(again["expenses"]), 1)


if __name__ == "__main__":
    unittest.main()
