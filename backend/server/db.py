"""Database access for AfyaNest: PostgreSQL in production, SQLite for quick local runs.

    AIRNEST_DATABASE_URL=postgresql://afyanest:PASSWORD@localhost:5432/afyanest   (production)
    AIRNEST_DB=airnest.db                                                         (SQLite, dev only)

All SQL in the app is written once with `?` placeholders and portable syntax
(`INSERT ... ON CONFLICT (...) DO UPDATE SET col = excluded.col` works on both).
Every query returns plain dicts.
"""
from __future__ import annotations

import os
import re
import sqlite3
import threading
from contextlib import contextmanager

_PLACEHOLDER = re.compile(r"\?")


@contextmanager
def _nullcontext():
    yield


class Database:
    dialect = "?"

    def q(self, sql: str, args=(), one=False):
        raise NotImplementedError

    def many(self, sql: str, rows: list[tuple]):
        for r in rows:
            self.q(sql, r)

    @contextmanager
    def tx(self, lock_key: int | None = None):
        """Run several statements atomically. lock_key serialises writers (audit chain)."""
        raise NotImplementedError
        yield

    def ping(self) -> bool:
        try:
            return self.q("SELECT 1 AS ok", one=True)["ok"] == 1
        except Exception:
            return False

    def close(self):
        pass


# ---------------------------------------------------------------- SQLite
class SqliteDB(Database):
    dialect = "sqlite"

    def __init__(self, path: str):
        self.path = path
        self.conn = sqlite3.connect(path, check_same_thread=False, isolation_level=None)
        self.conn.row_factory = sqlite3.Row
        self.lock = threading.RLock()
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.execute("PRAGMA foreign_keys=ON")
        self.conn.execute("PRAGMA busy_timeout=5000")

    def q(self, sql, args=(), one=False):
        with self.lock:
            rows = [dict(r) for r in self.conn.execute(sql, tuple(args)).fetchall()]
        return (rows[0] if rows else None) if one else rows

    def many(self, sql, rows):
        with self.lock:
            self.conn.execute("BEGIN")
            try:
                self.conn.executemany(sql, rows)
                self.conn.execute("COMMIT")
            except Exception:
                self.conn.execute("ROLLBACK")
                raise

    def script(self, sql):
        with self.lock:
            self.conn.executescript(sql)

    @contextmanager
    def tx(self, lock_key=None):
        with self.lock:
            self.conn.execute("BEGIN IMMEDIATE")
            try:
                yield self
                self.conn.execute("COMMIT")
            except Exception:
                self.conn.execute("ROLLBACK")
                raise

    def close(self):
        self.conn.close()


# ---------------------------------------------------------------- PostgreSQL
class PostgresDB(Database):
    """psycopg 3 with a small connection pool (psycopg_pool when installed,
    otherwise one connection per worker thread)."""
    dialect = "postgres"

    def __init__(self, url: str, connect=None):
        self.url = url
        self._local = threading.local()
        self._pool = None
        self._custom = connect                 # injectable driver (tests): one shared conn
        self._shared = None
        self._shared_lock = threading.RLock()
        if connect is None:
            import psycopg                     # noqa: F401  (fail early with a clear error)
            from psycopg.rows import dict_row
            self._dict_row = dict_row
            try:
                from psycopg_pool import ConnectionPool
                self._pool = ConnectionPool(url, min_size=1, max_size=int(os.getenv("AIRNEST_DB_POOL", "10")),
                                            kwargs={"autocommit": True, "row_factory": dict_row},
                                            open=True)
            except ImportError:
                self._pool = None

    # one place that knows how to get a connection
    @contextmanager
    def _conn(self):
        if self._custom is not None:
            with self._shared_lock:
                if self._shared is None:
                    self._shared = self._custom(self.url)
                yield self._shared
            return
        if self._pool is not None:
            with self._pool.connection() as c:
                yield c
            return
        import psycopg
        c = getattr(self._local, "c", None)
        if c is None or c.closed:
            c = self._local.c = psycopg.connect(self.url, autocommit=True, row_factory=self._dict_row)
        yield c

    @staticmethod
    def _sql(sql):
        return _PLACEHOLDER.sub("%s", sql)

    def _run(self, c, sql, args):
        if self._custom is not None:
            return c.execute(sql, tuple(args))
        with c.cursor() as cur:
            cur.execute(self._sql(sql), tuple(args))
            return [dict(r) for r in cur.fetchall()] if cur.description else []

    def q(self, sql, args=(), one=False):
        tx_conn = getattr(self._local, "tx", None)
        if tx_conn is not None:
            rows = self._run(tx_conn, sql, args)
        else:
            with self._conn() as c:
                rows = self._run(c, sql, args)
        return (rows[0] if rows else None) if one else rows

    def many(self, sql, rows):
        with self.tx():
            for r in rows:
                self.q(sql, r)

    def script(self, sql):
        for stmt in [s.strip() for s in sql.split(";") if s.strip()]:
            self.q(stmt)

    @contextmanager
    def tx(self, lock_key=None):
        if getattr(self._local, "tx", None) is not None:      # nested: join outer
            yield self
            return
        with self._conn() as c, (self._shared_lock if self._custom is not None
                                 else _nullcontext()):
            self._run(c, "BEGIN", ())
            self._local.tx = c
            try:
                if lock_key is not None:
                    self._run(c, "SELECT pg_advisory_xact_lock(?)", (lock_key,))
                yield self
                self._run(c, "COMMIT", ())
            except Exception:
                self._run(c, "ROLLBACK", ())
                raise
            finally:
                self._local.tx = None

    def close(self):
        if self._pool is not None:
            self._pool.close()
        if self._shared is not None and hasattr(self._shared, "close"):
            self._shared.close()


def open_database(target: str | None = None, connect=None) -> Database:
    """target: a postgres URL, a SQLite path, or None to read the environment."""
    target = target or os.getenv("AIRNEST_DATABASE_URL") or os.getenv("AIRNEST_DB") or "airnest.db"
    if target.startswith(("postgres://", "postgresql://")):
        return PostgresDB(target, connect=connect)
    from .security import env
    if env() == "production" and os.getenv("AIRNEST_ALLOW_SQLITE") != "1":
        raise RuntimeError(
            "Production needs PostgreSQL for multi-tenant data. Set AIRNEST_DATABASE_URL="
            "postgresql://user:password@host:5432/afyanest (or AIRNEST_ALLOW_SQLITE=1 for a "
            "single-farm pilot).")
    return SqliteDB(target)
