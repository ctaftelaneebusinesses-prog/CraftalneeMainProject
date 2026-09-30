# CraftLanee — one image: builds the React UI, then serves it and the API with Waitress.
# Data lives outside the container (Supabase Postgres + Supabase Storage), so it can be rebuilt freely.

# ---- 1. build the React frontend
FROM node:22-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- 2. Python runtime
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    CRAFTLANEE_FRONTEND_DIST=/app/frontend/dist
WORKDIR /app
COPY requirements.txt ./
RUN pip install -r requirements.txt
COPY craftlanee/ ./craftlanee/
COPY serve.py ./
COPY --from=web /web/dist ./frontend/dist

# Run as an unprivileged user; instance/ only holds throwaway local state on the host.
RUN useradd --create-home --uid 10001 app && mkdir -p /app/instance && chown -R app /app/instance
USER app

EXPOSE 8080
CMD ["python", "serve.py"]
