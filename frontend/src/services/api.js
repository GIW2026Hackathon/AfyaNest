/**
 * AfyaNest - API Service Layer
 * All HTTP communication with the Flask backend is centralised here.
 * Configure the base URL via the VITE_API_BASE_URL environment variable.
 */

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  try {
    const response = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }
    return await response.json();
  } catch (err) {
    // Re-throw with context so callers can distinguish network vs API errors
    if (err instanceof TypeError && err.message.includes('fetch')) {
      throw new Error('NETWORK_ERROR');
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Sensor readings
// ---------------------------------------------------------------------------

/** GET /api/readings/latest  →  { ammonia, temperature, humidity, timestamp, device_connected } */
export async function fetchLatestReading() {
  return request('/api/readings/latest');
}

/** GET /api/readings/history?range=1h|6h|24h  →  [{ ammonia, temperature, humidity, timestamp }] */
export async function fetchReadingHistory(range = '1h') {
  return request(`/api/readings/history?range=${encodeURIComponent(range)}`);
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

/** GET /api/alerts  →  [{ id, timestamp, type, reading, severity, message, status }] */
export async function fetchAlerts() {
  return request('/api/alerts');
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

/**
 * GET /api/analytics?from=ISO&to=ISO
 * → { ammonia: { avg, min, max }, temperature: { avg, min, max },
 *     humidity: { avg, min, max }, warnings: number, dangers: number,
 *     readings: [] }
 */
export async function fetchAnalytics(from, to) {
  const params = new URLSearchParams();
  if (from) params.append('from', from);
  if (to) params.append('to', to);
  return request(`/api/analytics?${params.toString()}`);
}

// ---------------------------------------------------------------------------
// Device status
// ---------------------------------------------------------------------------

/** GET /api/device/status  →  { connected, port, last_update, sensor_errors } */
export async function fetchDeviceStatus() {
  return request('/api/device/status');
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** GET /api/settings  →  { thresholds: { warning, danger }, ... } */
export async function fetchSettings() {
  return request('/api/settings');
}

/** POST /api/settings  body: { thresholds: { warning, danger }, ... } */
export async function saveSettings(settings) {
  return request('/api/settings', {
    method: 'POST',
    body: JSON.stringify(settings),
  });
}
