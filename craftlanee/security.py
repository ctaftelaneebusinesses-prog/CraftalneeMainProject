"""Authorisation decorators and CSRF protection.

All access control is enforced here on the server. Templates only hide links as a
convenience; every admin route is wrapped in @permission_required(<area>) (or
@founder_required for things any admin may use) and every employee route resolves
data strictly from current_user.employee.
"""
import hmac
import secrets
from functools import wraps

from flask import abort, request, session
from flask_login import current_user, login_required


def founder_required(view):
    """Admin console access: the founder, or an employee granted admin access by the founder."""
    @wraps(view)
    @login_required
    def wrapper(*args, **kwargs):
        if not current_user.has_admin:
            abort(403)
        return view(*args, **kwargs)
    return wrapper


admin_required = founder_required


def permission_required(perm):
    """One area of the admin console: the founder, or an employee granted `perm` by the founder."""
    def decorator(view):
        @wraps(view)
        @login_required
        def wrapper(*args, **kwargs):
            if not current_user.can(perm):
                abort(403)
            return view(*args, **kwargs)
        return wrapper
    return decorator


# Which console areas may open each kind of stored document / file (any one is enough).
# Letters and payslips also show on the employee profile, hence "employees".
KIND_AREAS = {
    "offer": ("documents", "employees"), "joining": ("documents", "employees"),
    "relieving": ("documents", "employees"), "mou": ("documents",),
    "payslip": ("payroll", "employees"), "doc": ("employees",), "photo": ("employees",), "resume": ("employees",),
    "receipt": ("finance",), "invoice": ("finance",), "announcement": ("announcements",), "project": ("projects",),
    "logo": ("settings",), "signature": ("settings",), "hr_signature": ("settings",), "letterhead": ("settings",),
}


def can_view_document(kind):
    return any(current_user.can(area) for area in KIND_AREAS.get(kind, ()))


def owner_required(view):
    """Main founder only (User.is_primary) — granting or revoking admin access."""
    @wraps(view)
    @login_required
    def wrapper(*args, **kwargs):
        if not current_user.is_primary:
            abort(403)
        return view(*args, **kwargs)
    return wrapper


def employee_required(view):
    @wraps(view)
    @login_required
    def wrapper(*args, **kwargs):
        if current_user.employee is None:
            abort(403)
        return view(*args, **kwargs)
    return wrapper


def csrf_token():
    token = session.get("_csrf")
    if not token:
        token = secrets.token_urlsafe(32)
        session["_csrf"] = token
    return token


def csrf_protect():
    """before_request hook: every state-changing request must carry the session token."""
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return
    sent = request.form.get("csrf_token") or request.headers.get("X-CSRF-Token") or ""
    expected = session.get("_csrf") or ""
    if not expected or not hmac.compare_digest(sent, expected):
        abort(400, description="Your session expired or the form was invalid. Please go back and try again.")


def set_security_headers(response):
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    if response.mimetype == "text/html":
        response.headers.setdefault("Cache-Control", "no-store")
    return response
