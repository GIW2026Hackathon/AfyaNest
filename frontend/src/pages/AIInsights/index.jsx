import { useMemo, useEffect, useState, useCallback } from 'react';
import {
  RadialBarChart, RadialBar, ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts';
import { Wind, Thermometer, Droplets, TrendingUp, AlertTriangle, Wrench } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import LoadingSpinner from '../../components/LoadingSpinner';
import Card from '../../components/Card';
import StatusBadge from '../../components/StatusBadge';

// ---------------------------------------------------------------------------
// Rules engine
// ---------------------------------------------------------------------------
function deriveInsights(reading, settings, alerts) {
  if (!reading) return [];
  const out = [];
  const { ammonia, temperature, humidity } = reading;
  const { warning, danger } = settings.thresholds;

  if (ammonia >= danger)        out.push({ id: 'nh3-d', sensor: 'Ammonia', type: 'danger',  action: 'Ventilate immediately. Check litter for moisture.' });
  else if (ammonia >= warning)  out.push({ id: 'nh3-w', sensor: 'Ammonia', type: 'warning', action: 'Inspect ventilation. Check litter condition.' });
  if (temperature > 32)         out.push({ id: 'tmp-h', sensor: 'Temperature', type: 'warning', action: 'Increase airflow. Provide cool water.' });
  else if (temperature < 18)    out.push({ id: 'tmp-l', sensor: 'Temperature', type: 'warning', action: 'Check heating. Seal draughts.' });
  if (humidity > 75)            out.push({ id: 'hum-h', sensor: 'Humidity',    type: 'warning', action: 'Improve ventilation. Fix leaking drinkers.' });
  else if (humidity < 40)       out.push({ id: 'hum-l', sensor: 'Humidity',    type: 'warning', action: 'Monitor dust levels.' });

  const recentWarn = alerts.filter(a =>
    a.severity === 'warning' && (Date.now() - new Date(a.timestamp)) < 6 * 3_600_000
  );
  if (recentWarn.length >= 2)
    out.push({ id: 'pat', sensor: 'Pattern', type: 'warning', action: `${recentWarn.length} warnings in 6 h — investigate root cause.` });

  return out;
}

const SENSOR_ICONS = { Ammonia: <Wind size={16} />, Temperature: <Thermometer size={16} />, Humidity: <Droplets size={16} />, Pattern: <TrendingUp size={16} /> };
const TYPE_BORDER  = { safe: '#16A34A', warning: '#EAB308', danger: '#DC2626' };
const TYPE_BG      = { safe: '#F0FDF4', warning: '#FEFCE8', danger: '#FEF2F2' };

function InsightRow({ insight }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: '12px',
      padding: '12px 14px',
      borderLeft: `3px solid ${TYPE_BORDER[insight.type]}`,
      background: TYPE_BG[insight.type],
      borderRadius: '6px',
    }}>
      <span style={{ color: TYPE_BORDER[insight.type], marginTop: '1px' }}>{SENSOR_ICONS[insight.sensor]}</span>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <strong style={{ fontSize: '13px' }}>{insight.sensor}</strong>
          <StatusBadge status={insight.type === 'danger' ? 'danger' : insight.type === 'warning' ? 'warning' : 'safe'} size="sm" />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#172B3A' }}>
          <Wrench size={13} color="#64748B" />
          {insight.action}
        </div>
      </div>
    </div>
  );
}

