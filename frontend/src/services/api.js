/**
 * AfyaNest — API service layer
 * Talks to the AirNest FastAPI backend (default: http://localhost:8000)
 *
 * All dashboard endpoints require the X-Admin-Key header.
 * Configure via VITE_API_URL and VITE_ADMIN_KEY in .env
 *
 * Backend routes:
 *   GET  /health
 *   GET  /api/v1/houses                           → list of houses
 *   GET  /api/v1/houses/{device_id}/status        → latest advice + recent readings
 *   GET  /api/v1/houses/{device_id}/history?hours → chart data + alerts
 *   POST /api/v1/houses                           → register a house (admin)
 */

const BASE  = (import.meta.env.VITE_API_URL  || 'http://localhost:8000').replace(/\/$/, '');
const AKEY  =  import.meta.env.VITE_ADMIN_KEY || '';

const ADMIN_HEADERS = {
  'Content-Type': 'application/json',
  'X-Admin-Key':  AKEY,
};

// ── Raw fetch ────────────────────────────────────────────────────────────────

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { headers: ADMIN_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${await res.text()}`);
  return res.json();
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method:  'POST',
    headers: ADMIN_HEADERS,
    body:    JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${await res.text()}`);
  return res.json();
}

// ── Status mappers ───────────────────────────────────────────────────────────

/**
 * Map backend level string to frontend status string.
 * Backend:  ok | watch | warn | danger
 * Frontend: safe | warning | danger | no_data
 */
export function mapLevel(level) {
  if (!level) return 'no_data';
  if (level === 'ok')     return 'safe';
  if (level === 'watch')  return 'warning';
  if (level === 'warn')   return 'warning';
  if (level === 'danger') return 'danger';
  return 'no_data';
}

/**
 * Map a raw history reading row (backend keys) → frontend keys.
 * Backend:  { ts, node, nh3, temp, rh, co2 }
 * Frontend: { timestamp, node, ammonia, temperature, humidity, co2 }
 */
export function mapReading(r) {
  return {
    timestamp:   new Date((r.ts ?? r.slot * 600) * 1000).toISOString(),
    node:        r.node,
    ammonia:     r.nh3  ?? r.nh3_ppm  ?? null,
    temperature: r.temp ?? r.temp_c   ?? null,
    humidity:    r.rh   ?? r.rh_pct   ?? null,
    co2:         r.co2  ?? r.co2_ppm  ?? null,
  };
}

/**
 * Map a backend alert row → frontend alert shape.
 */
function mapAlert(a, index) {
  const sev = mapLevel(a.level);
  return {
    id:        `alert-${a.ts}-${index}`,
    timestamp: new Date(a.ts * 1000).toISOString(),
    type:      a.kind ? a.kind.charAt(0).toUpperCase() + a.kind.slice(1) : 'Alert',
    reading:   '—',
    severity:  sev === 'safe' ? 'info' : sev,
    message:   a.message || a.kind || 'Alert',
    status:    'active',
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

/** GET /health → { ok, model, detector } */
export async function fetchHealth() {
  return get('/health');
}

/**
 * GET /api/v1/houses → list of houses with current level.
 * Returns array of { device_id, name, lang, level, now_max_nh3, last_ts, ... }
 */
export async function fetchHouses() {
  return get('/api/v1/houses');
}

/**
 * GET /api/v1/houses/{device_id}/status
 * Returns { advice, readings }
 * advice.level is ok|watch|warn|danger
 * advice.now_max_nh3 is the current ammonia ppm (calibrated)
 */
export async function fetchHouseStatus(deviceId) {
  return get(`/api/v1/houses/${encodeURIComponent(deviceId)}/status`);
}

/**
 * GET /api/v1/houses/{device_id}/history?hours=N
 * Returns { readings: [...], alerts: [...] }
 * readings use backend keys: ts, node, nh3, temp, rh, co2
 */
export async function fetchHouseHistory(deviceId, hours = 6) {
  return get(`/api/v1/houses/${encodeURIComponent(deviceId)}/history?hours=${hours}`);
}

// ── Composed helpers (used by AppContext) ────────────────────────────────────

/**
 * Get the "latest reading" for a device — maps backend advice+readings
 * into the shape the frontend components expect.
 */
export async function fetchLatestReading(deviceId) {
  const { advice, readings } = await fetchHouseStatus(deviceId);

  // Use the most recent reading row for raw sensor values
  const latest = readings && readings.length > 0
    ? mapReading(readings[readings.length - 1])
    : null;

  const level = advice?.level ?? null;

  return {
    // ppm value from the ML model (may be null before warmup)
    ammonia:     advice?.now_max_nh3 ?? latest?.ammonia ?? null,
    temperature: latest?.temperature ?? null,
    humidity:    latest?.humidity    ?? null,
    timestamp:   latest?.timestamp   ?? (advice?.ts ? new Date(advice.ts * 1000).toISOString() : null),
    status:      mapLevel(level),
    level,
    advice,
    device_connected: true,
  };
}

/**
 * Get history as frontend-friendly reading array.
 * range: '1h' | '6h' | '24h'
 */
export async function fetchReadingHistory(deviceId, range = '1h') {
  const hoursMap = { '1h': 1, '6h': 6, '24h': 24 };
  const hours = hoursMap[range] ?? 6;
  const { readings } = await fetchHouseHistory(deviceId, hours);
  return (readings ?? []).map(mapReading);
}

/**
 * Get alerts from the history endpoint.
 */
export async function fetchAlerts(deviceId, hours = 24) {
  const { alerts } = await fetchHouseHistory(deviceId, hours);
  return (alerts ?? []).map(mapAlert);
}

/**
 * Register a new house (admin operation).
 */
export async function registerHouse(data) {
  return post('/api/v1/houses', data);
}
