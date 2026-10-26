import { Cpu, Usb, Wind, Thermometer, Clock, RefreshCw, WifiOff, CheckCircle, AlertCircle, Loader } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import PageHeader from '../../components/PageHeader';
import Card from '../../components/Card';
import LoadingSpinner from '../../components/LoadingSpinner';

function StatusRow({ icon, label, status, detail }) {
  const statusConfig = {
    connected:      { color: '#16A34A', text: 'Connected',       Icon: CheckCircle },
    disconnected:   { color: '#DC2626', text: 'Disconnected',    Icon: WifiOff },
    waiting:        { color: '#EAB308', text: 'Waiting for data',Icon: Loader },
    error:          { color: '#DC2626', text: 'Sensor Error',    Icon: AlertCircle },
    ok:             { color: '#16A34A', text: 'OK',              Icon: CheckCircle },
    demo:           { color: '#EAB308', text: 'Demo Mode',       Icon: Loader },
  };
  const cfg = statusConfig[status] ?? statusConfig.waiting;
  const { color, text, Icon } = cfg;

  return (
    <div className="device-row">
      <div className="device-row__label">
        <span className="device-row__icon" aria-hidden="true">{icon}</span>
        {label}
      </div>
      <div className="device-row__status" style={{ color }}>
        <Icon size={14} aria-hidden="true" />
        <span role="status" aria-label={`${label}: ${text}`}>{text}</span>
      </div>
      {detail && <div className="device-row__detail">{detail}</div>}
    </div>
  );
}

function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'medium' });
}

export default function DeviceStatus() {
  const { deviceStatus, latestReading, demoMode, refreshLatest, backendOnline } = useApp();

  const arduinoStatus = demoMode ? 'demo'
    : deviceStatus?.connected ? 'connected'
    : 'disconnected';

  const backendStatus = demoMode ? 'demo'
    : backendOnline ? 'connected'
    : 'disconnected';

  const ammoniaStatus = demoMode ? 'demo'
    : latestReading?.ammonia != null ? 'ok'
    : deviceStatus?.sensor_errors?.includes('ammonia') ? 'error'
    : 'waiting';

  const dhtStatus = demoMode ? 'demo'
    : latestReading?.temperature != null ? 'ok'
    : deviceStatus?.sensor_errors?.includes('dht') ? 'error'
    : 'waiting';

  return (
    <div className="page">
      <PageHeader
        title="Device Status"
        subtitle="Hardware connection and sensor health for your AfyaNest prototype"
        action={
          <button
            className="btn btn--secondary"
            onClick={refreshLatest}
            aria-label="Refresh device status"
          >
            <RefreshCw size={14} aria-hidden="true" />
            Refresh
          </button>
        }
      />

      {demoMode && (
        <div className="demo-notice" style={{ marginBottom: '24px' }}>
          Demo mode is active. The status below reflects a simulated (non-connected) device state.
        </div>
      )}

      <div className="cards-grid cards-grid--2">
        {/* Connection status */}
        <Card title="Connection Status">
          <StatusRow
            icon={<Usb size={16} />}
            label="Arduino (USB)"
            status={arduinoStatus}
            detail={
              arduinoStatus === 'connected'
                ? `Port: ${deviceStatus?.port ?? 'USB'} — Arduino connects via USB serial only`
                : 'Check USB cable and ensure the Arduino is powered on'
            }
          />
          <StatusRow
            icon={<Cpu size={16} />}
            label="Flask Backend"
            status={backendStatus}
            detail={
              backendStatus === 'connected'
                ? `API reachable at ${import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000'}`
                : 'Backend not responding — ensure the Flask server is running'
            }
          />
          <StatusRow
            icon={<Usb size={16} />}
            label="Serial Communication"
            status={arduinoStatus === 'connected' ? 'ok' : arduinoStatus}
            detail="9600 baud via USB — no Wi-Fi or internet required"
          />
        </Card>

        {/* Sensor health */}
        <Card title="Sensor Health">
          <StatusRow
            icon={<Wind size={16} />}
            label="MQ-137 Ammonia Sensor"
            status={ammoniaStatus}
            detail={
              ammoniaStatus === 'ok'
                ? `Latest ADC reading: ${latestReading?.ammonia}`
                : 'No reading received — check sensor wiring to Arduino'
            }
          />
          <StatusRow
            icon={<Thermometer size={16} />}
            label="DHT22 Temperature & Humidity"
            status={dhtStatus}
            detail={
              dhtStatus === 'ok'
                ? `${latestReading?.temperature} °C / ${latestReading?.humidity}%`
                : 'No reading received — check DHT22 wiring and power supply'
            }
          />
        </Card>

        {/* Timing */}
        <Card title="Data Timing">
          <StatusRow
            icon={<Clock size={16} />}
            label="Last Successful Update"
            status={latestReading ? 'ok' : 'waiting'}
            detail={formatDateTime(latestReading?.timestamp ?? deviceStatus?.last_update)}
          />
        </Card>

        {/* Latest readings snapshot */}
        <Card title="Latest Readings Snapshot">
          {!latestReading ? (
            <LoadingSpinner message="Waiting for data…" />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '8px 0' }}>
              <div className="reading-snapshot">
                <span>Ammonia (ADC)</span>
                <strong>{latestReading.ammonia ?? '—'}</strong>
              </div>
              <div className="reading-snapshot">
                <span>Temperature</span>
                <strong>{latestReading.temperature != null ? `${latestReading.temperature} °C` : '—'}</strong>
              </div>
              <div className="reading-snapshot">
                <span>Humidity</span>
                <strong>{latestReading.humidity != null ? `${latestReading.humidity}%` : '—'}</strong>
              </div>
              <div className="reading-snapshot">
                <span>Timestamp</span>
                <strong style={{ fontSize: '12px' }}>{formatDateTime(latestReading.timestamp)}</strong>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Troubleshooting */}
      {arduinoStatus !== 'connected' && !demoMode && (
        <Card title="Troubleshooting" style={{ marginTop: '24px' }}>
          <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '14px', color: '#64748B', lineHeight: '2' }}>
            <li>Ensure the Arduino Uno is plugged in via USB.</li>
            <li>Verify the correct COM port is set in the Flask backend configuration.</li>
            <li>Check that the Flask server is running: <code>python app.py</code></li>
            <li>Confirm the MQ-137 and DHT22 sensors are wired correctly to the Arduino.</li>
            <li>Check the Serial Monitor in the Arduino IDE to confirm the sketch is outputting data.</li>
            <li>Ensure no other application (Arduino IDE, etc.) is holding the serial port open.</li>
          </ul>
        </Card>
      )}
    </div>
  );
}
