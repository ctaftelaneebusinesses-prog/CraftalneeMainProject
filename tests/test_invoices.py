"""Client invoices: totals, PDF, paid ⇄ income, locks and access."""
import os
import shutil
import tempfile
import unittest

os.environ.setdefault("CRAFTLANEE_SECRET_KEY", "test-secret")

from craftlanee import create_app  # noqa: E402
from test_flow import Api  # noqa: E402

ITEMS = [{"description": "Website design", "qty": 1, "rate": 40000},
         {"description": "Hosting (months)", "qty": 12, "rate": 500},
         {"description": "", "qty": "", "rate": ""}]  # blank rows are ignored


class InvoiceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.app = create_app({"SQLALCHEMY_DATABASE_URI": "sqlite:///" + os.path.join(cls.tmp, "i.db"),
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

    def test_invoice_lifecycle(self):
        f = Api(self.app)
        self.ok(f.post("/api/auth/setup", {"company_name": "CraftLanee", "name": "Arjun", "email": "craftlanee@gmail.com",
                                           "password": "founderpass"}))
        new = self.ok(f.get("/api/invoices/new"))
        self.assertRegex(new["number_preview"], r"^CL-INV-\d{4}-0001$")

        # validation
        self.assertEqual(f.post("/api/invoices", {"client_name": "", "items": ITEMS}).status_code, 400)
        self.assertEqual(f.post("/api/invoices", {"client_name": "Acme", "items": []}).status_code, 400)
        self.assertEqual(f.post("/api/invoices", {"client_name": "Acme", "items": ITEMS, "discount": 999999}).status_code, 400)

        # preview renders a real PDF without saving
        r = f.post("/api/invoices/preview", {"client_name": "Acme", "items": ITEMS, "tax_rate": 18})
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.data.startswith(b"%PDF"))
        self.assertEqual(self.ok(f.get("/api/invoices"))["invoices"], [])

        # 40,000 + 6,000 = 46,000 − 1,000 discount = 45,000 + 18% GST 8,100 = 53,100
        inv = self.ok(f.post("/api/invoices", {"client_name": "Acme Pvt Ltd", "client_gstin": "29abcde1234f1z5",
                                               "items": ITEMS, "tax_rate": 18, "discount": 1000,
                                               "invoice_date": "2026-09-01", "due_date": "2026-09-15",
                                               "notes": "UPI: craftlanee@upi"}), 201)["invoice"]
        self.assertEqual(len(inv["items"]), 2)
        self.assertEqual((inv["subtotal"], inv["tax_amount"], inv["total"]), (46000, 8100, 53100))
        self.assertEqual(inv["client_gstin"], "29ABCDE1234F1Z5")
        self.assertTrue(inv["overdue"])
        pdf = f.get(inv["file_url"])
        self.assertEqual(pdf.status_code, 200)
        self.assertTrue(pdf.data.startswith(b"%PDF"))
        summary = self.ok(f.get("/api/invoices"))["summary"]
        self.assertEqual((summary["outstanding"], summary["overdue_count"]), (53100, 1))
        self.assertEqual(len(self.ok(f.get("/api/invoices?status=overdue"))["invoices"]), 1)

        # the next form remembers the last tax rate, payment details and client
        new = self.ok(f.get("/api/invoices/new"))
        self.assertEqual(new["defaults"]["notes"], "UPI: craftlanee@upi")
        self.assertEqual(new["clients"][0]["client_name"], "Acme Pvt Ltd")

        # paid → a locked Received income row; balance goes up
        res = self.ok(f.post(f"/api/invoices/{inv['id']}/paid", {"paid_date": "2026-09-20", "payment_method": "UPI"}))
        paid = res["invoice"]
        self.assertEqual(paid["status"], "paid")
        self.assertFalse(paid["overdue"])
        row = self.ok(f.get("/api/income?period=all"))["rows"][0]
        self.assertEqual((row["source"], row["amount"], row["invoice"]["number"]), (f"Invoice {inv['number']}", 53100, inv["number"]))
        summary = self.ok(f.get("/api/finance/summary"))
        self.assertEqual(summary["overall"]["income"], 53100)
        inc_id = paid["income"]["id"]
        self.assertEqual(f.put(f"/api/income/{inc_id}", {"source": "x", "amount": 1}).status_code, 409)
        self.assertEqual(f.delete(f"/api/income/{inc_id}").status_code, 409)
        self.assertEqual(f.put(f"/api/invoices/{inv['id']}", {"client_name": "X", "items": ITEMS}).status_code, 409)
        self.assertEqual(f.delete(f"/api/invoices/{inv['id']}").status_code, 409)

        # unpaid again → income removed; then cancel, restore, delete
        self.ok(f.post(f"/api/invoices/{inv['id']}/unpaid"))
        self.assertEqual(self.ok(f.get("/api/finance/summary"))["overall"]["income"], 0)
        self.assertEqual(self.ok(f.post(f"/api/invoices/{inv['id']}/cancel"))["invoice"]["status"], "cancelled")
        self.assertEqual(self.ok(f.get("/api/invoices"))["summary"]["outstanding"], 0)
        self.assertEqual(self.ok(f.post(f"/api/invoices/{inv['id']}/cancel"))["invoice"]["status"], "unpaid")
        second = self.ok(f.post("/api/invoices", {"client_name": "Beta", "items": ITEMS[:1]}), 201)["invoice"]
        self.assertTrue(second["number"].endswith("-0002"))
        self.ok(f.delete(f"/api/invoices/{second['id']}"))

        # only Finance admins get in
        emp = self.ok(f.post("/api/employees", form={"full_name": "Hari", "monthly_salary": "1", "roles": '["HR"]'}), 201)["employee"]
        self.ok(f.post(f"/api/employees/{emp['id']}/login", {"email": "h@c.in", "password": "password123"}))
        self.ok(f.post(f"/api/employees/{emp['id']}/admin", {"permissions": ["employees"]}))
        h = Api(self.app)
        self.ok(h.post("/api/auth/login", {"email": "h@c.in", "password": "password123"}))
        self.assertEqual(h.get("/api/invoices").status_code, 403)
        self.assertEqual(h.get(inv["file_url"]).status_code, 404)
        self.ok(f.post(f"/api/employees/{emp['id']}/admin", {"permissions": ["finance"]}))
        self.ok(h.get("/api/invoices"))


if __name__ == "__main__":
    unittest.main()
