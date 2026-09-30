from flask_login import LoginManager
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()
login_manager = LoginManager()  # unauthorised requests are handled in create_app (JSON 401 for /api)
