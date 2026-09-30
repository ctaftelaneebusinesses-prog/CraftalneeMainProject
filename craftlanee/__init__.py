"""CraftLanee — simple internal company management.

Founder: employees, letters, MOUs, payroll, payslips, income, expenses, balance.
Employee: their own profile, documents and payslips only.
"""
import os
import secrets
import warnings
from datetime import timedelta

import click
from flask import Flask, abort, jsonify, redirect, request, send_from_directory
from sqlalchemy import event
from sqlalchemy import exc as sa_exc
from sqlalchemy.engine import Engine

from .extensions import db, login_manager
from .security import csrf_protect, set_security_headers

warnings.filterwarnings("ignore", category=sa_exc.SAWarning, message=".*Decimal.*")


@event.listens_for(Engine, "connect")
def _sqlite_pragmas(dbapi_connection, _record):
    if dbapi_connection.__class__.__module__.startswith("sqlite3"):
        cur = dbapi_connection.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.execute("PRAGMA journal_mode=WAL")
        cur.close()


def _secret_key(instance_path):
    env = os.environ.get("CRAFTLANEE_SECRET_KEY")
    if env:
        return env
    key_file = os.path.join(instance_path, "secret_key")
    if not os.path.exists(key_file):
        with open(key_file, "w", encoding="utf-8") as fh:
            fh.write(secrets.token_hex(32))
    with open(key_file, encoding="utf-8") as fh:
        return fh.read().strip()


def _migrate():
    """Additive, idempotent schema upgrade: add any model column missing from an existing table.

    Keeps existing databases working as the app grows (no data is ever dropped).
    """
    from sqlalchemy import inspect, text
    insp = inspect(db.engine)
    with db.engine.begin() as conn:
        for table in db.metadata.sorted_tables:
            if not insp.has_table(table.name):
                continue
            existing = {c["name"] for c in insp.get_columns(table.name)}
            for col in table.columns:
                if col.name in existing:
                    continue
                ddl = f'ALTER TABLE "{table.name}" ADD COLUMN "{col.name}" {col.type.compile(db.engine.dialect)}'
                default = getattr(col.default, "arg", None)
                if isinstance(default, bool):  # TRUE/FALSE work on both SQLite and Postgres (1/0 don't on Postgres)
                    ddl += f" DEFAULT {'TRUE' if default else 'FALSE'}"
                elif isinstance(default, (int, float)):
                    ddl += f" DEFAULT {default}"
                elif isinstance(default, str):
                    ddl += " DEFAULT '" + default.replace("'", "''") + "'"
                conn.execute(text(ddl))


