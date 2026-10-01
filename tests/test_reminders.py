"""Follow-up reminders: date + time, the browser feed, and once-only reminder emails."""
import os
import shutil
import tempfile
import unittest
from datetime import datetime, timedelta
from unittest import mock

os.environ.setdefault("CRAFTLANEE_SECRET_KEY", "test-secret")

from craftlanee import create_app, reminders  # noqa: E402
from test_flow import Api  # noqa: E402


class RemindersTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.app = create_app({"SQLALCHEMY_DATABASE_URI": "sqlite:///" + os.path.join(cls.tmp, "r.db"),
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

    def test_parse_time(self):
        self.assertEqual(reminders.parse_time("9:05"), "09:05")
        self.assertEqual(reminders.parse_time("23:59:00"), "23:59")
        for bad in ("", None, "24:00", "7pm", "12:6"):
            self.assertIsNone(reminders.parse_time(bad), bad)

    def test_reminders(self):
        f = Api(self.app)
        self.ok(f.post("/api/auth/setup", {"company_name": "CraftLanee", "name": "Arjun", "email": "a@c.in",
                                           "password": "founderpass"}))
        t = datetime.now()
        past, future = t - timedelta(minutes=5), t + timedelta(hours=1)
        if future.date() != t.date():  # just before midnight: keep "later today" on today
            future = t + timedelta(seconds=30)
        mk = lambda name, day, at=None: self.ok(f.post("/api/followups", {  # noqa: E731
            "name": name, "next_followup": day.isoformat(), "next_followup_time": at or ""}), 201)["lead"]

        due = mk("Due now", past.date(), past.strftime("%H:%M"))
        self.assertEqual(due["next_followup_time"], past.strftime("%H:%M"))
        later = mk("Later today", future.date(), future.strftime("%H:%M"))
        tomorrow = mk("Tomorrow", (t + timedelta(days=1)).date(), "11:00")
        self.assertTrue(tomorrow["remind_at"].endswith("T11:00:00"))
        undated = self.ok(f.post("/api/followups", {"name": "No date", "next_followup_time": "10:00"}), 201)["lead"]
        self.assertIsNone(undated["next_followup_time"])  # a time without a date is dropped

        feed = self.ok(f.get("/api/followups/reminders"))
        self.assertIn(due["id"], [l["id"] for l in feed["due"]])
        self.assertNotIn(tomorrow["id"], [l["id"] for l in feed["due"]])
        if future.strftime("%H:%M") > t.strftime("%H:%M"):
            self.assertIn(later["id"], [l["id"] for l in feed["later_today"]])

        # email settings: only the settings area; turning on needs a server
        self.assertEqual(f.put("/api/followups/email-settings", {"enabled": True}).status_code, 400)
        st = self.ok(f.put("/api/followups/email-settings", {
            "enabled": True, "smtp_host": "smtp.example.com", "smtp_port": "587", "smtp_user": "bot@c.in",
            "smtp_password": "secret", "app_url": "http://crm.local/"}))["settings"]
        self.assertTrue(st["ready"] and st["password_set"])
        self.assertEqual((st["smtp_from"], st["app_url"]), ("bot@c.in", "http://crm.local"))
        self.assertNotIn("smtp_password", st)
        self.assertEqual([r["email"] for r in st["recipients"]], ["a@c.in"])
        # saving without a password keeps the stored one
        st = self.ok(f.put("/api/followups/email-settings", st | {"smtp_password": ""}))["settings"]
        self.assertTrue(st["password_set"])

        with self.app.app_context(), mock.patch.object(reminders, "send_mail") as send:
            self.assertEqual(reminders.send_due_emails(), 1)
            (_, to, subject, text, html), _ = send.call_args
            self.assertEqual(to, ["a@c.in"])
            self.assertIn("Due now", subject)
            self.assertIn("http://crm.local/followups", text)
            # once only
            self.assertEqual(reminders.send_due_emails(), 0)
            # an hour later "Later today" is due too, and only it is emailed
            self.assertEqual(reminders.send_due_emails(at=future + timedelta(minutes=1)), 1)
            self.assertIn("Later today", send.call_args[0][2])

            # a failed send marks nothing, so it is retried
            send.reset_mock()
            send.side_effect = OSError("connection refused")
            again = self.ok(f.put(f"/api/followups/{due['id']}", {"name": "Due now", "next_followup":
                            past.date().isoformat(), "next_followup_time": (past - timedelta(minutes=1)).strftime("%H:%M")}))
            self.assertEqual(again["lead"]["name"], "Due now")
            with self.assertRaises(OSError):
                reminders.send_due_emails()
            send.side_effect = None
            self.assertEqual(reminders.send_due_emails(), 1)  # re-armed by the new time, sent on retry

            # closing a lead stops its reminders
            self.ok(f.post(f"/api/followups/{tomorrow['id']}/log", {"kind": "Call", "body": "Done", "status": "won"}))
            self.assertEqual(reminders.send_due_emails(at=t + timedelta(days=1, hours=3)), 0)

            # turned off: nothing is sent
            self.ok(f.put("/api/followups/email-settings", st | {"enabled": False}))
            self.ok(f.put(f"/api/followups/{due['id']}", {"name": "Due now", "next_followup": past.date().isoformat(),
                                                          "next_followup_time": "00:00"}))
            self.assertEqual(reminders.send_due_emails(), 0)

        # an admin without the settings area can't read or change mail settings
        emp = self.ok(f.post("/api/employees", form={"full_name": "Sita", "monthly_salary": "1",
                                                     "roles": '["Sales"]'}), 201)["employee"]
        self.ok(f.post(f"/api/employees/{emp['id']}/login", {"email": "s@c.in", "password": "password123"}))
        self.ok(f.post(f"/api/employees/{emp['id']}/admin", {"permissions": ["followups"]}))
        sales = Api(self.app)
        self.ok(sales.post("/api/auth/login", {"email": "s@c.in", "password": "password123"}))
        self.ok(sales.get("/api/followups/reminders"))
        self.assertEqual(sales.get("/api/followups/email-settings").status_code, 403)
        self.assertEqual(sales.post("/api/followups/email-test").status_code, 403)
        with self.app.app_context():
            self.assertEqual(sorted(u.email for u in reminders.recipients()), ["a@c.in", "s@c.in"])


if __name__ == "__main__":
    unittest.main()
