"""Tiny libpq (ctypes) driver used ONLY by the test-suite when psycopg is not installed.

Production uses psycopg 3 (see requirements-server.txt). This lets CI machines without
pip access still run every test against a real PostgreSQL server:

    AIRNEST_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5433/postgres python tests/test_security.py
"""
import ctypes
import ctypes.util
import re
import threading

_lib = ctypes.CDLL(ctypes.util.find_library("pq") or "libpq.so.5")
_lib.PQconnectdb.restype = ctypes.c_void_p
_lib.PQconnectdb.argtypes = [ctypes.c_char_p]
_lib.PQstatus.argtypes = [ctypes.c_void_p]
_lib.PQerrorMessage.restype = ctypes.c_char_p
_lib.PQerrorMessage.argtypes = [ctypes.c_void_p]
_lib.PQexecParams.restype = ctypes.c_void_p
_lib.PQexecParams.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int, ctypes.c_void_p,
                              ctypes.POINTER(ctypes.c_char_p), ctypes.c_void_p, ctypes.c_void_p,
                              ctypes.c_int]
for f, rt in (("PQresultStatus", ctypes.c_int), ("PQntuples", ctypes.c_int),
              ("PQnfields", ctypes.c_int)):
    getattr(_lib, f).restype = rt
    getattr(_lib, f).argtypes = [ctypes.c_void_p]
_lib.PQresultErrorMessage.restype = ctypes.c_char_p
_lib.PQresultErrorMessage.argtypes = [ctypes.c_void_p]
_lib.PQfname.restype = ctypes.c_char_p
_lib.PQfname.argtypes = [ctypes.c_void_p, ctypes.c_int]
_lib.PQftype.restype = ctypes.c_uint
_lib.PQftype.argtypes = [ctypes.c_void_p, ctypes.c_int]
_lib.PQgetvalue.restype = ctypes.c_char_p
_lib.PQgetvalue.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int]
_lib.PQgetisnull.restype = ctypes.c_int
_lib.PQgetisnull.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int]
_lib.PQclear.argtypes = [ctypes.c_void_p]
_lib.PQfinish.argtypes = [ctypes.c_void_p]

INTS, FLOATS = {20, 21, 23}, {700, 701, 1700}
PGRES_COMMAND_OK, PGRES_TUPLES_OK = 1, 2


class PgError(Exception):
    pass


class Conn:
    def __init__(self, url):
        self._c = _lib.PQconnectdb(url.encode())
        if _lib.PQstatus(self._c) != 0:
            raise PgError(_lib.PQerrorMessage(self._c).decode())
        self._lock = threading.Lock()

    def close(self):
        if self._c:
            _lib.PQfinish(self._c)
            self._c = None

    def __del__(self):
        try:
            self.close()
        except Exception:
            pass

    def execute(self, sql, args=()):
        n = [0]

        def num(_):
            n[0] += 1
            return f"${n[0]}"
        sql = re.sub(r"\?", num, sql)
        vals = (ctypes.c_char_p * max(1, len(args)))()
        for i, a in enumerate(args):
            if a is None:
                vals[i] = None
            elif isinstance(a, bool):
                vals[i] = b"t" if a else b"f"
            else:
                vals[i] = str(a).encode()
        with self._lock:
            r = _lib.PQexecParams(self._c, sql.encode(), len(args), None, vals, None, None, 0)
            try:
                st = _lib.PQresultStatus(r)
                if st not in (PGRES_COMMAND_OK, PGRES_TUPLES_OK):
                    raise PgError(_lib.PQresultErrorMessage(r).decode().strip())
                out = []
                if st == PGRES_TUPLES_OK:
                    nf = _lib.PQnfields(r)
                    names = [_lib.PQfname(r, j).decode() for j in range(nf)]
                    types = [_lib.PQftype(r, j) for j in range(nf)]
                    for i in range(_lib.PQntuples(r)):
                        row = {}
                        for j in range(nf):
                            if _lib.PQgetisnull(r, i, j):
                                row[names[j]] = None
                                continue
                            v = _lib.PQgetvalue(r, i, j).decode()
                            row[names[j]] = (int(v) if types[j] in INTS else
                                             float(v) if types[j] in FLOATS else
                                             v == "t" if types[j] == 16 else v)
                        out.append(row)
                return out
            finally:
                _lib.PQclear(r)