def database_url(instance_path):
    """CRAFTLANEE_DATABASE_URL (or DATABASE_URL) as given by Supabase/Render, else local SQLite.

    "postgres://" and bare "postgresql://" are pointed at the psycopg 3 driver.
    """
    url = os.environ.get("CRAFTLANEE_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not url:
        return "sqlite:///" + os.path.join(instance_path, "craftlanee.db")
    for prefix in ("postgres://", "postgresql://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


def _engine_options(url):
    if not url.startswith("postgresql"):
        return {}
    # pre_ping + recycle: survive the host sleeping and Supabase closing idle connections.
    # prepare_threshold=None: works through Supabase's pgbouncer poolers (no server-side prepared statements).
    return {"pool_pre_ping": True, "pool_recycle": 280, "pool_size": 5, "max_overflow": 5,
            "connect_args": {"prepare_threshold": None, "connect_timeout": 10}}


def create_app(test_config=None):
    app = Flask(__name__, instance_relative_config=True, static_folder=None)
    os.makedirs(app.instance_path, exist_ok=True)

    db_url = database_url(app.instance_path)
    app.config.update(
        SECRET_KEY=_secret_key(app.instance_path),
        SQLALCHEMY_DATABASE_URI=db_url,
        SQLALCHEMY_ENGINE_OPTIONS=_engine_options(db_url),
        STORAGE_DIR=os.path.join(app.instance_path, "storage"),
        MAX_CONTENT_LENGTH=15 * 1024 * 1024,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=os.environ.get("CRAFTLANEE_SECURE_COOKIES") == "1",
        PERMANENT_SESSION_LIFETIME=timedelta(hours=12),
        REMEMBER_COOKIE_HTTPONLY=True,
    )
    if test_config:
        app.config.update(test_config)
    from .storage import LocalStorage, configured_backend
    store = app.extensions["craftlanee_storage"] = configured_backend(app.config)
    if isinstance(store, LocalStorage):
        os.makedirs(app.config["STORAGE_DIR"], exist_ok=True)
    else:
        store.ensure_bucket(app.logger)

    if os.environ.get("CRAFTLANEE_BEHIND_PROXY") == "1":
        # Behind Render's (or any) HTTPS proxy: trust one hop for the client IP (login throttling) and scheme.
        from werkzeug.middleware.proxy_fix import ProxyFix
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1)

    db.init_app(app)
    login_manager.init_app(app)

    from . import models  # noqa: F401  (register tables)

    @login_manager.user_loader
    def load_user(user_id):
        return db.session.get(models.User, int(user_id))

    from . import files
    from .api import bp as api_bp
    app.register_blueprint(api_bp)
    app.register_blueprint(files.bp)

    app.before_request(csrf_protect)
    app.after_request(set_security_headers)

    def _is_api():
        return request.path.startswith("/api/")

    @login_manager.unauthorized_handler
    def _unauthorized():
        if _is_api():
            return jsonify(error="Please sign in to continue."), 401
        return redirect("/login?next=" + request.full_path.rstrip("?"))

    messages = {400: "The request could not be completed.", 403: "You don't have permission to do that.",
                404: "Not found.", 405: "Method not allowed.", 413: "Uploads are limited to 15 MB.",
                500: "Something went wrong on the server."}
    for code, message in messages.items():
        def handler(err, code=code, message=message):
            desc = getattr(err, "description", None) if code == 400 else None
            if _is_api() or request.path.startswith("/files/"):
                return jsonify(error=desc or message), code
            return _spa()
        app.register_error_handler(code, handler)

    # ---------------------------------------------------------------- React frontend
    dist = os.path.abspath(os.environ.get(
        "CRAFTLANEE_FRONTEND_DIST", os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")))

    def _spa():
        index = os.path.join(dist, "index.html")
        if not os.path.exists(index):
            return ("<h2 style='font-family:sans-serif'>Frontend not built.</h2>"
                    "<p style='font-family:sans-serif'>Run <code>npm install && npm run build</code> "
                    "in the <code>frontend</code> folder, or use <code>start.bat</code>.</p>"), 503
        response = send_from_directory(dist, "index.html")
        response.headers["Cache-Control"] = "no-cache"
        return response

    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def frontend(path):
        if path.startswith(("api/", "files/")):
            abort(404)
        full = os.path.join(dist, path)
        if path and os.path.isfile(full) and os.path.realpath(full).startswith(os.path.realpath(dist)):
            response = send_from_directory(dist, path)
            if path.startswith("assets/"):  # hashed filenames — cache forever
                response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
            return response
        return _spa()

    with app.app_context():
        db.create_all()
        _migrate()

    _register_cli(app)
    return app


def _register_cli(app):
    @app.cli.command("create-founder")
    @click.option("--name", prompt=True)
    @click.option("--email", prompt=True)
    @click.password_option()
    def create_founder(name, email, password):
        """Create the founder/admin account."""
        from .models import ROLE_FOUNDER, User
        if User.query.filter_by(email=email.lower()).first():
            raise click.ClickException("A user with that email already exists.")
        user = User(name=name, email=email.lower(), role=ROLE_FOUNDER)
        user.set_password(password)
        db.session.add(user)
        db.session.commit()
        click.echo(f"Founder account created for {email}.")

    @app.cli.command("reset-password")
    @click.option("--email", prompt=True)
    @click.password_option()
    def reset_password(email, password):
        """Reset any user's password from the server console."""
        from .models import User
        user = User.query.filter_by(email=email.lower()).first()
        if not user:
            raise click.ClickException("No user with that email.")
        user.set_password(password)
        db.session.commit()
        click.echo("Password updated.")
