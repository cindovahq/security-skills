from .settings import *  # noqa: F401,F403

DEBUG = True
SECRET_KEY = "test-only-key"
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}}
REPO_WEBHOOK_SECRET = "test-webhook-secret"
