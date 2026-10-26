/**
 * AfyaNest - Demo Data
 * Clearly simulated sensor values used when the Arduino / Flask backend
 * is unavailable. These values are NEVER mixed with live readings.
 */

// Deterministic seeded pseudo-random for reproducible demo charts
function seededRand(seed) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function generateHistory(points, rangeMinutes) {
  const rand = seededRand(42);
  const now = Date.now();
  const interval = (rangeMinutes * 60 * 1000) / points;
  return Array.from({ length: points }, (_, i) => {
    const t = new Date(now - (points - 1 - i) * interval);
    const noise = () => (rand() - 0.5) * 2;
    return {
      timestamp: t.toISOString(),
      ammonia: Math.round(280 + noise() * 60),     // raw ADC reading
      temperature: parseFloat((26 + noise() * 3).toFixed(1)),
      humidity: Math.round(62 + noise() * 10),
    };
  });
}

export const DEMO_LATEST = {
  ammonia: 312,          // raw MQ-137 ADC value — NOT ppm
  temperature: 27.4,
  humidity: 65,
  timestamp: new Date().toISOString(),
  device_connected: false, // demo = no real device
  _demo: true,
};

export const DEMO_HISTORY = {
  '1h':  generateHistory(60,  60),
  '6h':  generateHistory(72,  360),
  '24h': generateHistory(96,  1440),
};

export const DEMO_ALERTS = [
  {
    id: 'demo-1',
    timestamp: new Date(Date.now() - 3_600_000).toISOString(),
    type: 'Ammonia Warning',
    reading: '348 (ADC)',
    severity: 'warning',
    message: 'Ammonia sensor reading has entered the warning range.',
    status: 'resolved',
    _demo: true,
  },
  {
    id: 'demo-2',
    timestamp: new Date(Date.now() - 7_200_000).toISOString(),
    type: 'Temperature Warning',
    reading: '31.2 °C',
    severity: 'warning',
    message: 'Temperature is outside the configured range.',
    status: 'resolved',
    _demo: true,
  },
  {
    id: 'demo-3',
    timestamp: new Date(Date.now() - 14_400_000).toISOString(),
    type: 'Ammonia Danger',
    reading: '421 (ADC)',
    severity: 'danger',
    message: 'Environmental conditions require urgent inspection.',
    status: 'resolved',
    _demo: true,
  },
  {
    id: 'demo-4',
    timestamp: new Date(Date.now() - 86_400_000).toISOString(),
    type: 'Connection Lost',
    reading: '—',
    severity: 'warning',
    message: 'Device connection lost. Check USB cable.',
    status: 'resolved',
    _demo: true,
  },
];

export const DEMO_ANALYTICS = {
  ammonia:     { avg: 298, min: 210, max: 421 },
  temperature: { avg: 26.8, min: 22.1, max: 31.2 },
  humidity:    { avg: 63, min: 52, max: 78 },
  warnings: 3,
  dangers: 1,
  readings: DEMO_HISTORY['24h'],
};

export const DEMO_DEVICE = {
  connected: false,
  port: 'COM3 (demo)',
  last_update: new Date(Date.now() - 5000).toISOString(),
  sensor_errors: [],
  _demo: true,
};

export const DEMO_SETTINGS = {
  thresholds: { warning: 300, danger: 400 },
  temperature_unit: 'C',
  notifications: { sound: true, email: false },
};
