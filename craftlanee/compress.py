"""Gzip for text responses (API JSON, HTML, JS, CSS, SVG) — Waitress doesn't compress on its own.

The React bundle shrinks to about a third, which matters most on mobile data. Hashed files under
/assets/ never change, so each is compressed once and then served from memory.
"""
import gzip

from flask import request

COMPRESSIBLE = {"application/json", "text/html", "text/css", "text/plain", "application/javascript",
                "text/javascript", "image/svg+xml", "application/manifest+json"}
MIN_SIZE = 1024
_ASSET_CACHE = {}  # request path -> gzipped bytes (immutable, content-hashed files only)


def gzip_response(response):
    if (response.status_code != 200 or "gzip" not in request.headers.get("Accept-Encoding", "").lower()
            or response.headers.get("Content-Encoding") or response.mimetype not in COMPRESSIBLE):
        return response
    response.headers.add("Vary", "Accept-Encoding")
    response.direct_passthrough = False  # files from send_from_directory are streamed; read (and close) them
    data = response.get_data()
    if len(data) < MIN_SIZE:
        return response
    immutable = request.path.startswith("/assets/")
    body = _ASSET_CACHE.get(request.path) if immutable else None
    if body is None:
        body = gzip.compress(data, compresslevel=9 if immutable else 5)
        if immutable and len(_ASSET_CACHE) < 256:
            _ASSET_CACHE[request.path] = body
    response.set_data(body)
    response.headers["Content-Encoding"] = "gzip"
    response.headers["Content-Length"] = str(len(body))
    return response
