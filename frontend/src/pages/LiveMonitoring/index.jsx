import { useEffect, useState, useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { Wind, Thermometer, Droplets, RefreshCw, Usb, WifiOff } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import StatusBadge from '../../components/StatusBadge';
import LoadingSpinner from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';
import Card from '../../components/Card';

const RANGES = [
  { value: '1h',  label: '1h' },
  { value: '6h',  label: '6h' },
  { value: '24h', label: '24h' },
];

function formatTick(iso, range) {
  const d = new Date(iso);
  return range === '24h'
    ? d.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatFull(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// Compact metric card used in the reading strip
function ReadingCard({ icon, label, value, unit, status }) {
  const statusColor = { safe: '#16A34A', warning: '#EAB308', danger: '#DC2626', no_data: '#64748B' };
  return (
    <div className="reading-card">
      <div className="reading-card__top">
        <span className="reading-card__icon" style={{ color: statusColor[status] ?? '#0077B6' }}>{icon}</span>
        <span className="reading-card__label">{label}</span>
      </div>
      <div className="reading-card__value">
        {value != null ? value : '—'}
        {value != null && <span className="reading-card__unit">{unit}</span>}
      </div>
      {status && <StatusBadge status={status} size="sm" />}
    </div>
  );
}

export default function LiveMonitoring() {
  const { latestReading, loadHistory, refreshLatest, demoMode, deviceStatus, settings } = useApp();
  const [range, setRange] = useState('1h');
  const [history, setHistory] = useState([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [activeChart, setActiveChart] = useState('ammonia');

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

  const chartData = history.map(r => ({
    ...r,
    time: formatTick(r.timestamp, range),
  }));

  const CHARTS = {
    ammonia:     { color: '#0077B6', label: 'Ammonia (ADC)', unit: 'ADC' },
    temperature: { color: '#DC2626', label: 'Temperature',   unit: '°C'  },
    humidity:    { color: '#16A34A', label: 'Humidity',      unit: '%'   },
  };

  const active = CHARTS[activeChart];

  return (
    <div className="page">

      {/* Status strip */}
      {!latestReading ? (
        <LoadingSpinner message="Connecting to sensors…" size="lg" />
      ) : (
        <>
          {/* Top row: readings + refresh */}
          <div className="live-header">
            <div className="live-readings">
              <ReadingCard
                icon={<Wind size={20} />}
                label="Ammonia"
                value={latestReading.ammonia}
                unit=" ADC"
                status={latestReading.status}
              />
              <ReadingCard
                icon={<Thermometer size={20} />}
                label="Temp"
                value={latestReading.temperature}
                unit=" °C"
                status={null}
              />
              <ReadingCard
                icon={<Droplets size={20} />}
                label="Humidity"
                value={latestReading.humidity}
                unit="%"
                status={null}
              />
              {/* Status + timestamp */}
              <div className="reading-card reading-card--status">
                <StatusBadge status={latestReading.status} size="md" />
                <div className="reading-card__time">
                  {deviceConnected
                    ? <><Usb size={12} /> USB · {formatFull(latestReading.timestamp)}</>
                    : <><WifiOff size={12} /> {demoMode ? 'Demo' : 'Offline'} · {formatFull(latestReading.timestamp)}</>
                  }
                </div>
              </div>
            </div>

            <button
              className="btn btn--secondary btn--icon"
              onClick={handleRefresh}
              disabled={refreshing}
              aria-label="Refresh"
            >
              <RefreshCw size={15} className={refreshing ? 'spin' : ''} />
            </button>
          </div>

          {/* Chart selector + time range */}
          <Card style={{ marginTop: '16px' }}>
            <div className="chart-header">
              {/* Metric tabs */}
              <div className="tab-group" role="group" aria-label="Select sensor">
                {Object.entries(CHARTS).map(([key, cfg]) => (
                  <button
                    key={key}
                    className={`tab-btn ${activeChart === key ? 'tab-btn--active' : ''}`}
                    onClick={() => setActiveChart(key)}
                    aria-pressed={activeChart === key}
                    style={activeChart === key ? { background: cfg.color } : {}}
                  >
                    {cfg.label}
                  </button>
                ))}
              </div>
              {/* Range tabs */}
              <div className="tab-group" role="group" aria-label="Time range">
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

            {chartLoading ? (
              <LoadingSpinner message="Loading…" />
            ) : chartData.length === 0 ? (
              <EmptyState
                title="No data yet"
                message="Readings will appear as the system collects data."
              />
            ) : (
              <div style={{ width: '100%', height: 340, marginTop: '8px' }}>
                <ResponsiveContainer>
                  <LineChart data={chartData} margin={{ top: 4, right: 12, left: -8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#EAF0F4" />
                    <XAxis
                      dataKey="time"
                      tick={{ fontSize: 11, fill: '#64748B' }}
                      tickLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: '#64748B' }}
                      tickLine={false}
                      axisLine={false}
                      width={36}
                      unit={` ${active.unit}`}
                    />
                    <Tooltip
                      contentStyle={{
                        background: '#fff',
                        border: '1px solid #D9E5EC',
                        borderRadius: '8px',
                        fontSize: '12px',
                      }}
                      labelStyle={{ fontWeight: 600, color: '#172B3A' }}
                      formatter={(v) => [`${v} ${active.unit}`, active.label]}
                    />
                    {/* Threshold lines for ammonia */}
                    {activeChart === 'ammonia' && (
                      <>
                        <ReferenceLine
                          y={settings.thresholds.warning}
                          stroke="#EAB308"
                          strokeDasharray="4 3"
                          label={{ value: 'Warn', position: 'insideTopRight', fontSize: 10, fill: '#EAB308' }}
                        />
                        <ReferenceLine
                          y={settings.thresholds.danger}
                          stroke="#DC2626"
                          strokeDasharray="4 3"
                          label={{ value: 'Danger', position: 'insideTopRight', fontSize: 10, fill: '#DC2626' }}
                        />
                      </>
                    )}
                    <Line
                      type="monotone"
                      dataKey={activeChart}
                      stroke={active.color}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, fill: active.color }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
