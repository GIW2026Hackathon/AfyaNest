/**
 * AfyaNest — Demo Data
 *
 * Simulated values that mirror the exact shapes returned by the
 * AirNest backend, so switching from demo → live needs zero code changes.
 *
 * Backend history fields: ts, node, nh3, temp, rh, co2
 * Frontend (mapped) fields: timestamp, ammonia, temperature, humidity
 * Level values: ok | watch | warn | danger  (mapped to safe/warning/danger)
 */

// ── Seeded smooth random walk ────────────────────────────────────────────────

function seededRand(seed) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

/**
 * Generate realistic history in the FRONTEND mapped shape
 * (timestamp, ammonia, temperature, humidity) — same as what
 * api.mapReading() would return from the backend.
 */
export function getDemoHistory(range = '1h') {
  const cfg = { '1h': [60, 60], '6h': [72, 360], '24h': [96, 1440] };
  const [points, minutes] = cfg[range] ?? cfg['1h'];
  const rand = seededRand(range === '24h' ? 7 : range === '6h' ? 5 : 3);
  const now = Date.now();
  const interval = (minutes * 60 * 1000) / points;

  let nh3  = 18.0;   // ppm — realistic for a monitored house
  let temp = 26.5;
  let hum  = 63;

  return Array.from({ length: points }, (_, i) => {
    const t = new Date(now - (points - 1 - i) * interval);
    nh3  = Math.max(5,  Math.min(55, nh3  + (rand() - 0.47) * 2.2));
    temp = Math.max(20, Math.min(35, temp + (rand() - 0.5)  * 0.5));
    hum  = Math.max(45, Math.min(85, hum  + (rand() - 0.5)  * 1.8));
    return {
      timestamp:   t.toISOString(),
      node:        0,
      ammonia:     parseFloat(nh3.toFixed(1)),
      temperature: parseFloat(temp.toFixed(1)),
      humidity:    Math.round(hum),
    };
  });
}

// ── Latest reading ───────────────────────────────────────────────────────────
// Mirrors what fetchLatestReading() returns in live mode

export const DEMO_LATEST = {
  ammonia:          23.4,        // ppm (from ML model)
  temperature:      27.4,        // °C
  humidity:         65,          // %
  timestamp:        new Date().toISOString(),
  status:           'warning',   // mapped from backend level='warn'
  level:            'warn',      // raw backend level
  device_connected: false,
  advice: {
    level:               'warn',
    now_max_nh3:          23.4,
    status_quo_peak_nh3:  34.1,
    hours_to_warn:         2.0,
    plan_peak_nh3:         14.2,
    plan_curtain:         [0.5, 0.4, 0.3, 0.2, 0.1, 0.1],
    worst_node:           'drinker_a',
    model:                'gbm_baseline',
    findings: [
      { node: 'drinker_b', kind: 'event', type: 'wet_litter',
        detail: 'Ammonia and humidity rising together near drinker B.' }
    ],
  },
  _demo: true,
};

// ── Alerts ───────────────────────────────────────────────────────────────────
// Mirror the shape api.mapAlert() would produce from the backend

export const DEMO_ALERTS = [
  {
    id:        'demo-alert-1',
    timestamp: new Date(Date.now() - 1_800_000).toISOString(),
    type:      'Ammonia',
    reading:   '28.1 ppm',
    severity:  'warning',
    message:   'AirNest WARNING: Ammonia at 28 ppm — approaching unsafe level.',
    status:    'active',
  },
  {
    id:        'demo-alert-2',
    timestamp: new Date(Date.now() - 3_600_000).toISOString(),
    type:      'Temperature',
    reading:   '32.1 °C',
    severity:  'warning',
    message:   'Temperature above comfort range — consider increasing airflow.',
    status:    'resolved',
  },
  {
    id:        'demo-alert-3',
    timestamp: new Date(Date.now() - 14_400_000).toISOString(),
    type:      'Ammonia',
    reading:   '42.3 ppm',
    severity:  'danger',
    message:   'AirNest DANGER: Ammonia at 42 ppm — ventilate immediately.',
    status:    'resolved',
  },
  {
    id:        'demo-alert-4',
    timestamp: new Date(Date.now() - 28_800_000).toISOString(),
    type:      'Humidity',
    reading:   '82%',
    severity:  'warning',
    message:   'Humidity above 75% — inspect drinker lines.',
    status:    'resolved',
  },
  {
    id:        'demo-alert-5',
    timestamp: new Date(Date.now() - 86_400_000).toISOString(),
    type:      'Connection',
    reading:   '—',
    severity:  'warning',
    message:   'Gateway offline for more than 30 minutes.',
    status:    'resolved',
  },
];

// ── Device ───────────────────────────────────────────────────────────────────

export const DEMO_DEVICE = {
  connected:     false,
  port:          'demo',
  last_update:   new Date().toISOString(),
  sensor_errors: [],
  _demo:         true,
};

// ── Settings (local only — no backend settings endpoint) ────────────────────

export const DEMO_SETTINGS = {
  thresholds:       { warning: 25, danger: 35 },  // ppm — realistic for poultry
  temperature_unit: 'C',
  notifications:    { sound: true, email: false },
};
