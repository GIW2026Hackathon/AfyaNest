import { useMemo } from 'react';
import {
  Lightbulb, TrendingUp, AlertTriangle, Wind, Thermometer,
  Droplets, Eye, Wrench, Info, BrainCircuit,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import PageHeader from '../../components/PageHeader';
import Card from '../../components/Card';
import LoadingSpinner from '../../components/LoadingSpinner';

// ---------------------------------------------------------------------------
// Rules-based insight engine
// ---------------------------------------------------------------------------
function deriveInsights(reading, settings, alerts) {
  if (!reading) return [];
  const insights = [];
  const { ammonia, temperature, humidity } = reading;
  const { warning, danger } = settings.thresholds;

  // Ammonia
  if (ammonia >= danger) {
    insights.push({
      id: 'nh3-danger',
      type: 'danger',
      sensor: 'Ammonia',
      icon: <Wind size={18} />,
      observation: `Ammonia ADC reading is ${ammonia}, which is at or above the configured danger threshold (${danger}).`,
      risk: 'Elevated ammonia exposure can cause respiratory distress, eye irritation and reduced growth in poultry.',
      action: 'Increase ventilation immediately. Inspect for wet litter or manure accumulation. Consider removing birds if conditions persist.',
      label: 'Danger — Immediate Action Required',
    });
  } else if (ammonia >= warning) {
    insights.push({
      id: 'nh3-warning',
      type: 'warning',
      sensor: 'Ammonia',
      icon: <Wind size={18} />,
      observation: `Ammonia ADC reading is ${ammonia}, approaching the warning threshold (${warning}).`,
      risk: 'Rising ammonia can indicate inadequate litter management or poor airflow, which may worsen if left unaddressed.',
      action: 'Check ventilation openings. Inspect litter for moisture. Consider adding absorbent bedding material.',
      label: 'Warning — Monitor Closely',
    });
  } else {
    insights.push({
      id: 'nh3-safe',
      type: 'safe',
      sensor: 'Ammonia',
      icon: <Wind size={18} />,
      observation: `Ammonia ADC reading is ${ammonia}, within the acceptable range (below ${warning}).`,
      risk: 'No immediate ammonia concern detected.',
      action: 'Continue regular monitoring and maintain current litter management practices.',
      label: 'Safe — Normal Range',
    });
  }

  // Temperature
  if (temperature > 32) {
    insights.push({
      id: 'temp-high',
      type: 'warning',
      sensor: 'Temperature',
      icon: <Thermometer size={18} />,
      observation: `Temperature is ${temperature} °C, which is above the typical comfort range for poultry (18–28 °C).`,
      risk: 'Heat stress can reduce feed intake, egg production and cause mortality in severe cases.',
      action: 'Increase ventilation, provide cool drinking water, and consider shading during peak heat hours.',
      label: 'Warning — High Temperature',
    });
  } else if (temperature < 18) {
    insights.push({
      id: 'temp-low',
      type: 'warning',
      sensor: 'Temperature',
      icon: <Thermometer size={18} />,
      observation: `Temperature is ${temperature} °C, below the typical comfort range for mature poultry (18–28 °C).`,
      risk: 'Cold stress increases energy consumption and can lead to poor performance in young birds.',
      action: 'Check heating systems and ensure there are no draughts or insulation gaps in the poultry house.',
      label: 'Warning — Low Temperature',
    });
  }

  // Humidity
  if (humidity > 75) {
    insights.push({
      id: 'hum-high',
      type: 'warning',
      sensor: 'Humidity',
      icon: <Droplets size={18} />,
      observation: `Humidity is ${humidity}%, above the recommended upper limit of 70–75% for poultry houses.`,
      risk: 'High humidity promotes wet litter, ammonia release, and pathogen growth including fungi and bacteria.',
      action: 'Improve air exchange, reduce water spillage, and inspect drinker lines for leaks.',
      label: 'Warning — High Humidity',
    });
  } else if (humidity < 40) {
    insights.push({
      id: 'hum-low',
      type: 'warning',
      sensor: 'Humidity',
      icon: <Droplets size={18} />,
      observation: `Humidity is ${humidity}%, below the recommended lower limit of 40–50%.`,
      risk: 'Very dry air increases dust levels, which can irritate respiratory tracts.',
      action: 'Monitor for excessive dust. Ensure adequate water access for birds.',
      label: 'Warning — Low Humidity',
    });
  }

  // Repeated warnings pattern
  const recentWarnings = alerts.filter(a => {
    const ago = Date.now() - new Date(a.timestamp).getTime();
    return a.severity === 'warning' && ago < 6 * 3_600_000;
  });
  if (recentWarnings.length >= 2) {
    insights.push({
      id: 'repeat-warnings',
      type: 'warning',
      sensor: 'Pattern',
      icon: <TrendingUp size={18} />,
      observation: `${recentWarnings.length} warning events have been recorded in the last 6 hours.`,
      risk: 'Repeated warnings suggest a persistent underlying issue rather than a transient spike.',
      action: 'Investigate root cause. Check litter condition, ventilation equipment and sensor placement.',
      label: 'Pattern — Repeated Warnings',
    });
  }

  return insights;
}

const TYPE_STYLE = {
  safe:    { border: '#BBF7D0', bg: '#F0FDF4', color: '#16A34A', tag: '#16A34A' },
  warning: { border: '#FDE68A', bg: '#FEFCE8', color: '#EAB308', tag: '#EAB308' },
  danger:  { border: '#FECACA', bg: '#FEF2F2', color: '#DC2626', tag: '#DC2626' },
};

function InsightCard({ insight }) {
  const style = TYPE_STYLE[insight.type] ?? TYPE_STYLE.safe;
  return (
    <div
      className="insight-card"
      style={{ borderLeft: `4px solid ${style.border}`, background: style.bg }}
      role="article"
      aria-label={`${insight.sensor} insight: ${insight.label}`}
    >
      <div className="insight-card__header">
        <span style={{ color: style.color, display: 'flex', alignItems: 'center', gap: '6px' }}>
          {insight.icon}
          <strong>{insight.sensor}</strong>
        </span>
        <span className="insight-card__tag" style={{ color: style.tag, borderColor: style.border }}>
          {insight.label}
        </span>
      </div>

      <div className="insight-card__body">
        <div className="insight-row">
          <Eye size={14} aria-hidden="true" />
          <div>
            <div className="insight-row__key">Current Observation</div>
            <div className="insight-row__val">{insight.observation}</div>
          </div>
        </div>
        <div className="insight-row">
          <AlertTriangle size={14} aria-hidden="true" />
          <div>
            <div className="insight-row__key">Potential Risk</div>
            <div className="insight-row__val">{insight.risk}</div>
          </div>
        </div>
        <div className="insight-row">
          <Wrench size={14} aria-hidden="true" />
          <div>
            <div className="insight-row__key">Recommended Action</div>
            <div className="insight-row__val">{insight.action}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AIInsights() {
  const { latestReading, settings, alerts } = useApp();
  const insights = useMemo(
    () => deriveInsights(latestReading, settings, alerts),
    [latestReading, settings, alerts]
  );

  return (
    <div className="page">
      <PageHeader
        title="AI Insights"
        subtitle="Rules-based analysis of current sensor conditions and recommended actions"
      />

      {/* Methodology notice */}
      <Card style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
          <BrainCircuit size={32} color="#0077B6" style={{ flexShrink: 0, marginTop: '2px' }} aria-hidden="true" />
          <div>
            <h3 style={{ margin: '0 0 6px', fontSize: '15px', color: '#172B3A', fontWeight: 600 }}>
              About AI Insights — Prototype v1.0
            </h3>
            <p style={{ margin: 0, fontSize: '13px', color: '#64748B', lineHeight: '1.7' }}>
              The insights on this page are generated by a <strong>rules-based engine</strong> that compares
              live sensor readings against configurable thresholds. This is not a trained machine-learning model.
              No AI model accuracy, confidence scores or ppm predictions are claimed. Once sufficient historical
              data has been collected and validated, this section will be extended with pattern-recognition
              and predictive capabilities clearly labelled as such.
            </p>
          </div>
        </div>
      </Card>

      {/* Insights */}
      {!latestReading ? (
        <LoadingSpinner message="Waiting for sensor data to generate insights…" size="lg" />
      ) : insights.length === 0 ? (
        <div style={{ padding: '32px', textAlign: 'center', color: '#64748B' }}>
          <Lightbulb size={40} color="#D9E5EC" />
          <p style={{ marginTop: '12px' }}>No insights to display at this time.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {insights.map(i => <InsightCard key={i.id} insight={i} />)}
        </div>
      )}

      {/* Future ML section */}
      <Card style={{ marginTop: '32px' }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
          <Info size={20} color="#0077B6" style={{ flexShrink: 0, marginTop: '2px' }} aria-hidden="true" />
          <div>
            <h3 style={{ margin: '0 0 6px', fontSize: '14px', color: '#172B3A', fontWeight: 600 }}>
              Machine Learning Predictions — Coming Soon
            </h3>
            <p style={{ margin: 0, fontSize: '13px', color: '#64748B', lineHeight: '1.7' }}>
              A future version of AfyaNest will train predictive models on historical sensor data
              collected by this prototype. Predictions will include forecasted ammonia accumulation trends
              and early warning detection. Model performance metrics and confidence scores will only be
              shown once a validated model is deployed.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
