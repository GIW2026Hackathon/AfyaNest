import { Wind, Thermometer, Droplets, ShieldCheck } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import SensorCard from '../../components/SensorCard';
import LoadingSpinner from '../../components/LoadingSpinner';
import PageHeader from '../../components/PageHeader';

function formatTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const STATUS_EXPLANATIONS = {
  safe:    'All sensor readings are within acceptable ranges. The environment appears suitable for your flock.',
  warning: 'One or more readings are approaching unsafe levels. Monitor closely and consider improving ventilation.',
  danger:  'Sensor readings indicate potentially hazardous conditions. Inspect the poultry house immediately.',
  no_data: 'No sensor data has been received yet. Ensure the Arduino is connected and the backend is running.',
};

export default function Overview() {
  const { latestReading, demoMode } = useApp();

  if (!latestReading) return <LoadingSpinner message="Loading sensor data…" size="lg" />;

  const { ammonia, temperature, humidity, timestamp, status } = latestReading;
  const updatedAt = formatTime(timestamp);

  return (
    <div className="page">
      {/* Welcome banner */}
      <div className="overview-welcome">
        <div>
          <h2 className="overview-welcome__title">Welcome to AfyaNest</h2>
          <p className="overview-welcome__sub">
            Monitor your poultry environment and identify potential risks before they affect your flock.
          </p>
        </div>
        {demoMode && (
          <span className="demo-pill" aria-label="Displaying demo data">Demo Data</span>
        )}
      </div>

      <PageHeader
        title="Overview"
        subtitle="At-a-glance summary of your poultry house environment"
      />

      {/* Summary cards */}
      <div className="cards-grid cards-grid--4">
        {/* Ammonia */}
        <SensorCard
          icon={<Wind size={20} />}
          label="Ammonia Level"
          value={ammonia != null ? ammonia : null}
          unit=" ADC"
          status={latestReading.status}
          subtitle={`ADC reading — raw MQ-137 value${updatedAt !== '—' ? ` · ${updatedAt}` : ''}`}
          highlight
        />

        {/* Temperature */}
        <SensorCard
          icon={<Thermometer size={20} />}
          label="Temperature"
          value={temperature != null ? temperature : null}
          unit=" °C"
          status={null}
          subtitle={updatedAt !== '—' ? `Updated ${updatedAt}` : 'No data'}
          highlight
        />

        {/* Humidity */}
        <SensorCard
          icon={<Droplets size={20} />}
          label="Humidity"
          value={humidity != null ? humidity : null}
          unit="%"
          status={null}
          subtitle={updatedAt !== '—' ? `Updated ${updatedAt}` : 'No data'}
          highlight
        />

        {/* Overall status */}
        <div className="sensor-card sensor-card--status">
          <div className="sensor-card__header">
            <span className="sensor-card__icon" aria-hidden="true"><ShieldCheck size={20} /></span>
            <span className="sensor-card__label">Overall Environment</span>
          </div>
          <div className={`status-display status-display--${status ?? 'no_data'}`}>
            {status === 'safe'    && 'Safe'}
            {status === 'warning' && 'Warning'}
            {status === 'danger'  && 'Danger'}
            {(!status || status === 'no_data') && 'No Data'}
          </div>
          <p className="sensor-card__explanation">
            {STATUS_EXPLANATIONS[status ?? 'no_data']}
          </p>
        </div>
      </div>

      {/* Readings note */}
      <div className="overview-note">
        <strong>Note:</strong> Ammonia values shown are raw ADC readings from the MQ-137 sensor and have not been
        converted to ppm. Calibration against a reference gas standard is required before interpreting
        values as ammonia concentrations.
      </div>
    </div>
  );
}
