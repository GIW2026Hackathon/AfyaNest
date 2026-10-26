import { Cpu, Wind, Thermometer, Clock, RefreshCw, WifiOff, CheckCircle, AlertCircle, Loader, Server, Bird } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import Card from '../../components/Card';
import LoadingSpinner from '../../components/LoadingSpinner';
import StatusBadge from '../../components/StatusBadge';

const STATUS_CFG = {
  connected:    { color: '#16A34A', text: 'Connected',    Icon: CheckCircle },
  disconnected: { color: '#DC2626', text: 'Offline',      Icon: WifiOff     },
  waiting:      { color: '#EAB308', text: 'Waiting',      Icon: Loader      },
  error:        { color: '#DC2626', text: 'Error',        Icon: AlertCircle },
  ok:           { color: '#16A34A', text: 'OK',           Icon: CheckCircle },
  demo:         { color: '#EAB308', text: 'Demo',         Icon: Loader      },
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
  return new Date(iso).toLocaleString('en-KE', { dateStyle: 'short', timeStyle: 'medium' });
}

export default function DeviceStatus() {
  const {
    deviceStatus, latestReading, demoMode,
    refreshLatest, backendOnline, deviceId, houses,
  } = useApp();

  const backendStatus = demoMode ? 'demo' : backendOnline   ? 'connected'    : 'disconnected';
  const gatewayStatus = demoMode ? 'demo' : latestReading?.device_connected ? 'connected' : backendOnline ? 'ok' : 'disconnected';
  const nh3Status     = demoMode ? 'demo' : latestReading?.ammonia      != null ? 'ok' : 'waiting';
  const dhtStatus     = demoMode ? 'demo' : latestReading?.temperature  != null ? 'ok' : 'waiting';

  const activeHouse = houses.find(h => h.device_id === deviceId);

  return (
    <div className="page">
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
        <button className="btn btn--secondary" onClick={refreshLatest}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div className="cards-grid cards-grid--2">

        {/* Backend & gateway */}
        <Card title="System Connection">
          <Row
            icon={<Server size={16} />}
            label="AirNest Backend"
            status={backendStatus}
            detail={backendStatus === 'connected'
              ? `${import.meta.env.VITE_API_URL || 'http://localhost:8000'} · FastAPI`
              : `Run: uvicorn server.main:app --port 8000`}
          />
          <Row
            icon={<Cpu size={16} />}
            label="IoT Gateway"
            status={gatewayStatus}
            detail={gatewayStatus === 'connected' || gatewayStatus === 'ok'
              ? `Device ${deviceId ?? '—'}`
              : 'Gateway not posting — check firmware'}
          />
          {activeHouse && (
            <Row
              icon={<Bird size={16} />}
              label="Active House"
              status="ok"
              detail={`${activeHouse.name} · ${activeHouse.has_fan ? 'Has fan' : 'No fan'}`}
            />
          )}
        </Card>

        {/* Sensors */}
        <Card title="Sensor Health">
          <Row
            icon={<Wind size={16} />}
            label="Ammonia (NH3)"
            status={nh3Status}
            detail={nh3Status === 'ok'
              ? `${latestReading?.ammonia?.toFixed(1)} ppm · MQ-137 via gateway`
              : 'No reading — check sensor wiring'}
          />
          <Row
            icon={<Thermometer size={16} />}
            label="Temp & Humidity"
            status={dhtStatus}
            detail={dhtStatus === 'ok'
              ? `${latestReading?.temperature} °C / ${latestReading?.humidity}% · DHT22`
              : 'No reading — check DHT22 wiring'}
          />
          <Row
            icon={<Clock size={16} />}
            label="Last update"
            status={latestReading ? 'ok' : 'waiting'}
            detail={fmt(latestReading?.timestamp ?? deviceStatus?.last_update)}
          />
        </Card>

        {/* Latest readings snapshot */}
        <Card title="Latest Readings">
          {!latestReading ? (
            <LoadingSpinner message="Waiting for data…" />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '4px 0' }}>
              {[
                ['NH3 Ammonia', latestReading.ammonia != null ? `${latestReading.ammonia?.toFixed(1)} ppm` : null],
                ['Temperature', latestReading.temperature != null ? `${latestReading.temperature} °C` : null],
                ['Humidity',    latestReading.humidity    != null ? `${latestReading.humidity}%` : null],
                ['Updated',     fmt(latestReading.timestamp)],
              ].map(([k, v]) => (
                <div key={k} className="reading-snapshot">
                  <span>{k}</span>
                  <strong>{v ?? '—'}</strong>
                </div>
              ))}
              <div className="reading-snapshot" style={{ marginTop: '4px' }}>
                <span>Overall status</span>
                <StatusBadge status={latestReading.status ?? 'no_data'} size="sm" />
              </div>
            </div>
          )}
        </Card>

        {/* Registered houses list */}
        {houses.length > 0 && (
          <Card title={`Houses (${houses.length})`}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {houses.map(h => (
                <div key={h.device_id} className="reading-snapshot">
                  <span style={{ fontWeight: 600 }}>{h.name}</span>
                  <StatusBadge
                    status={h.level === 'danger' ? 'danger' : h.level === 'warn' || h.level === 'watch' ? 'warning' : h.level === 'ok' ? 'safe' : 'no_data'}
                    size="sm"
                  />
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Troubleshooting when offline in live mode */}
        {!demoMode && !backendOnline && (
          <Card title="Troubleshooting">
            <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '13px', color: '#64748B', lineHeight: '2.2' }}>
              <li>Start the backend: <code>cd backend && uvicorn server.main:app --port 8000</code></li>
              <li>Set <code>AIRNEST_ADMIN_KEY</code> env variable to match <code>VITE_ADMIN_KEY</code> in frontend <code>.env</code></li>
              <li>Register at least one house via <code>POST /api/v1/houses</code> or run <code>python tools/demo_feed.py</code></li>
              <li>Check CORS: backend allows <code>localhost:5173</code>, <code>5174</code>, <code>5175</code></li>
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
