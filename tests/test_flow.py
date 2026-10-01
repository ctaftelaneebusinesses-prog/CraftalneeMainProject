"""End-to-end test of the JSON API: founder flow + employee access boundaries.

    .venv\\Scripts\\python.exe -m unittest discover -s tests -v
"""
import io
import os
import shutil
import tempfile
import unittest
from datetime import date

os.environ.setdefault("CRAFTLANEE_SECRET_KEY", "test-secret")

from craftlanee import create_app  # noqa: E402
from craftlanee.utils import amount_in_words, inr  # noqa: E402

PNG = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15"
       b"\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\xcf\xc0\xf0\x1f\x00\x05\x00\x01\xff\x89\x99=\x1d\x00\x00"
       b"\x00\x00IEND\xaeB`\x82")


class Api:
    """Test client that behaves like the React app: bootstraps a CSRF token, sends it as a header."""

    def __init__(self, app):
        self.c = app.test_client()
        self.csrf = self.c.get("/api/auth/session").get_json()["csrf"]

    def get(self, url):
        return self.c.get(url)

    def send(self, method, url, json=None, form=None):
        kw = {"headers": {"X-CSRF-Token": self.csrf}}
        if form is not None:
            kw["data"], kw["content_type"] = form, "multipart/form-data"
        else:
            kw["json"] = json or {}
        r = getattr(self.c, method)(url, **kw)
        data = r.get_json(silent=True) or {}
        if "csrf" in data:
            self.csrf = data["csrf"]
        return r

    def post(self, url, json=None, form=None):
        return self.send("post", url, json, form)

    def put(self, url, json=None, form=None):
        return self.send("put", url, json, form)

    def delete(self, url, json=None):
        return self.send("delete", url, json)


class FlowTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.app = create_app({
            "SQLALCHEMY_DATABASE_URI": "sqlite:///" + os.path.join(cls.tmp, "t.db"),
            "STORAGE_DIR": os.path.join(cls.tmp, "storage"),
        })
        os.makedirs(cls.app.config["STORAGE_DIR"], exist_ok=True)

    @classmethod
    def tearDownClass(cls):
        from craftlanee.extensions import db
        with cls.app.app_context():
            db.engine.dispose()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def ok(self, r, code=200):
        self.assertEqual(r.status_code, code, r.data[:500].decode("utf-8", "replace"))
        return r.get_json()

    def pdf(self, client, url):
        r = client.get(url)
        self.assertEqual(r.status_code, 200, url)
        self.assertTrue(r.data.startswith(b"%PDF"), url)
        r.close()

    def test_full_flow(self):
        f = Api(self.app)
        month = date.today().strftime("%Y-%m")
        year = date.today().year
        today = date.today().isoformat()

        # --- first run
        s = self.ok(f.get("/api/auth/session"))
        self.assertTrue(s["setup_required"])
        self.assertIsNone(s["user"])
        self.assertEqual(f.c.post("/api/auth/setup", json={}).status_code, 400)  # no CSRF header
        self.ok(f.post("/api/auth/setup", {"company_name": "CraftLanee", "name": "Arjun Founder",
                                           "email": "craftlanee@gmail.com", "password": "founderpass"}))
        self.assertEqual(f.post("/api/auth/setup", {"name": "x"}).status_code, 409)
        self.assertEqual(self.ok(f.get("/api/auth/session"))["user"]["role"], "founder")

        # --- settings (multipart with images)
        self.ok(f.post("/api/settings", form={
            "company_name": "CraftLanee", "address": "12 MG Road\nKochi", "founder_name": "Arjun Founder",
            "founder_designation": "Founder & CEO", "logo": (io.BytesIO(PNG), "logo.png"),
            "signature": (io.BytesIO(PNG), "sig.png")}))
        self.assertIsNotNone(self.ok(f.get("/api/settings"))["settings"]["logo_url"])

        # --- employees
        ids = []
        for name, salary, email in (("John Mathew", "30000", "john@craftlanee.test"),
                                    ("Priya Nair", "45000", "priya@craftlanee.test")):
            e = self.ok(f.post("/api/employees", form={
                "full_name": name, "email": email, "designation": "Developer", "department": "Engineering",
                "joining_date": f"{year}-01-15", "monthly_salary": salary, "bank_account_number": "123456789012",
                "photo": (io.BytesIO(PNG), "me.png")}), 201)["employee"]
            ids.append(e["id"])
        john, priya = ids
        self.assertEqual(f.post("/api/employees", form={"full_name": ""}).status_code, 400)
        self.assertEqual(len(self.ok(f.get("/api/employees?q=john"))["employees"]), 1)
        self.ok(f.put(f"/api/employees/{john}", form={
            "full_name": "John Mathew", "emp_code": "CL-EMP-0001", "monthly_salary": "32000",
            "email": "john@craftlanee.test", "designation": "Developer", "department": "Engineering",
            "joining_date": f"{year}-01-15", "bank_account_number": "123456789012"}))

        # --- letters
        d = self.ok(f.get(f"/api/letters/offer/draft?employee_id={john}"))
        self.assertEqual(d["number_preview"], f"CL-OFFER-{year}-0001")
        offer = self.ok(f.post("/api/letters/offer", d["draft"]), 201)["letter"]
        self.pdf(f, offer["file_url"])
        jd = self.ok(f.get(f"/api/letters/joining/draft?employee_id={john}"))
        joining = self.ok(f.post("/api/letters/joining", jd["draft"]), 201)["letter"]
        self.assertEqual(joining["number"], f"CL-JOIN-{year}-0001")
        self.pdf(f, joining["file_url"])
        self.ok(f.put(f"/api/letters/offer/{offer['id']}", d["draft"] | {"salary": 33000}))
        self.assertEqual(len(self.ok(f.get("/api/letters/offer"))["letters"]), 1)
        self.ok(f.post(f"/api/letters/joining/{joining['id']}/archive"))
        self.assertEqual(len(self.ok(f.get("/api/letters/joining?show=archived"))["letters"]), 1)
        self.ok(f.post(f"/api/letters/joining/{joining['id']}/archive"))

        # --- MOU
        m = self.ok(f.post("/api/mous", {"party_name": "Acme College", "contact_person": "Dr. Rao",
                                         "start_date": f"{year}-01-01", "end_date": f"{year}-12-31",
                                         "purpose": "Training", "responsibilities": "One\nTwo"}), 201)["mou"]
        self.assertEqual(m["number"], f"CL-MOU-{year}-0001")
        self.pdf(f, m["file_url"])
        self.assertEqual(f.post("/api/mous", {"party_name": "X", "start_date": "2026-05-01",
                                              "end_date": "2026-01-01"}).status_code, 400)

        # --- payroll
        self.ok(f.post("/api/payroll", {"month": month}), 201)
        p = self.ok(f.get(f"/api/payroll/{month}"))
        rows = {r["employee"]["id"]: r["id"] for r in p["rows"]}
        p = self.ok(f.put(f"/api/payroll/{month}", {"rows": [
            {"id": rows[john], "basic": 30000, "allowances": 2000, "deductions": 1000, "bonus": 0},
            {"id": rows[priya], "basic": 45000, "allowances": 0, "deductions": 0, "bonus": 5000}]}))
        self.assertEqual(p["totals"]["net"], 81000)
        self.assertEqual(f.put(f"/api/payroll/{month}", {"rows": [{"id": rows[john], "basic": -1}]}).status_code, 400)
        p = self.ok(f.post(f"/api/payroll/{month}/finalize", {"generate_payslips": True}))
        self.assertEqual(p["posted"], 81000)
        self.assertEqual(p["generated"], 2)
        slips = {r["employee"]["id"]: r["payslip"] for r in p["rows"]}
        self.assertEqual(slips[john]["number"], f"CL-PS-{year}-0001")
        self.pdf(f, slips[john]["file_url"])
        self.assertEqual(len(self.ok(f.get("/api/payslips"))["payslips"]), 2)
        self.assertEqual(f.delete(f"/api/expenses/{p['expenses'][0]['id']}").status_code, 409)

        # --- income & expenses
        self.ok(f.post("/api/income", {"date": today, "source": "Website Project", "amount": 150000,
                                       "payment_status": "Received"}), 201)
        self.ok(f.post("/api/income", {"date": today, "source": "Training", "amount": 15000,
                                       "payment_status": "Pending"}), 201)
        self.assertEqual(f.post("/api/income", {"source": "x", "amount": 0}).status_code, 400)
        aws = self.ok(f.post("/api/expenses", form={
            "date": today, "category": "Server/Hosting", "description": "AWS", "amount": "4000",
            "receipt": (io.BytesIO(b"%PDF-1.4 x"), "r.pdf")}), 201)["row"]
        self.assertEqual(f.post("/api/expenses", form={
            "date": today, "category": "Other", "description": "bad", "amount": "1",
            "receipt": (io.BytesIO(b"x"), "evil.exe")}).status_code, 400)

        # --- numbers: 150000 − (81000 + 4000) = 65000
        dash = self.ok(f.get("/api/dashboard"))
        self.assertEqual(dash["totals"]["balance"], 65000)
        self.assertEqual(dash["totals"]["pending_income"], 15000)
        self.assertEqual(dash["people"]["monthly_payroll"], 77000)
        self.assertEqual(len(dash["trend"]), 6)
        for period in ("this_month", "last_month", "this_year", "all"):
            self.ok(f.get(f"/api/finance/summary?period={period}"))
        fs = self.ok(f.get(f"/api/finance/summary?period=custom&start={year}-01-01&end={year}-12-31"))
        self.assertEqual(fs["totals"]["payroll"], 81000)
        self.assertEqual(self.ok(f.get("/api/expenses?category=Salary"))["total"], 81000)
        self.assertEqual(self.ok(f.get("/api/income"))["received"], 150000)

        # --- documents, search, audit
        numbers = {i["number"] for i in self.ok(f.get("/api/documents"))["items"]}
        for n in (f"CL-OFFER-{year}-0001", f"CL-JOIN-{year}-0001", f"CL-MOU-{year}-0001", f"CL-PS-{year}-0001"):
            self.assertIn(n, numbers)
        res = self.ok(f.get("/api/search?q=john"))["results"]
        self.assertEqual(res["employees"][0]["full_name"], "John Mathew")
        self.assertTrue(self.ok(f.get("/api/search?q=EXP-0002"))["results"]["expenses"])
        actions = [a["action"] for a in self.ok(f.get("/api/audit"))["entries"]]
        self.assertIn("updated salary of John Mathew", actions)

        # --- other documents + login
        self.ok(f.post(f"/api/employees/{john}/documents",
                       form={"title": "Aadhaar", "file": (io.BytesIO(PNG), "a.png"), "visible": "1"}), 201)
        hidden = self.ok(f.post(f"/api/employees/{john}/documents",
                                form={"title": "Internal note", "file": (io.BytesIO(PNG), "n.png"),
                                      "visible": "0"}), 201)["document"]
        temp = self.ok(f.post(f"/api/employees/{john}/login", {"email": "john@craftlanee.test"}))["temp_password"]
        self.assertTrue(temp and len(temp) >= 8)
        self.ok(f.post(f"/api/employees/{priya}/login", {"email": "priya@craftlanee.test",
                                                        "password": "priyapass123"}))
        prof = self.ok(f.get(f"/api/employees/{john}"))["employee"]
        self.assertEqual(len(prof["payslips"]), 1)
        self.assertEqual(prof["login"]["email"], "john@craftlanee.test")

        # --- employee session
        e = Api(self.app)
        self.assertEqual(e.post("/api/auth/login", {"email": "john@craftlanee.test", "password": "x"}).status_code, 401)
        self.ok(e.post("/api/auth/login", {"email": "john@craftlanee.test", "password": temp}))
        me = self.ok(e.get("/api/me"))
        self.assertEqual(me["employee"]["full_name"], "John Mathew")
        self.assertNotIn("bank_account_number", me["employee"])
        self.assertEqual(me["payslips"][0]["net"], 31000)
        titles = [d["title"] for d in me["documents"]["other"]]
        self.assertIn("Aadhaar", titles)
        self.assertNotIn("Internal note", titles)
        self.pdf(e, slips[john]["file_url"])
        self.pdf(e, offer["file_url"])
        for url in ("/api/dashboard", "/api/employees", f"/api/employees/{priya}", "/api/finance/summary",
                    "/api/income", "/api/expenses", "/api/payroll", "/api/payslips", "/api/settings",
                    "/api/search?q=pr", "/api/documents", "/api/mous", "/api/audit", "/api/meta",
                    "/api/letters/offer"):
            self.assertEqual(e.get(url).status_code, 403, url)
        for url in (slips[priya]["file_url"], m["file_url"], aws["receipt_url"],
                    f"/files/doc/{hidden['id']}", "/files/signature/1"):
            self.assertEqual(e.get(url).status_code, 404, url)
        r = e.get(f"/files/photo/{priya}")  # active colleagues' photos are visible (team tree)
        self.assertEqual(r.status_code, 200)
        r.close()
        self.assertEqual(e.delete(f"/api/employees/{priya}", {"confirm_code": "CL-EMP-0002"}).status_code, 403)
        self.assertEqual(e.c.post("/api/auth/password", json={}).status_code, 400)  # CSRF enforced
        self.ok(e.post("/api/auth/password", {"current": temp, "new": "johnsnewpass"}))

        self.assertEqual(f.get("/api/me").status_code, 403)  # founder has no employee portal

        # deactivation ends the employee's session
        self.ok(f.post(f"/api/employees/{john}/toggle-status"))
        self.assertEqual(e.get("/api/me").status_code, 401)

        anon = Api(self.app)
        self.assertEqual(anon.get("/api/dashboard").status_code, 401)
        self.assertEqual(anon.get(offer["file_url"]).status_code, 302)

        # delete requires exact ID; payroll expense survives
        self.assertEqual(f.delete(f"/api/employees/{priya}", {"confirm_code": "nope"}).status_code, 400)
        self.ok(f.delete(f"/api/employees/{priya}", {"confirm_code": "CL-EMP-0002"}))
        self.assertEqual(f.get(f"/api/employees/{priya}").status_code, 404)
        self.assertEqual(self.ok(f.get("/api/expenses?category=Salary"))["total"], 81000)

    def test_helpers(self):
        self.assertEqual(inr(280000), "₹2,80,000")
        self.assertEqual(inr(-1500), "-₹1,500")
        self.assertEqual(amount_in_words(31000), "Rupees Thirty One Thousand Only")
        self.assertEqual(amount_in_words(1250000), "Rupees Twelve Lakh Fifty Thousand Only")


if __name__ == "__main__":
    unittest.main()
