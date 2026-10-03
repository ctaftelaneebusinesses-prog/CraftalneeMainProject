"""JSON API consumed by the React frontend (frontend/)."""
from . import announcements, auth, complaints, documents, employees, finance, followups, invoices, leaves, payroll, projects, settings, team  # noqa: F401  (register routes)
from .common import bp

__all__ = ["bp"]
