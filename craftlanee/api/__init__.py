"""JSON API consumed by the React frontend (frontend/)."""
from . import announcements, auth, documents, employees, finance, invoices, leaves, payroll, settings, team  # noqa: F401  (register routes)
from .common import bp

__all__ = ["bp"]
