"""Pick the database for a test: a brand-new PostgreSQL database per test when
AIRNEST_TEST_DATABASE_URL is set, otherwise a temporary SQLite file."""
import os
import uuid


def fresh_db(tmp_path):
    base = os.getenv("AIRNEST_TEST_DATABASE_URL")
    if not base:
        return str(tmp_path / "s.db"), None
    try:
        import psycopg
        connect = None
        with psycopg.connect(base, autocommit=True) as c:
            name = "t_" + uuid.uuid4().hex[:12]
            c.execute(f"CREATE DATABASE {name}")
    except ImportError:
        from pg_shim import Conn
        connect = Conn
        name = "t_" + uuid.uuid4().hex[:12]
        Conn(base).execute(f"CREATE DATABASE {name}")
    return base.rsplit("/", 1)[0] + "/" + name, connect


def is_pg():
    return bool(os.getenv("AIRNEST_TEST_DATABASE_URL"))
