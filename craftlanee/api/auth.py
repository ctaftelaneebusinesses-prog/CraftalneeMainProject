import hmac
import os
import time
from collections import defaultdict

from flask import request, session
from flask_login import current_user, login_required, login_user, logout_user

from ..extensions import db
from ..models import ROLE_FOUNDER, User, now
from ..security import csrf_token
from ..utils import audit, clean, get_settings
from .common import bp, company, employee_brief, fail, fail_if, iso, ok

# In-memory throttle: 8 failed attempts per email+IP within 10 minutes.
_FAILS = defaultdict(list)
_WINDOW, _LIMIT = 600, 8


def _throttled(key):
    cutoff = time.time() - _WINDOW
    _FAILS[key] = [t for t in _FAILS[key] if t > cutoff]
    return len(_FAILS[key]) >= _LIMIT


def user_payload(user):
    if not user or not user.is_authenticated:
        return None
    return {"id": user.id, "name": user.name, "email": user.email, "role": user.role,
            "is_admin": user.has_admin, "is_owner": user.is_founder, "permissions": sorted(user.perms),
            "full_access": user.full_access,
            "employee": employee_brief(user.employee) if user.employee else None}


def _needs_setup():
    return User.query.filter_by(role=ROLE_FOUNDER).first() is None


@bp.get("/auth/session")
def session_info():
    """Bootstrap for the SPA: who am I, CSRF token, and whether first-run setup is needed."""
    setup = _needs_setup()
    return ok(user=user_payload(current_user), csrf=csrf_token(), setup_required=setup,
              setup_code_required=setup and bool(_setup_code()),
              company=company(get_settings()) if not setup else None)


def _setup_code():
    """On a public server, CRAFTLANEE_SETUP_CODE stops strangers claiming the founder account first."""
    return os.environ.get("CRAFTLANEE_SETUP_CODE", "").strip()


@bp.post("/auth/login")
def login():
    data = request.get_json(silent=True) or {}
    email = clean(data, "email").lower()
    password = str(data.get("password") or "")
    key = f"{email}|{request.remote_addr}"
    if _throttled(key):
        fail("Too many failed attempts. Please wait a few minutes and try again.", 429)
    user = User.query.filter_by(email=email).first()
    if not user or not user.check_password(password):
        _FAILS[key].append(time.time())
        fail("Incorrect email or password.", 401)
    if not user.is_active:
        fail("Your account is inactive. Please contact the founder.", 403)
    _FAILS.pop(key, None)
    session.clear()
    login_user(user, remember=bool(data.get("remember")))
    session.permanent = True
    user.last_login_at = now()
    db.session.commit()
    return ok(user=user_payload(user), csrf=csrf_token())


@bp.post("/auth/logout")
def logout():
    # Clear the session FIRST: logout_user() leaves a flag in the session that tells Flask-Login to
    # delete the "remember me" cookie. Clearing afterwards would wipe that flag and keep the user signed in.
    session.clear()
    logout_user()
    return ok(csrf=csrf_token())


@bp.post("/auth/setup")
def setup():
    if not _needs_setup():
        fail("Setup has already been completed.", 409)
    data = request.get_json(silent=True) or {}
    code = _setup_code()
    if code:
        key = f"setup|{request.remote_addr}"
        if _throttled(key):
            fail("Too many attempts. Please wait a few minutes and try again.", 429)
        if not hmac.compare_digest(str(data.get("setup_code") or "").strip(), code):
            _FAILS[key].append(time.time())
            fail("That setup code isn't right. It's the CRAFTLANEE_SETUP_CODE value set on the server.", 403)
    name, email = clean(data, "name", 120), clean(data, "email", 160).lower()
    password = str(data.get("password") or "")
    errors = []
    if not name or "@" not in email:
        errors.append("Please enter your name and a valid email.")
    if len(password) < 8:
        errors.append("Password must be at least 8 characters.")
    fail_if(errors)
    user = User(name=name, email=email, role=ROLE_FOUNDER)
    user.set_password(password)
    db.session.add(user)
    settings = get_settings()
    settings.company_name = clean(data, "company_name", 160) or "CraftLanee"
    settings.founder_name = name
    db.session.commit()
    session.clear()
    login_user(user)
    audit(f"set up the {settings.company_name} workspace", "settings")
    db.session.commit()
    return ok(user=user_payload(user), csrf=csrf_token(), company=company(settings))


@bp.post("/auth/password")
@login_required
def change_password():
    data = request.get_json(silent=True) or {}
    new = str(data.get("new") or "")
    if not current_user.check_password(str(data.get("current") or "")):
        fail("Current password is incorrect.")
    if len(new) < 8:
        fail("New password must be at least 8 characters.")
    current_user.set_password(new)
    db.session.commit()
    return ok(message="Password updated.")


# ------------------------------------------------------------------ extra founder logins
# Every founder account has full access. Only a founder can see, add or remove them.

def _owner_only():
    if not current_user.is_founder:
        fail("Only the founder can manage admin logins.", 403)


def _admin_row(u):
    return {"id": u.id, "name": u.name, "email": u.email, "active": u.active,
            "last_login_at": iso(u.last_login_at), "created_at": iso(u.created_at), "is_me": u.id == current_user.id}


@bp.get("/auth/admins")
@login_required
def admins_list():
    _owner_only()
    rows = User.query.filter_by(role=ROLE_FOUNDER).order_by(User.created_at).all()
    return ok(admins=[_admin_row(u) for u in rows])


@bp.post("/auth/admins")
@login_required
def admins_create():
    _owner_only()
    data = request.get_json(silent=True) or {}
    name, email = clean(data, "name", 120), clean(data, "email", 160).lower()
    password = str(data.get("password") or "")
    errors = []
    if not name or "@" not in email:
        errors.append("Please enter a name and a valid email.")
    elif User.query.filter_by(email=email).first():
        errors.append("That email already has a login.")
    if len(password) < 8:
        errors.append("Password must be at least 8 characters.")
    fail_if(errors)
    user = User(name=name, email=email, role=ROLE_FOUNDER)
    user.set_password(password)
    db.session.add(user)
    audit(f"added admin login {email}", "settings")
    db.session.commit()
    return ok(admin=_admin_row(user), message="Admin login created.")


@bp.delete("/auth/admins/<int:user_id>")
@login_required
def admins_delete(user_id):
    _owner_only()
    user = db.session.get(User, user_id)
    if not user or user.role != ROLE_FOUNDER:
        fail("Admin login not found.", 404)
    if user.id == current_user.id:
        fail("You can't remove the login you're signed in with.")
    if User.query.filter_by(role=ROLE_FOUNDER).count() <= 1:
        fail("At least one admin login must remain.")
    audit(f"removed admin login {user.email}", "settings")
    db.session.delete(user)
    db.session.commit()
    return ok(message="Admin login removed.")
