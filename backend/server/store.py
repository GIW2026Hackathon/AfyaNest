"""SQLite storage (one file, zero admin; swap for PostgreSQL/Timescale at scale)."""
import sqlite3
import threading

SCHEMA = """
CREATE TABLE IF NOT EXISTS houses (
  device_id TEXT PRIMARY KEY, device_key TEXT NOT NULL, name TEXT,
  phone TEXT, tech_phone TEXT, lang TEXT DEFAULT 'sw',
  lat REAL, lon REAL, t_mean REAL DEFAULT 17,
  placement_ts INTEGER, has_fan INTEGER DEFAULT 0, n_birds INTEGER,
  last_curtain REAL, last_curtain_ts INTEGER);
CREATE TABLE IF NOT EXISTS readings (
  device_id TEXT, slot INTEGER, node INTEGER, nh3 REAL, temp REAL, rh REAL,
  co2 REAL, rs REAL, flags INTEGER, PRIMARY KEY (device_id, slot, node));
CREATE TABLE IF NOT EXISTS house_log (
  device_id TEXT, slot INTEGER, curtain REAL, fan REAL, heater REAL,
  PRIMARY KEY (device_id, slot));
CREATE TABLE IF NOT EXISTS alerts (
  device_id TEXT, ts INTEGER, kind TEXT, level TEXT, message TEXT);
CREATE TABLE IF NOT EXISTS advice (
  device_id TEXT PRIMARY KEY, ts INTEGER, json TEXT);
"""


class Store:
    def __init__(self, path):
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.lock = threading.Lock()
        self.db.executescript(SCHEMA)

    def q(self, sql, args=(), one=False):
        with self.lock:
            cur = self.db.execute(sql, args)
            rows = cur.fetchall()
            self.db.commit()
        return (rows[0] if rows else None) if one else rows

    def house(self, device_id):
        return self.q("SELECT * FROM houses WHERE device_id=?", (device_id,), one=True)

    def house_by_phone(self, phone):
        return self.q("SELECT * FROM houses WHERE phone=?", (phone,), one=True)

    def upsert_house(self, **h):
        cols = ",".join(h)
        self.q(f"INSERT OR REPLACE INTO houses ({cols}) VALUES ({','.join('?' * len(h))})",
               tuple(h.values()))

    def add_readings(self, device_id, slot, rows):
        with self.lock:
            self.db.executemany(
                "INSERT OR REPLACE INTO readings VALUES (?,?,?,?,?,?,?,?,?)",
                [(device_id, slot, r["node"], r.get("nh3_ppm"), r.get("temp_c"),
                  r.get("rh_pct"), r.get("co2_ppm"), r.get("rs_kohm"), r.get("flags", 0))
                 for r in rows])
            self.db.commit()

    def log_house(self, device_id, slot, curtain, fan, heater):
        self.q("INSERT OR REPLACE INTO house_log VALUES (?,?,?,?,?)",
               (device_id, slot, curtain, fan, heater))

    def readings_since(self, device_id, slot0):
        return self.q("SELECT * FROM readings WHERE device_id=? AND slot>=? ORDER BY slot",
                      (device_id, slot0))

    def house_log_since(self, device_id, slot0):
        return self.q("SELECT * FROM house_log WHERE device_id=? AND slot>=? ORDER BY slot",
                      (device_id, slot0))

    def last_alert(self, device_id, kind):
        return self.q("SELECT * FROM alerts WHERE device_id=? AND kind=? ORDER BY ts DESC "
                      "LIMIT 1", (device_id, kind), one=True)

    def add_alert(self, device_id, ts, kind, level, message):
        self.q("INSERT INTO alerts VALUES (?,?,?,?,?)", (device_id, ts, kind, level, message))