// Radial gauge for a single sensor
function Gauge({ value, max, color, label, unit }) {
  const pct = Math.min(100, Math.round(((value ?? 0) / max) * 100));
  const data = [{ name: label, value: pct, fill: color }];
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ width: 120, height: 120, margin: '0 auto' }}>
        <ResponsiveContainer>
          <RadialBarChart innerRadius="60%" outerRadius="90%" data={data} startAngle={210} endAngle={-30} barSize={10}>
            <RadialBar dataKey="value" cornerRadius={5} background={{ fill: '#EAF0F4' }} />
          </RadialBarChart>
        </ResponsiveContainer>
      </div>
      <div style={{ marginTop: '-4px', fontSize: '20px', fontWeight: 700, color: '#172B3A' }}>
        {value ?? '—'}<span style={{ fontSize: '12px', color: '#64748B', fontWeight: 500 }}>{unit}</span>
      </div>
      <div style={{ fontSize: '11px', color: '#64748B', marginTop: '2px' }}>{label}</div>
    </div>
  );
}

export default function AIPrediction() {
  const { latestReading, settings, alerts, loadHistory } = useApp();
  const insights = useMemo(
    () => deriveInsights(latestReading, settings, alerts),
    [latestReading, settings, alerts]
  );

  const [history, setHistory] = useState([]);
  const fetchHistory = useCallback(async () => {
    try { setHistory((await loadHistory('6h')) ?? []); } catch { /* ignore */ }
  }, [loadHistory]);
  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const chartData = history.map(r => ({
    ...r,
    time: new Date(r.timestamp).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }),
  }));

  if (!latestReading) return <LoadingSpinner message="Loading…" size="lg" />;

  const safeInsights  = insights.filter(i => i.type === 'safe');
  const actionInsights = insights.filter(i => i.type !== 'safe');

  return (
    <div className="page">

      {/* Gauges */}
      <Card style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center', flexWrap: 'wrap', gap: '12px', padding: '8px 0' }}>
          <Gauge value={latestReading.ammonia}     max={1023} color="#0077B6" label="Ammonia" unit=" ADC" />
          <Gauge value={latestReading.temperature} max={50}   color="#DC2626" label="Temp"    unit=" °C" />
          <Gauge value={latestReading.humidity}    max={100}  color="#16A34A" label="Humidity" unit="%" />
          <div style={{ textAlign: 'center' }}>
            <StatusBadge status={latestReading.status} size="lg" />
            <div style={{ fontSize: '11px', color: '#64748B', marginTop: '8px' }}>Overall</div>
          </div>
        </div>
      </Card>

      {/* Ammonia 6h trend with thresholds */}
      <Card title="Ammonia — Last 6 Hours" style={{ marginBottom: '16px' }}>
        {chartData.length === 0 ? (
          <div style={{ padding: '24px', textAlign: 'center', color: '#64748B', fontSize: '13px' }}>No data yet.</div>
        ) : (
          <div style={{ width: '100%', height: 200 }}>
            <ResponsiveContainer>
              <LineChart data={chartData} margin={{ top: 4, right: 12, left: -8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#EAF0F4" />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#64748B' }} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: '#64748B' }} tickLine={false} axisLine={false} width={32} />
                <Tooltip contentStyle={{ background: '#fff', border: '1px solid #D9E5EC', borderRadius: '8px', fontSize: '12px' }} />
                <ReferenceLine y={settings.thresholds.warning} stroke="#EAB308" strokeDasharray="4 3"
                  label={{ value: 'Warn', position: 'insideTopRight', fontSize: 10, fill: '#EAB308' }} />
                <ReferenceLine y={settings.thresholds.danger} stroke="#DC2626" strokeDasharray="4 3"
                  label={{ value: 'Danger', position: 'insideTopRight', fontSize: 10, fill: '#DC2626' }} />
                <Line type="monotone" dataKey="ammonia" stroke="#0077B6" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {/* Recommendations */}
      {actionInsights.length > 0 && (
        <Card title="Recommendations" style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {actionInsights.map(i => <InsightRow key={i.id} insight={i} />)}
          </div>
        </Card>
      )}

      {actionInsights.length === 0 && (
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0', color: '#16A34A' }}>
            <AlertTriangle size={18} />
            <span style={{ fontSize: '14px', fontWeight: 600 }}>All readings are within normal range.</span>
          </div>
        </Card>
      )}
    </div>
  );
}
