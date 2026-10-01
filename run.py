"""Development API server: python run.py → http://127.0.0.1:5000

For UI development run the Vite dev server alongside it (it proxies /api and /files here):
    cd frontend && npm run dev   → http://127.0.0.1:5173
"""
import os

from craftlanee import create_app, reminders

app = create_app()

if __name__ == "__main__":
    if os.environ.get("WERKZEUG_RUN_MAIN") == "true":  # the reloader's child, so emails aren't sent twice
        reminders.start(app)
    app.run(debug=True)
