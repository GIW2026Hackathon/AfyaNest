import { useMemo, useEffect, useState, useCallback } from 'react';
import {
  AreaChart, Area, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
  ResponsiveContainer, Legend,
} from 'recharts';
import {
  Wind, Thermometer, Droplets, TrendingUp,
  CheckCircle, AlertTriangle, XCircle, Wrench, Activity,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import LoadingSpinner from '../../components/LoadingSpinner';
import Card from '../../components/Card';

// ─── helpers ────────────────────────────────────────────────────────────────

function deriveInsights(reading, settings, alerts) {
  if (!reading) return [];
  const out = [];
  const { ammonia, temperature, humidity } = reading;
  const { warning, danger } = settings.thresholds;

  if (ammonia >= danger)
    out.push({ id: 'nh3-d', sensor: 'Ammonia', type: 'danger',
      headline: 'Critical ammonia level',
      action: 'Open ventilation panels immediately. Check for wet or caked litter.' });
  else if (ammonia >= warning)
    out.push({ id: 'nh3-w', sensor: 'Ammonia', type: 'warning',
      headline: 'Ammonia rising',
      action: 'Inspect ventilation. Check litter moisture and turn if needed.' });
  else
    out.push({ id: 'nh3-ok', sensor: 'Ammonia', type: 'safe',
      headline: 'Ammonia normal',
      action: 'Keep monitoring. Maintain current litter management.' });

  if (temperature > 32)
    out.push({ id: 'tmp-h', sensor: 'Temperature', type: 'warning',
      headline: 'Heat stress risk',
      action: 'Increase airflow. Provide cool drinking water.' });
  else if (temperature < 18)
    out.push({ id: 'tmp-l', sensor: 'Temperature', type: 'warning',
      headline: 'Cold stress risk',
      action: 'Check heating. Close draughts.' });

  if (humidity > 75)
    out.push({ id: 'hum-h', sensor: 'Humidity', type: 'warning',
      headline: 'High humidity',
      action: 'Improve air exchange. Inspect drinker lines for leaks.' });
  else if (humidity < 40)
    out.push({ id: 'hum-l', sensor: 'Humidity', type: 'warning',
      headline: 'Low humidity',
      action: 'Monitor dust. Ensure birds have adequate water.' });

  const recentWarn = alerts.filter(
    a => a.severity === 'warning' && Date.now() - new Date(a.timestamp) < 6 * 3_600_000
  );
  if (recentWarn.length >= 2)
    out.push({ id: 'pat', sensor: 'Pattern', type: 'warning',
      headline: `${recentWarn.length} warnings in 6 h`,
      action: 'Persistent issue detected — inspect house conditions.' });

  return out;
}

/** 0–100 flock risk score based on current readings */
function riskScore(reading, settings) {
  if (!reading) return 0;
  const { ammonia, temperature, humidity } = reading;
  const { warning, danger } = settings.thresholds;
  let score = 0;
  const nh3pct = ammonia / danger;
  score += Math.min(60, Math.round(nh3pct * 60));
  if (temperature > 32 || temperature < 18) score += 20;
  if (humidity > 75 || humidity < 40) score += 20;
  return Math.min(100, score);
}

function scoreLabel(s) {
  if (s >= 70) return { text: 'High Risk',    color: '#DC2626' };
  if (s >= 40) return { text: 'Moderate Risk',color: '#EAB308' };
  return            { text: 'Low Risk',       color: '#16A34A' };
}

function statsFor(data, key) {
  if (!data.length) return { avg: '—', min: '—', max: '—' };
  const vals = data.map(r => r[key]);
  const avg = (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(key === 'temperature' ? 1 : 0);
  return { avg, min: Math.min(...vals), max: Math.max(...vals) };
}

// ─── sub-components ─────────────────────────────────────────────────────────

const STATUS_COLOR = { safe: '#16A34A', warning: '#EAB308', danger: '#DC2626' };
const STATUS_BG    = { safe: '#F0FDF4', warning: '#FEFCE8', danger: '#FEF2F2' };
const STATUS_ICON  = {
  safe:    <CheckCircle  size={18} />,
  warning: <AlertTriangle size={18} />,
  danger:  <XCircle      size={18} />,
};
const SENSOR_ICON  = {
  Ammonia:     <Wind      size={16} />,
  Temperature: <Thermometer size={16} />,
  Humidity:    <Droplets  size={16} />,
  Pattern:     <TrendingUp size={16} />,
};

function InsightCard({ insight }) {
  const color = STATUS_COLOR[insight.type];
  const bg    = STATUS_BG[insight.type];
  return (
    <div className="ai-insight-card" style={{ borderLeftColor: color, background: bg }}>
      <div className="ai-insight-card__top">
        <span className="ai-insight-card__sensor-icon" style={{ color }}>
          {SENSOR_ICON[insight.sensor]}
        </span>
        <div className="ai-insight-card__labels">
          <span className="ai-insight-card__sensor">{insight.sensor}</span>
          <span className="ai-insight-card__headline" style={{ color }}>{insight.headline}</span>
        </div>
        <span className="ai-insight-card__status-icon" style={{ color }}>
          {STATUS_ICON[insight.type]}
        </span>
      </div>
      <div className="ai-insight-card__action">
        <Wrench size={13} color="#64748B" style={{ flexShrink: 0, marginTop: '1px' }} />
        <span>{insight.action}</span>
      </div>
    </div>
  );
}

/** Arc-style score ring drawn with SVG */
function RiskRing({ score }) {
  const { text, color } = scoreLabel(score);
  const r = 52;
  const cx = 70;
  const cy = 70;
  const startAngle = 220;
  const sweepTotal = 280;
  const sweepFill  = (score / 100) * sweepTotal;

  function polar(angle, radius) {
    const rad = ((angle - 90) * Math.PI) / 180;
    return [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)];
  }
  function arc(startDeg, sweepDeg, radius) {
    const [sx, sy] = polar(startDeg, radius);
    const [ex, ey] = polar(startDeg + sweepDeg, radius);
    const large = sweepDeg > 180 ? 1 : 0;
    return `M ${sx} ${sy} A ${radius} ${radius} 0 ${large} 1 ${ex} ${ey}`;
  }

  return (
    <div style={{ textAlign: 'center' }}>
      <svg width={140} height={110} viewBox="0 0 140 100" aria-hidden="true">
        {/* track */}
        <path d={arc(startAngle, sweepTotal, r)} fill="none" stroke="#EAF0F4" strokeWidth={10} strokeLinecap="round" />
        {/* fill */}
        {score > 0 && (
          <path d={arc(startAngle, sweepFill, r)} fill="none" stroke={color} strokeWidth={10} strokeLinecap="round" />
        )}
        {/* score text */}
        <text x={cx} y={cy + 6} textAnchor="middle" fontSize="22" fontWeight="700" fill="#172B3A">{score}</text>
        <text x={cx} y={cy + 22} textAnchor="middle" fontSize="10" fill="#64748B">/100</text>
      </svg>
      <div style={{ fontSize: '13px', fontWeight: 700, color, marginTop: '-8px' }}>{text}</div>
      <div style={{ fontSize: '11px', color: '#64748B', marginTop: '3px' }}>Flock Risk Score</div>
    </div>
  );
}

/** Mini gauge arc for individual sensors */
function SensorGauge({ value, max, color, label, unit, status }) {
  const pct   = Math.min(100, Math.round(((value ?? 0) / max) * 100));
  const sColor = STATUS_COLOR[status] ?? color;
  const r = 36;
  const cx = 48, cy = 52;
  const startAngle = 210, sweepTotal = 240;
  const sweepFill  = (pct / 100) * sweepTotal;

  function polar(angle, radius) {
    const rad = ((angle - 90) * Math.PI) / 180;
    return [cx + radius * Math.cos(rad), cy + radius * Math.sin(rad)];
  }
  function arc(startDeg, sweepDeg, radius) {
    const [sx, sy] = polar(startDeg, radius);
    const [ex, ey] = polar(startDeg + sweepDeg, radius);
    const large = sweepDeg > 180 ? 1 : 0;
    return `M ${sx} ${sy} A ${radius} ${radius} 0 ${large} 1 ${ex} ${ey}`;
  }

  return (
    <div className="sensor-gauge">
      <svg width={96} height={80} viewBox="0 0 96 72" aria-hidden="true">
        <path d={arc(startAngle, sweepTotal, r)} fill="none" stroke="#EAF0F4" strokeWidth={7} strokeLinecap="round" />
        {pct > 0 && (
          <path d={arc(startAngle, sweepFill, r)} fill="none" stroke={sColor} strokeWidth={7} strokeLinecap="round" />
        )}
        <text x={cx} y={cy + 2} textAnchor="middle" fontSize="13" fontWeight="700" fill="#172B3A">
          {value ?? '—'}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize="9" fill="#64748B">{unit}</text>
      </svg>
      <div style={{ fontSize: '11px', fontWeight: 600, color: '#64748B', textAlign: 'center', marginTop: '-6px' }}>{label}</div>
    </div>
  );
}

function StatBar({ label, avg, min, max, unit }) {
  return (
    <div className="ai-stat-bar">
      <span className="ai-stat-bar__label">{label}</span>
      <span className="ai-stat-bar__item"><span className="ai-stat-bar__key">Avg</span> {avg}{unit}</span>
      <span className="ai-stat-bar__item"><span className="ai-stat-bar__key">Min</span> {min}{unit}</span>
      <span className="ai-stat-bar__item"><span className="ai-stat-bar__key">Max</span> {max}{unit}</span>
    </div>
  );
}

const CHART_TABS = [
  { key: 'ammonia',     label: 'Ammonia',     color: '#0077B6', unit: 'ppm' },
  { key: 'temperature', label: 'Temperature', color: '#DC2626', unit: '°C'  },
  { key: 'humidity',    label: 'Humidity',    color: '#16A34A', unit: '%'   },
];

// ─── main page ───────────────────────────────────────────────────────────────

export default function AIPrediction() {
  const { latestReading, settings, alerts, loadHistory } = useApp();
  const insights = useMemo(() => deriveInsights(latestReading, settings, alerts), [latestReading, settings, alerts]);
  const score    = useMemo(() => riskScore(latestReading, settings),              [latestReading, settings]);

  const [history, setHistory]     = useState([]);
  const [chartTab, setChartTab]   = useState('ammonia');
  const [chartRange, setChartRange] = useState('6h');
  const [loading, setLoading]     = useState(false);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try { setHistory((await loadHistory(chartRange)) ?? []); }
    finally { setLoading(false); }
  }, [loadHistory, chartRange]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const chartData = history.map(r => ({
    ...r,
    time: new Date(r.timestamp).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' }),
  }));

  const activeTab = CHART_TABS.find(t => t.key === chartTab);
  const nh3Stats  = statsFor(history, 'ammonia');
  const tmpStats  = statsFor(history, 'temperature');
  const humStats  = statsFor(history, 'humidity');

  const actionInsights = insights.filter(i => i.type !== 'safe');
  const allGood        = actionInsights.length === 0;
  const advice         = latestReading?.advice;

  if (!latestReading) return <LoadingSpinner message="Loading…" size="lg" />;

  const nh3Status = latestReading.ammonia >= settings.thresholds.danger ? 'danger'
    : latestReading.ammonia >= settings.thresholds.warning ? 'warning' : 'safe';
  const tmpStatus = latestReading.temperature > 32 || latestReading.temperature < 18 ? 'warning' : 'safe';
  const humStatus = latestReading.humidity > 75 || latestReading.humidity < 40 ? 'warning' : 'safe';

  return (
    <div className="page ai-prediction-page">

      {/* ── Row 1: Risk score + sensor gauges ── */}
      <div className="ai-top-row">

        {/* Risk score card */}
        <div className="card ai-risk-card">
          <RiskRing score={score} />
          <div className="ai-risk-card__updated">
            <Activity size={12} />
            Updated {new Date(latestReading.timestamp).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </div>
        </div>

        {/* Sensor gauges */}
        <div className="card ai-gauges-card">
          <div className="ai-gauges-row">
            <SensorGauge value={latestReading.ammonia != null ? parseFloat(latestReading.ammonia.toFixed(1)) : null} max={50} color="#0077B6" label="Ammonia" unit="ppm" status={nh3Status} />
            <div className="ai-gauges-divider" />
            <SensorGauge value={latestReading.temperature} max={50}  color="#DC2626" label="Temperature" unit="°C" status={tmpStatus} />
            <div className="ai-gauges-divider" />
            <SensorGauge value={latestReading.humidity}    max={100} color="#16A34A" label="Humidity"    unit="%" status={humStatus} />
          </div>

          <div className="ai-stats-grid">
            <StatBar label="Ammonia"     avg={nh3Stats.avg} min={nh3Stats.min} max={nh3Stats.max} unit=" ppm" />
            <StatBar label="Temperature" avg={tmpStats.avg} min={tmpStats.min} max={tmpStats.max} unit=" °C" />
            <StatBar label="Humidity"    avg={humStats.avg} min={humStats.min} max={humStats.max} unit="%" />
          </div>
        </div>
      </div>

      {/* ── ML Forecast panel (only when backend advice is available) ── */}
      {advice && advice.status_quo_peak_nh3 != null && (
        <Card style={{ marginTop: '16px' }}>
          <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: '180px' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#64748B', marginBottom: '6px' }}>Without action</div>
              <div style={{ fontSize: '28px', fontWeight: 700, color: '#DC2626' }}>
                {advice.status_quo_peak_nh3.toFixed(1)} <span style={{ fontSize: '14px', fontWeight: 500, color: '#64748B' }}>ppm peak</span>
              </div>
              <div style={{ fontSize: '12px', color: '#64748B', marginTop: '4px' }}>
                {advice.hours_to_warn != null ? `Warn threshold in ~${advice.hours_to_warn.toFixed(1)} h` : 'Forecast available'}
              </div>
            </div>
            <div style={{ flex: 1, minWidth: '180px' }}>
              <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#64748B', marginBottom: '6px' }}>With recommended action</div>
              <div style={{ fontSize: '28px', fontWeight: 700, color: '#16A34A' }}>
                {advice.plan_peak_nh3 != null ? advice.plan_peak_nh3.toFixed(1) : '—'} <span style={{ fontSize: '14px', fontWeight: 500, color: '#64748B' }}>ppm peak</span>
              </div>
              <div style={{ fontSize: '12px', color: '#64748B', marginTop: '4px' }}>
                Model: {advice.model ?? 'gbm_baseline'}
              </div>
            </div>
            {advice.findings && advice.findings.length > 0 && (
              <div style={{ flex: 2, minWidth: '220px' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#64748B', marginBottom: '6px' }}>Findings</div>
                {advice.findings.map((f, i) => (
                  <div key={i} style={{ fontSize: '12px', color: '#172B3A', marginBottom: '4px', display: 'flex', gap: '6px' }}>
                    <TrendingUp size={12} color="#EAB308" style={{ marginTop: '2px', flexShrink: 0 }} />
                    <span>{f.detail || f.type}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      )}

      {/* ── Row 2: Trend chart ── */}
      <Card style={{ marginTop: '16px' }}>
        <div className="ai-chart-header">
          <div className="tab-group" role="group" aria-label="Sensor">
            {CHART_TABS.map(t => (
              <button
                key={t.key}
                className={`tab-btn ${chartTab === t.key ? 'tab-btn--active' : ''}`}
                style={chartTab === t.key ? { background: t.color } : {}}
                onClick={() => setChartTab(t.key)}
                aria-pressed={chartTab === t.key}
              >{t.label}</button>
            ))}
          </div>
          <div className="tab-group" role="group" aria-label="Range">
            {['1h', '6h', '24h'].map(r => (
              <button key={r}
                className={`tab-btn ${chartRange === r ? 'tab-btn--active' : ''}`}
                onClick={() => setChartRange(r)}
                aria-pressed={chartRange === r}
              >{r}</button>
            ))}
          </div>
        </div>

        {loading ? (
          <LoadingSpinner message="Loading chart…" />
        ) : chartData.length === 0 ? (
          <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748B', fontSize: '13px' }}>
            No data for this range yet.
          </div>
        ) : (
          <div style={{ width: '100%', height: 220, marginTop: '12px' }}>
            <ResponsiveContainer>
              <AreaChart data={chartData} margin={{ top: 4, right: 12, left: -10, bottom: 4 }}>
                <defs>
                  <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor={activeTab.color} stopOpacity={0.15} />
                    <stop offset="95%" stopColor={activeTab.color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#EAF0F4" vertical={false} />
                <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#64748B' }} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: '#64748B' }} tickLine={false} axisLine={false} width={34} />
                <Tooltip
                  contentStyle={{ background: '#fff', border: '1px solid #D9E5EC', borderRadius: '8px', fontSize: '12px' }}
                  formatter={(v) => [`${v} ${activeTab.unit}`, activeTab.label]}
                />
                {chartTab === 'ammonia' && <>
                  <ReferenceLine y={settings.thresholds.warning} stroke="#EAB308" strokeDasharray="5 3"
                    label={{ value: `Warn ${settings.thresholds.warning}`, position: 'insideTopRight', fontSize: 10, fill: '#EAB308' }} />
                  <ReferenceLine y={settings.thresholds.danger} stroke="#DC2626" strokeDasharray="5 3"
                    label={{ value: `Danger ${settings.thresholds.danger}`, position: 'insideTopRight', fontSize: 10, fill: '#DC2626' }} />
                </>}
                <Area
                  type="monotone"
                  dataKey={chartTab}
                  stroke={activeTab.color}
                  strokeWidth={2.5}
                  fill="url(#areaFill)"
                  dot={false}
                  activeDot={{ r: 5, fill: activeTab.color, strokeWidth: 0 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {/* ── Row 3: Recommendations ── */}
      <Card
        title={allGood ? undefined : 'Recommendations'}
        style={{ marginTop: '16px' }}
      >
        {allGood ? (
          <div className="ai-all-good">
            <CheckCircle size={32} color="#16A34A" strokeWidth={1.5} />
            <div>
              <div style={{ fontWeight: 700, color: '#16A34A', fontSize: '15px' }}>All conditions normal</div>
              <div style={{ fontSize: '13px', color: '#64748B', marginTop: '3px' }}>No action required right now.</div>
            </div>
          </div>
        ) : (
          <div className="ai-insight-list">
            {actionInsights.map(i => <InsightCard key={i.id} insight={i} />)}
          </div>
        )}
      </Card>

    </div>
  );
}
