import { Cpu, Usb, Wind, Thermometer, Clock, RefreshCw, WifiOff, CheckCircle, AlertCircle, Loader } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import Card from '../../components/Card';
import LoadingSpinner from '../../components/LoadingSpinner';

const STATUS_CFG = {
  connected:    { color: '#16A34A', text: 'Connected',    Icon: CheckCircle },
  disconnected: { color: '#DC2626', text: 'Disconnected', Icon: WifiOff },
  waiting:      { color: '#EAB308', text: 'Waiting',      Icon: Loader },
  error:        { color: '#DC2626', text: 'Error',        Icon: AlertCircle },
  ok:           { color: '#16A34A', text: 'OK',           Icon: CheckCircle },
  demo:         { color: '#EAB308', text: 'Demo',         Icon: Loader },
};

function Row({ icon, label, status, detail }) {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.waiting;
  return (
    <div className="device-row">
      <div className="device-row__label">
        <span className="device-row__icon">{icon}</span>
        {label}
      </div>
      <div className="device-row__status" style={{ color: cfg.color }}>
        <cfg.Icon size={14} />
        <span>{cfg.text}</span>
      </div>
      {detail && <div className="device-row__detail">{detail}</div>}
    </div>
  );
}

function fmt(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-KE', { dateStyle: 'short', timeStyle: 'short' });
}

export default function DeviceStatus() {
  const { deviceStatus, latestReading, demoMode, refreshLatest, backendOnline } = useApp();

  const arduinoStatus = demoMode ? 'demo' : deviceStatus?.connected ? 'connected' : 'disconnected';
  const backendStatus = demoMode ? 'demo' : backendOnline ? 'connected' : 'disconnected';
  const nh3Status     = demoMode ? 'demo' : latestReading?.ammonia != null ? 'ok' : 'waiting';
  const dhtStatus     = demoMode ? 'demo' : latestReading?.temperature != null ? 'ok' : 'waiting';

  return (
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
        <button className="btn btn--secondary" onClick={refreshLatest} aria-label="Refresh">
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div className="cards-grid cards-grid--2">
        <Card title="Connections">
          <Row icon={<Usb size={16} />}    label="Arduino (USB)"      status={arduinoStatus} detail={arduinoStatus === 'connected' ? deviceStatus?.port : 'Check USB cable'} />
          <Row icon={<Cpu size={16} />}    label="Flask Backend"      status={backendStatus} detail={backendStatus === 'connected' ? import.meta.env.VITE_API_BASE_URL : 'Start the Flask server'} />
        </Card>

        <Card title="Sensors">
          <Row icon={<Wind size={16} />}       label="MQ-137 Ammonia" status={nh3Status} detail={nh3Status === 'ok' ? `ADC: ${latestReading?.ammonia}` : 'Check wiring'} />
          <Row icon={<Thermometer size={16} />} label="DHT22 Temp/Humidity" status={dhtStatus} detail={dhtStatus === 'ok' ? `${latestReading?.temperature} °C / ${latestReading?.humidity}%` : 'Check wiring'} />
          <Row icon={<Clock size={16} />}       label="Last update"   status={latestReading ? 'ok' : 'waiting'} detail={fmt(latestReading?.timestamp)} />
        </Card>

        <Card title="Latest Readings">
          {!latestReading ? <LoadingSpinner message="Waiting…" /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '4px 0' }}>
              {[
                ['Ammonia (ADC)', latestReading.ammonia],
                ['Temperature',   latestReading.temperature != null ? `${latestReading.temperature} °C` : null],
                ['Humidity',      latestReading.humidity != null ? `${latestReading.humidity}%` : null],
                ['Updated',       fmt(latestReading.timestamp)],
              ].map(([k, v]) => (
                <div key={k} className="reading-snapshot">
                  <span>{k}</span>
                  <strong>{v ?? '—'}</strong>
                </div>
              ))}
            </div>
          )}
        </Card>

        {arduinoStatus !== 'connected' && !demoMode && (
          <Card title="Troubleshooting">
            <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '13px', color: '#64748B', lineHeight: '2' }}>
              <li>Plug in the Arduino via USB</li>
              <li>Run <code>python app.py</code></li>
              <li>Check the correct COM port in Flask config</li>
              <li>Ensure no other app has the serial port open</li>
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
