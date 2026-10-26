import StatusBadge from './StatusBadge';

/**
 * SensorCard — compact metric card used on Overview and Live Monitoring.
 * Props:
 *   icon        ReactNode
 *   label       string
 *   value       string | number | null
 *   unit        string
 *   status      'safe'|'warning'|'danger'|'no_data'
 *   subtitle    string   (e.g. "Last updated 12:34")
 *   highlight   boolean  (larger value display)
 */
export default function SensorCard({ icon, label, value, unit = '', status, subtitle, highlight = false }) {
  const displayValue = value != null ? value : '—';

  return (
    <div className="sensor-card">
      <div className="sensor-card__header">
        <span className="sensor-card__icon" aria-hidden="true">{icon}</span>
        <span className="sensor-card__label">{label}</span>
      </div>

      <div className={`sensor-card__value ${highlight ? 'sensor-card__value--large' : ''}`}>
        {displayValue}
        {value != null && unit && (
          <span className="sensor-card__unit">{unit}</span>
        )}
      </div>

      <div className="sensor-card__footer">
        {status && <StatusBadge status={status} size="sm" />}
        {subtitle && (
          <span className="sensor-card__subtitle">{subtitle}</span>
        )}
      </div>
    </div>
  );
}
