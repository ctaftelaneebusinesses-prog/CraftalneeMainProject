"""Create CraftLanee's tables in your Supabase (or any Postgres) database.

    .venv\\Scripts\\python init_supabase_db.py

It asks for the connection string and the database password; the password is typed hidden and is
never saved or printed. Running it again is safe: existing tables and data are left untouched.
(The hosted app also does this on its first start, so this step is optional.)
"""
import getpass
import os
import sys
from urllib.parse import quote


def main():
    print("Supabase > Connect > Session pooler > copy the URI (it contains [YOUR-PASSWORD]).")
    url = input("Connection string: ").strip()
    if not url.startswith(("postgresql://", "postgres://")):
        sys.exit("That doesn't look like a Postgres connection string (it should start with postgresql://).")
    if "[YOUR-PASSWORD]" in url:
        password = getpass.getpass("Database password (hidden): ")
        if not password:
            sys.exit("No password entered.")
        url = url.replace("[YOUR-PASSWORD]", quote(password, safe=""))  # @, #, / etc. must be encoded

    os.environ["CRAFTLANEE_DATABASE_URL"] = url
    os.environ.setdefault("CRAFTLANEE_SECRET_KEY", "setup-only")  # not used for anything here
    for var in ("SUPABASE_URL", "SUPABASE_SERVICE_KEY"):  # database only - don't touch storage
        os.environ.pop(var, None)

    print("Connecting and creating tables...")
    try:
        from sqlalchemy import inspect

        from craftlanee import create_app
        from craftlanee.extensions import db
        app = create_app()  # creates any missing tables and columns
        with app.app_context():
            tables = sorted(inspect(db.engine).get_table_names())
    except Exception as exc:  # noqa: BLE001 - show a friendly reason instead of a traceback
        msg = str(exc).splitlines()[0] if str(exc) else exc.__class__.__name__
        if "password authentication failed" in msg:
            msg = "Wrong database password. Supabase > Project Settings > Database lets you reset it."
        elif any(s in msg.lower() for s in ("resolve host", "translate host name", "timeout", "timed out")):
            msg = "Couldn't reach the database. Check the connection string and your internet connection."
        sys.exit(f"Failed: {msg}")

    print(f"Done - {len(tables)} tables are ready in your database:")
    print("  " + ", ".join(tables))
    print("\nFor Render: CRAFTLANEE_DATABASE_URL = this connection string with your password in place of")
    print("[YOUR-PASSWORD] (no brackets). If the password contains symbols such as @ # / ? % : it will break")
    print("the link. The easy fix is to reset it in Supabase to one with only letters and numbers.")


if __name__ == "__main__":
    main()
