import { useEffect, useState, useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Legend,
} from 'recharts';
import { Wind, Thermometer, Droplets, AlertTriangle, XCircle } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import LoadingSpinner from '../../components/LoadingSpinner';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import PageHeader from '../../components/PageHeader';
import Card from '../../components/Card';

const RANGES = [
  { value: '24h', label: 'Last 24 Hours' },
  { value: '7d',  label: 'Last 7 Days' },
  { value: '30d', label: 'Last 30 Days' },
];

function StatRow({ label, value, unit = '' }) {
  return (
    <div className="stat-row">
      <span className="stat-row__label">{label}</span>
      <span className="stat-row__value">{value != null ? `${value}${unit}` : '—'}</span>
    </div>
  );
}

function StatCard({ icon, title, stats, color }) {
  return (
    <div className="stat-card">
      <div className="stat-card__header" style={{ color }}>
        {icon}
        <span>{title}</span>
      </div>
      <div className="stat-card__body">
        {stats.map(s => <StatRow key={s.label} {...s} />)}
      </div>
    </div>
  );
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' });
}

export default function Analytics() {
  const { loadAnalytics, demoMode } = useApp();
  const [range, setRange] = useState('24h');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // For demo/live: pass range as a rough date span
      const now = new Date();
      const hoursMap = { '24h': 24, '7d': 168, '30d': 720 };
      const from = new Date(now - (hoursMap[range] ?? 24) * 3_600_000).toISOString();
      const result = await loadAnalytics(from, now.toISOString());
      setData(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [range, loadAnalytics]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const chartData = (data?.readings ?? []).map(r => ({
    ...r,
    time: formatTime(r.timestamp),
  }));

  return (
    <div className="page">
      <PageHeader
        title="Environmental Analytics"
        subtitle="Historical trends and summary statistics for your poultry house"
        action={
          <div className="tab-group" role="group" aria-label="Date range">
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
      />

      {loading ? (
        <LoadingSpinner message="Loading analytics…" size="lg" />
      ) : error ? (
        <ErrorState message={error} onRetry={fetchData} />
      ) : !data ? (
        <EmptyState
          title="No analytics data yet"
          message="Analytics will appear once the system has collected sensor readings. Connect the Arduino and allow data to accumulate."
        />
      ) : (
        <>
          {demoMode && (
            <div className="demo-notice">
              Showing simulated demo data — not real sensor history.
            </div>
          )}

          {/* Event summary cards */}
          <div className="cards-grid cards-grid--4" style={{ marginBottom: '24px' }}>
            <div className="event-card event-card--warning">
              <div className="event-card__icon"><AlertTriangle size={24} /></div>
              <div className="event-card__count">{data.warnings ?? 0}</div>
              <div className="event-card__label">Warning Events</div>
            </div>
            <div className="event-card event-card--danger">
              <div className="event-card__icon"><XCircle size={24} /></div>
              <div className="event-card__count">{data.dangers ?? 0}</div>
              <div className="event-card__label">Danger Events</div>
            </div>
          </div>

          {/* Stats row */}
          <div className="cards-grid cards-grid--3" style={{ marginBottom: '24px' }}>
            <StatCard
              icon={<Wind size={16} />}
              title="Ammonia (ADC)"
              color="#0077B6"
              stats={[
                { label: 'Average', value: data.ammonia?.avg },
                { label: 'Minimum', value: data.ammonia?.min },
                { label: 'Maximum', value: data.ammonia?.max },
              ]}
            />
            <StatCard
              icon={<Thermometer size={16} />}
              title="Temperature"
              color="#DC2626"
              stats={[
                { label: 'Average', value: data.temperature?.avg, unit: ' °C' },
                { label: 'Minimum', value: data.temperature?.min, unit: ' °C' },
                { label: 'Maximum', value: data.temperature?.max, unit: ' °C' },
              ]}
            />
            <StatCard
              icon={<Droplets size={16} />}
              title="Humidity"
              color="#16A34A"
              stats={[
                { label: 'Average', value: data.humidity?.avg, unit: '%' },
                { label: 'Minimum', value: data.humidity?.min, unit: '%' },
                { label: 'Maximum', value: data.humidity?.max, unit: '%' },
              ]}
            />
          </div>

          {/* Ammonia trend */}
          {chartData.length === 0 ? (
            <EmptyState title="No chart data" message="No readings are available for the selected period." />
          ) : (
            <>
              <Card title="Ammonia Trend (ADC Reading)" style={{ marginBottom: '24px' }}>
                <div style={{ width: '100%', height: 260 }}>
                  <ResponsiveContainer>
                    <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#EAF0F4" />
                      <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#64748B' }} tickLine={false} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 11, fill: '#64748B' }} tickLine={false} axisLine={false} width={40} />
                      <Tooltip contentStyle={{ background: '#fff', border: '1px solid #D9E5EC', borderRadius: '8px', fontSize: '12px' }} />
                      <Line type="monotone" dataKey="ammonia" name="Ammonia (ADC)" stroke="#0077B6" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              {/* Temp & Humidity */}
              <Card title="Temperature & Humidity">
                <div style={{ width: '100%', height: 260 }}>
                  <ResponsiveContainer>
                    <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#EAF0F4" />
                      <XAxis dataKey="time" tick={{ fontSize: 11, fill: '#64748B' }} tickLine={false} interval="preserveStartEnd" />
                      <YAxis tick={{ fontSize: 11, fill: '#64748B' }} tickLine={false} axisLine={false} width={40} />
                      <Tooltip contentStyle={{ background: '#fff', border: '1px solid #D9E5EC', borderRadius: '8px', fontSize: '12px' }} />
                      <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '12px' }} />
                      <Line type="monotone" dataKey="temperature" name="Temperature (°C)" stroke="#DC2626" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                      <Line type="monotone" dataKey="humidity" name="Humidity (%)" stroke="#16A34A" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
