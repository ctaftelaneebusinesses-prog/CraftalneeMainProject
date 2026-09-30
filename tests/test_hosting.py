"""Hosting: Supabase Storage backend (against a fake Supabase), setup code, database URL handling."""
import io
import json
import os
import shutil
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest import mock

os.environ.setdefault("CRAFTLANEE_SECRET_KEY", "test-secret")

from craftlanee import create_app, database_url  # noqa: E402
from test_flow import PNG, Api  # noqa: E402

KEY = "service-role-test-key"


class FakeSupabase(BaseHTTPRequestHandler):
    """Just enough of Supabase Storage's REST API: POST/GET /object/<bucket>/<key>, DELETE /object/<bucket>."""
    objects, calls, buckets = {}, [], []

    def _authorised(self):
        ok = self.headers.get("Authorization") == f"Bearer {KEY}" and self.headers.get("apikey") == KEY
        if not ok:
            self._send(403, b'{"error":"Unauthorized"}')
        return ok

    def _send(self, code, body=b"", ctype="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _key(self):
        prefix = "/storage/v1/object/craftlanee/"
        return self.path[len(prefix):] if self.path.startswith(prefix) else None

    def do_POST(self):  # noqa: N802
        if not self._authorised():
            return
        data = self.rfile.read(int(self.headers["Content-Length"]))
        if self.path == "/storage/v1/bucket":
            self.buckets.append(json.loads(data))
            return self._send(400 if len(self.buckets) > 1 else 200, b"{}")  # second time: "already exists"
        self.objects[self._key()] = (data, self.headers.get("Content-Type"))
        self.calls.append(("POST", self._key(), self.headers.get("x-upsert")))
        self._send(200, b'{"Key":"ok"}')

    def do_GET(self):  # noqa: N802
        if not self._authorised():
            return
        item = self.objects.get(self._key())
        if item is None:  # real Supabase answers 400 "Object not found"
            return self._send(400, b'{"statusCode":"404","error":"not_found"}')
        self._send(200, item[0], item[1] or "application/octet-stream")

    def do_DELETE(self):  # noqa: N802
        if not self._authorised():
            return
        prefixes = json.loads(self.rfile.read(int(self.headers["Content-Length"])))["prefixes"]
        for p in prefixes:
            self.objects.pop(p, None)
        self.calls.append(("DELETE", prefixes[0], None))
        self._send(200, b"[]")

    def log_message(self, *args):  # keep test output quiet
        pass


class HostingTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), FakeSupabase)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.tmp = tempfile.mkdtemp()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def ok(self, r, code=200):
        self.assertEqual(r.status_code, code, r.data[:400].decode("utf-8", "replace"))
        return r.get_json()

    def make_app(self, name, **env):
        with mock.patch.dict(os.environ, env):
            app = create_app({"SQLALCHEMY_DATABASE_URI": "sqlite:///" + os.path.join(self.tmp, f"{name}.db"),
                              "STORAGE_DIR": os.path.join(self.tmp, f"{name}-storage")})
        self.addCleanup(self._dispose, app)
        return app

    def _dispose(self, app):
        from craftlanee.extensions import db
        with app.app_context():
            db.engine.dispose()

    def test_files_go_to_supabase_storage(self):
        url = f"http://127.0.0.1:{self.server.server_address[1]}"
        app = self.make_app("supa", SUPABASE_URL=url, SUPABASE_SERVICE_KEY=KEY)
        self.assertEqual(FakeSupabase.buckets, [{"id": "craftlanee", "name": "craftlanee", "public": False}])
        self.make_app("supa2", SUPABASE_URL=url, SUPABASE_SERVICE_KEY=KEY)  # restart: "already exists" is fine
        f = Api(app)
        self.ok(f.post("/api/auth/setup", {"company_name": "CraftLanee", "name": "Arjun", "email": "a@c.in",
                                           "password": "founderpass"}))
        # company logo + employee photo uploads, then generated PDFs that embed the logo
        self.ok(f.post("/api/settings", form={"company_name": "CraftLanee", "logo": (io.BytesIO(PNG), "logo.png")}))
        emp = self.ok(f.post("/api/employees", form={"full_name": "Asha", "monthly_salary": "30000", "roles": '["Dev"]',
                                                     "photo": (io.BytesIO(PNG), "asha.png")}), 201)["employee"]
        inv = self.ok(f.post("/api/invoices", {"client_name": "Acme", "items": [{"description": "Work", "qty": 1, "rate": 100}]}), 201)["invoice"]

        keys = set(FakeSupabase.objects)
        self.assertTrue(any(k.startswith("company/") for k in keys))
        self.assertTrue(any(k.startswith("photos/") for k in keys))
        pdf_key = next(k for k in keys if k.startswith("invoices/"))
        self.assertEqual(FakeSupabase.objects[pdf_key][1], "application/pdf")
        self.assertTrue(FakeSupabase.objects[pdf_key][0].startswith(b"%PDF"))
        self.assertTrue(all(c[2] == "true" for c in FakeSupabase.calls if c[0] == "POST"))  # upsert on regenerate
        self.assertFalse(os.path.exists(os.path.join(self.tmp, "supa-storage")))  # nothing written to local disk

        # served back through the permission-checked /files route
        r = f.get(inv["file_url"])
        self.assertEqual((r.status_code, r.mimetype), (200, "application/pdf"))
        self.assertTrue(r.data.startswith(b"%PDF"))
        self.assertEqual(f.get(emp["photo_url"]).data, PNG)

        # deleting the invoice deletes the stored PDF; a missing object is a clean 404
        self.ok(f.delete(f"/api/invoices/{inv['id']}"))
        self.assertNotIn(pdf_key, FakeSupabase.objects)
        FakeSupabase.objects.pop(next(k for k in FakeSupabase.objects if k.startswith("photos/")))
        self.assertEqual(f.get(emp["photo_url"]).status_code, 404)

    def test_setup_code_guards_first_run(self):
        app = self.make_app("setup", CRAFTLANEE_SETUP_CODE="open-sesame")
        with mock.patch.dict(os.environ, {"CRAFTLANEE_SETUP_CODE": "open-sesame"}):
            f = Api(app)
            self.assertTrue(self.ok(f.get("/api/auth/session"))["setup_code_required"])
            form = {"company_name": "CraftLanee", "name": "Arjun", "email": "a@c.in", "password": "founderpass"}
            self.assertEqual(f.post("/api/auth/setup", form).status_code, 403)
            self.assertEqual(f.post("/api/auth/setup", form | {"setup_code": "wrong"}).status_code, 403)
            self.ok(f.post("/api/auth/setup", form | {"setup_code": "open-sesame"}))
            self.assertFalse(self.ok(f.get("/api/auth/session"))["setup_code_required"])

    def test_database_url_accepts_supabase_formats(self):
        cases = {
            "postgresql://postgres.abc:pw@aws-0-ap-south-1.pooler.supabase.com:5432/postgres":
                "postgresql+psycopg://postgres.abc:pw@aws-0-ap-south-1.pooler.supabase.com:5432/postgres",
            "postgres://u:p@h:5432/d": "postgresql+psycopg://u:p@h:5432/d",
            "postgresql+psycopg://u:p@h/d": "postgresql+psycopg://u:p@h/d",
            "postgresql://u:p@h:5432/postgres\n": "postgresql+psycopg://u:p@h:5432/postgres",  # pasted with Enter
            "  postgres://u:p@h/d \r\n": "postgresql+psycopg://u:p@h/d",
        }
        for given, expected in cases.items():
            with mock.patch.dict(os.environ, {"CRAFTLANEE_DATABASE_URL": given}):
                self.assertEqual(database_url("/x"), expected)
        with mock.patch.dict(os.environ, {"CRAFTLANEE_DATABASE_URL": "", "DATABASE_URL": ""}):
            self.assertTrue(database_url("/x").startswith("sqlite:///"))


if __name__ == "__main__":
    unittest.main()
