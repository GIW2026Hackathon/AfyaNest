import { useEffect, useState, useCallback } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { Wind, Thermometer, Droplets, RefreshCw, Usb, WifiOff } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import StatusBadge from '../../components/StatusBadge';
import LoadingSpinner from '../../components/LoadingSpinner';
import Card from '../../components/Card';
import AmmoniaGauge from '../../components/AmmoniaGauge';

const RANGES = [
  { value: '1h',  label: '1h'  },
  { value: '6h',  label: '6h'  },
  { value: '24h', label: '24h' },
];

const CHARTS = {
  ammonia:     { color: '#0077B6', label: 'Ammonia (ppm)', unit: 'ppm' },
  temperature: { color: '#DC2626', label: 'Temperature',   unit: '°C'  },
  humidity:    { color: '#16A34A', label: 'Humidity',      unit: '%'   },
};

const STATUS_COLOR = { safe: '#16A34A', warning: '#EAB308', danger: '#DC2626', no_data: '#64748B' };

function formatTick(iso, range) {
  const d = new Date(iso);
  return range === '24h'
    ? d.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });
}

function formatTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function ReadingCard({ icon, label, value, unit, status }) {
  const color = STATUS_COLOR[status] ?? '#0077B6';
  return (
    <div className="reading-card">
      <div className="reading-card__top">
        <span className="reading-card__icon" style={{ color }}>{icon}</span>
        <span className="reading-card__label">{label}</span>
      </div>
      <div className="reading-card__value">
        {value != null ? value : '—'}
        {value != null && unit && <span className="reading-card__unit">{unit}</span>}
      </div>
      {status && <StatusBadge status={status} size="sm" />}
    </div>
  );
}

export default function LiveMonitoring() {
  const { latestReading, loadHistory, refreshLatest, demoMode, deviceStatus, settings } = useApp();
  const [range, setRange]             = useState('1h');
  const [history, setHistory]         = useState([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [activeChart, setActiveChart] = useState('ammonia');
  const [refreshing, setRefreshing]   = useState(false);

  const fetchHistory = useCallback(async () => {
    setChartLoading(true);
    try {
      const data = await loadHistory(range);
      setHistory(data ?? []);
    } finally {
      setChartLoading(false);
    }
  }, [range, loadHistory]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshLatest();
    await fetchHistory();
    setRefreshing(false);
  };

  const deviceConnected = !demoMode && deviceStatus?.connected;
  const active = CHARTS[activeChart];

  const chartData = history.map(r => ({
    ...r,
    time: formatTick(r.timestamp, range),
  }));

  if (!latestReading) return <LoadingSpinner message="Connecting to sensors…" size="lg" />;

  return (
    <div className="page">

      {/* ── Reading strip ── */}
      <div className="live-strip">
        <ReadingCard
          icon={<Wind size={18} />}
          label="Ammonia"
          value={latestReading.ammonia != null ? parseFloat(latestReading.ammonia.toFixed(1)) : null}
          unit=" ppm"
          status={latestReading.status}
        />
        <ReadingCard
          icon={<Thermometer size={18} />}
          label="Temp"
          value={latestReading.temperature}
          unit=" °C"
          status={null}
        />
        <ReadingCard
          icon={<Droplets size={18} />}
          label="Humidity"
          value={latestReading.humidity}
          unit="%"
          status={null}
        />

        {/* Status + meta */}
        <div className="live-strip__meta">
          <StatusBadge status={latestReading.status} size="md" />
          <div className="live-strip__device">
            {deviceConnected
              ? <><Usb size={11} /><span>USB</span></>
              : <><WifiOff size={11} /><span>{demoMode ? 'Demo' : 'Offline'}</span></>
            }
            <span className="live-strip__time">{formatTime(latestReading.timestamp)}</span>
          </div>
        </div>

        {/* Refresh */}
        <button
          className="btn btn--secondary btn--icon"
          onClick={handleRefresh}
          disabled={refreshing}
          aria-label="Refresh"
          style={{ alignSelf: 'center', flexShrink: 0 }}
        >
          <RefreshCw size={14} className={refreshing ? 'spin' : ''} />
        </button>
      </div>

      {/* ── Ammonia Gauge ── */}
      <Card style={{ marginTop: '14px' }}>
        <AmmoniaGauge
          livePpm={
            // Pass real value when live and available; null falls back to simulation
            !demoMode && latestReading?.ammonia != null
              ? parseFloat(latestReading.ammonia.toFixed(1))
              : null
          }
        />
      </Card>

      {/* ── Trend chart ── */}
      <Card style={{ marginTop: '14px' }}>
        {/* Controls row */}
        <div className="chart-header">
          <div className="tab-group" role="group" aria-label="Sensor">
            {Object.entries(CHARTS).map(([key, cfg]) => (
              <button
                key={key}
                className={`tab-btn ${activeChart === key ? 'tab-btn--active' : ''}`}
                style={activeChart === key ? { background: cfg.color } : {}}
                onClick={() => setActiveChart(key)}
                aria-pressed={activeChart === key}
              >
                {cfg.label}
              </button>
            ))}
          </div>
          <div className="tab-group" role="group" aria-label="Range">
            {RANGES.map(r => (
              <button
                key={r.value}
                className={`tab-btn ${range === r.value ? 'tab-btn--active' : ''}`}
                onClick={() => setRange(r.value)}
                aria-pressed={range === r.value}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {/* Chart */}
        <div className="live-chart-area">
          {chartLoading ? (
            <LoadingSpinner message="Loading chart…" />
          ) : chartData.length === 0 ? (
            <div className="live-chart-empty">No readings yet — waiting for data.</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 8, right: 12, left: -10, bottom: 4 }}>
                <defs>
                  <linearGradient id="liveAreaFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={active.color} stopOpacity={0.18} />
                    <stop offset="95%" stopColor={active.color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#EAF0F4" vertical={false} />
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 10, fill: '#64748B' }}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#64748B' }}
                  tickLine={false}
                  axisLine={false}
                  width={38}
                  unit={` ${active.unit}`}
                />
                <Tooltip
                  contentStyle={{ background: '#fff', border: '1px solid #D9E5EC', borderRadius: '8px', fontSize: '12px' }}
                  labelStyle={{ fontWeight: 600, color: '#172B3A' }}
                  formatter={v => [`${v} ${active.unit}`, active.label]}
                />
                {activeChart === 'ammonia' && <>
                  <ReferenceLine y={settings.thresholds.warning} stroke="#EAB308" strokeDasharray="5 3"
                    label={{ value: `Warn ${settings.thresholds.warning}`, position: 'insideTopRight', fontSize: 10, fill: '#EAB308' }} />
                  <ReferenceLine y={settings.thresholds.danger}  stroke="#DC2626" strokeDasharray="5 3"
                    label={{ value: `Danger ${settings.thresholds.danger}`, position: 'insideTopRight', fontSize: 10, fill: '#DC2626' }} />
                </>}
                <Area
                  type="monotone"
                  dataKey={activeChart}
                  stroke={active.color}
                  strokeWidth={2.5}
                  fill="url(#liveAreaFill)"
                  dot={false}
                  activeDot={{ r: 5, fill: active.color, strokeWidth: 0 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>
    </div>
  );
}
