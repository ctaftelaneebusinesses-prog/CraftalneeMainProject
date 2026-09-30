"""Production server (Waitress, works on Windows and Linux).

    python serve.py                 # http://0.0.0.0:8080
    set CRAFTLANEE_PORT=9000        # optional; hosts like Render set PORT instead
"""
import os

from waitress import serve

from craftlanee import create_app

if __name__ == "__main__":
    host = os.environ.get("CRAFTLANEE_HOST", "0.0.0.0")
    port = int(os.environ.get("CRAFTLANEE_PORT") or os.environ.get("PORT") or "8080")
    print(f"CraftLanee running on http://{host}:{port}")
    serve(create_app(), host=host, port=port, threads=8)
