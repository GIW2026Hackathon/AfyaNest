import { useEffect, useState, useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Wind, Thermometer, Droplets, Clock, RefreshCw, Usb, WifiOff } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import SensorCard from '../../components/SensorCard';
import StatusBadge from '../../components/StatusBadge';
import LoadingSpinner from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import PageHeader from '../../components/PageHeader';
import Card from '../../components/Card';

const RANGES = [
  { value: '1h',  label: 'Last Hour' },
  { value: '6h',  label: 'Last 6 Hours' },
  { value: '24h', label: 'Last 24 Hours' },
];

function formatTimestamp(iso, range) {
  const d = new Date(iso);
  if (range === '24h') return d.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatFull(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-KE', {
    dateStyle: 'medium', timeStyle: 'medium',
  });
}

const CHART_COLORS = {
  ammonia:     '#0077B6',
  temperature: '#DC2626',
  humidity:    '#16A34A',
};

export default function LiveMonitoring() {
  const { latestReading, loadHistory, refreshLatest, demoMode, deviceStatus } = useApp();
  const [range, setRange] = useState('1h');
  const [history, setHistory] = useState([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState(null);
  const [activeLines, setActiveLines] = useState({ ammonia: true, temperature: true, humidity: true });
  const [refreshing, setRefreshing] = useState(false);

  const fetchHistory = useCallback(async () => {
    setChartLoading(true);
    setChartError(null);
    try {
      const data = await loadHistory(range);
      setHistory(data ?? []);
    } catch (err) {
      setChartError(err.message);
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

  const toggleLine = (key) =>
    setActiveLines(prev => ({ ...prev, [key]: !prev[key] }));

  const chartData = history.map(r => ({
    ...r,
    time: formatTimestamp(r.timestamp, range),
  }));

  const deviceConnected = !demoMode && deviceStatus?.connected;

  return (
    <div className="page">
      <PageHeader
        title="Live Monitoring"
        subtitle="Real-time sensor readings from your poultry house"
        action={
          <button
            className="btn btn--primary"
            onClick={handleRefresh}
            disabled={refreshing}
            aria-label="Refresh sensor data"
          >
            <RefreshCw size={14} aria-hidden="true" className={refreshing ? 'spin' : ''} />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        }
      />

      {/* Current readings row */}
      {!latestReading ? (
        <LoadingSpinner message="Waiting for sensor data…" size="lg" />
      ) : (
        <>
          <div className="cards-grid cards-grid--4">
            <SensorCard
              icon={<Wind size={20} />}
              label="Ammonia (ADC)"
              value={latestReading.ammonia}
              unit=""
              status={latestReading.status}
              subtitle="Raw MQ-137 ADC reading"
              highlight
            />
            <SensorCard
              icon={<Thermometer size={20} />}
              label="Temperature"
              value={latestReading.temperature}
              unit=" °C"
              status={null}
              subtitle="DHT22 sensor"
              highlight
            />
            <SensorCard
              icon={<Droplets size={20} />}
              label="Humidity"
              value={latestReading.humidity}
              unit="%"
              status={null}
              subtitle="DHT22 sensor"
              highlight
            />
            <div className="sensor-card">
              <div className="sensor-card__header">
                <span className="sensor-card__icon"><Clock size={20} /></span>
                <span className="sensor-card__label">Last Update</span>
              </div>
              <div className="sensor-card__value sensor-card__value--large" style={{ fontSize: '14px', lineHeight: '1.5', marginTop: '8px' }}>
                {formatFull(latestReading.timestamp)}
              </div>
              <div className="sensor-card__footer" style={{ marginTop: '12px', gap: '8px', flexDirection: 'column', alignItems: 'flex-start' }}>
                <StatusBadge status={latestReading.status} size="sm" />
                <span className="sensor-card__subtitle" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  {deviceConnected
                    ? <><Usb size={12} /> USB Connected</>
                    : <><WifiOff size={12} /> {demoMode ? 'Demo Mode' : 'Not connected'}</>
                  }
                </span>
              </div>
            </div>
          </div>

          {/* Trend chart */}
          <Card
            title="Sensor Trend"
            headerAction={
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
            }
          >
            {/* Chart line toggles */}
            <div className="chart-toggles">
              {Object.entries(CHART_COLORS).map(([key, color]) => (
                <button
                  key={key}
                  className={`chart-toggle ${activeLines[key] ? 'chart-toggle--active' : ''}`}
                  onClick={() => toggleLine(key)}
                  aria-pressed={activeLines[key]}
                  style={{ '--toggle-color': color }}
                >
                  <span className="chart-toggle__dot" style={{ background: activeLines[key] ? color : '#D9E5EC' }} />
                  {key.charAt(0).toUpperCase() + key.slice(1)}
                  {key === 'ammonia' ? ' (ADC)' : key === 'temperature' ? ' (°C)' : ' (%)'}
                </button>
              ))}
            </div>

            {chartLoading ? (
              <LoadingSpinner message="Loading chart data…" />
            ) : chartError ? (
              <ErrorState message={chartError} onRetry={fetchHistory} />
            ) : chartData.length === 0 ? (
              <EmptyState
                title="No historical data"
                message="Chart data will appear here as the system collects readings over time."
              />
            ) : (
              <div style={{ width: '100%', height: 320 }}>
                <ResponsiveContainer>
                  <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#EAF0F4" />
                    <XAxis
                      dataKey="time"
                      tick={{ fontSize: 11, fill: '#64748B' }}
                      tickLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis tick={{ fontSize: 11, fill: '#64748B' }} tickLine={false} axisLine={false} width={40} />
                    <Tooltip
                      contentStyle={{
                        background: '#fff',
                        border: '1px solid #D9E5EC',
                        borderRadius: '8px',
                        fontSize: '12px',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                      }}
                      labelStyle={{ fontWeight: 600, color: '#172B3A' }}
                    />
                    <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '12px' }} />
                    {activeLines.ammonia && (
                      <Line
                        type="monotone"
                        dataKey="ammonia"
                        name="Ammonia (ADC)"
                        stroke={CHART_COLORS.ammonia}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                    )}
                    {activeLines.temperature && (
                      <Line
                        type="monotone"
                        dataKey="temperature"
                        name="Temperature (°C)"
                        stroke={CHART_COLORS.temperature}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                    )}
                    {activeLines.humidity && (
                      <Line
                        type="monotone"
                        dataKey="humidity"
                        name="Humidity (%)"
                        stroke={CHART_COLORS.humidity}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                      />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            <p className="chart-note">
              Ammonia values are raw ADC readings from the MQ-137 sensor. They have not been converted to ppm.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
