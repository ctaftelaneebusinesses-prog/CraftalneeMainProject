"""Where stored files (uploads and generated PDFs) live.

Everything goes through put / get / delete with a relative key such as "payslips/<uuid>.pdf"
— the same value saved in the database's *_path columns.

  * Local disk (default): instance/storage/<key>. Used for development and tests.
  * Supabase Storage: set SUPABASE_URL and SUPABASE_SERVICE_KEY (optionally SUPABASE_BUCKET,
    default "craftlanee"). The bucket should be *private*: files are only ever handed out by
    the /files route, which checks permissions first. The service key stays on the server.
"""
import json
import os
import urllib.error
import urllib.parse
import urllib.request

from flask import abort, current_app


class LocalStorage:
    def __init__(self, root):
        self.root = os.path.realpath(root)

    def _path(self, key):
        full = os.path.realpath(os.path.join(self.root, key or ""))
        if not full.startswith(self.root + os.sep):
            abort(404)
        return full

    def put(self, key, data, content_type=None):  # noqa: ARG002 - same signature as Supabase
        path = self._path(key)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as fh:
            fh.write(data)

    def get(self, key):
        try:
            with open(self._path(key), "rb") as fh:
                return fh.read()
        except OSError:
            return None

    def delete(self, key):
        try:
            os.remove(self._path(key))
        except OSError:
            pass


class SupabaseStorage:
    """Supabase Storage over its REST API (stdlib only)."""

    def __init__(self, url, key, bucket, timeout=30):
        self.base = url.rstrip("/") + "/storage/v1"
        self.key, self.bucket, self.timeout = key, bucket, timeout

    def _request(self, method, path, data=None, headers=None):
        req = urllib.request.Request(f"{self.base}/{path}", data=data, method=method, headers={
            "Authorization": f"Bearer {self.key}", "apikey": self.key, **(headers or {})})
        return urllib.request.urlopen(req, timeout=self.timeout)  # noqa: S310 - fixed https base URL

    def ensure_bucket(self, logger=None):
        """Create the private bucket on first start; "already exists" is fine."""
        body = json.dumps({"id": self.bucket, "name": self.bucket, "public": False}).encode()
        try:
            with self._request("POST", "bucket", body, {"Content-Type": "application/json"}) as resp:
                resp.read()
        except urllib.error.HTTPError as err:
            if err.code not in (400, 409) and logger:  # 400/409 = the bucket is already there
                logger.warning("Could not create Supabase bucket %r: HTTP %s", self.bucket, err.code)
        except urllib.error.URLError as err:
            if logger:
                logger.warning("Supabase Storage unreachable at startup: %s", err.reason)

    def _object(self, key):
        return f"object/{self.bucket}/{urllib.parse.quote(key)}"

    def put(self, key, data, content_type=None):
        with self._request("POST", self._object(key), data, {
                "Content-Type": content_type or "application/octet-stream", "x-upsert": "true",
                "Cache-Control": "no-cache"}) as resp:
            resp.read()

    def get(self, key):
        try:
            with self._request("GET", self._object(key)) as resp:
                return resp.read()
        except urllib.error.HTTPError as err:
            if err.code in (400, 404):  # Supabase answers 400 "Object not found" for missing keys
                return None
            raise

    def delete(self, key):
        try:
            with self._request("DELETE", f"object/{self.bucket}", json.dumps({"prefixes": [key]}).encode(),
                               {"Content-Type": "application/json"}) as resp:
                resp.read()
        except urllib.error.URLError:
            pass  # a leftover file must never break a request


def _env(name, default=""):
    """Environment value without surrounding whitespace: values pasted into a dashboard often end in a newline."""
    return (os.environ.get(name) or default).strip()


def configured_backend(config):
    url, key = _env("SUPABASE_URL"), _env("SUPABASE_SERVICE_KEY")
    if config.get("STORAGE_BACKEND") != "local" and url and key:
        return SupabaseStorage(url, key, _env("SUPABASE_BUCKET", "craftlanee"))
    return LocalStorage(config["STORAGE_DIR"])


def backend():
    return current_app.extensions["craftlanee_storage"]
