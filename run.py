"""Development API server: python run.py → http://127.0.0.1:5000

For UI development run the Vite dev server alongside it (it proxies /api and /files here):
    cd frontend && npm run dev   → http://127.0.0.1:5173
"""
from craftlanee import create_app

app = create_app()

if __name__ == "__main__":
    app.run(debug=True)
