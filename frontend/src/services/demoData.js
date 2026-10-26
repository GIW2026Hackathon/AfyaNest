/**
 * AfyaNest - Demo Data
 * Simulated sensor values. Regenerated fresh on every call so
 * charts always show data relative to "now".
 */

function seededRand(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** Smooth walk so the chart looks like real sensor data, not noise */
function generateHistory(points, rangeMinutes, seed = 42) {
  const rand = seededRand(seed);
  const now = Date.now();
  const interval = (rangeMinutes * 60 * 1000) / points;

  let nh3  = 280;
  let temp = 26.5;
  let hum  = 63;

  return Array.from({ length: points }, (_, i) => {
    const t = new Date(now - (points - 1 - i) * interval);

    // Slow random walk
    nh3  = Math.max(180, Math.min(460, nh3  + (rand() - 0.48) * 18));
    temp = Math.max(20,  Math.min(35,  temp + (rand() - 0.5)  * 0.6));
    hum  = Math.max(45,  Math.min(85,  hum  + (rand() - 0.5)  * 2));

    return {
      timestamp:   t.toISOString(),
      ammonia:     Math.round(nh3),
      temperature: parseFloat(temp.toFixed(1)),
      humidity:    Math.round(hum),
    };
  });
}

// Regenerate fresh each time the module is evaluated
export function getDemoHistory(range) {
  const cfg = { '1h': [60, 60], '6h': [72, 360], '24h': [96, 1440] };
  const [points, minutes] = cfg[range] ?? cfg['1h'];
  return generateHistory(points, minutes);
}

export const DEMO_LATEST = {
  ammonia:          312,
  temperature:      27.4,
  humidity:         65,
  timestamp:        new Date().toISOString(),
  device_connected: false,
  status:           'warning',
  _demo:            true,
};

export const DEMO_ALERTS = [
  {
    id: 'demo-1',
    timestamp: new Date(Date.now() - 1_800_000).toISOString(),
    type: 'Ammonia Warning',
    reading: '348 ADC',
    severity: 'warning',
    message: 'Ammonia reading entered warning range.',
    status: 'active',
  },
  {
    id: 'demo-2',
    timestamp: new Date(Date.now() - 3_600_000).toISOString(),
    type: 'High Temperature',
    reading: '32.1 °C',
    severity: 'warning',
    message: 'Temperature above comfort range.',
    status: 'resolved',
  },
  {
    id: 'demo-3',
    timestamp: new Date(Date.now() - 14_400_000).toISOString(),
    type: 'Ammonia Danger',
    reading: '421 ADC',
    severity: 'danger',
    message: 'Ammonia at danger level. Immediate action required.',
    status: 'resolved',
  },
  {
    id: 'demo-4',
    timestamp: new Date(Date.now() - 28_800_000).toISOString(),
    type: 'High Humidity',
    reading: '82%',
    severity: 'warning',
    message: 'Humidity above recommended limit.',
    status: 'resolved',
  },
  {
    id: 'demo-5',
    timestamp: new Date(Date.now() - 86_400_000).toISOString(),
    type: 'Connection Lost',
    reading: '—',
    severity: 'warning',
    message: 'Device connection lost.',
    status: 'resolved',
  },
];

export const DEMO_DEVICE = {
  connected:    false,
  port:         'COM3 (demo)',
  last_update:  new Date(Date.now() - 8000).toISOString(),
  sensor_errors: [],
  _demo:        true,
};

export const DEMO_SETTINGS = {
  thresholds:       { warning: 300, danger: 400 },
  temperature_unit: 'C',
  notifications:    { sound: true, email: false },
};
