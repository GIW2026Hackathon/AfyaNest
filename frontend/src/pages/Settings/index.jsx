import { useState, useEffect } from 'react';
import { Save, Info } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import Card from '../../components/Card';

// NH3 thresholds from backend config (ppm)
// NH3_TARGET=15, NH3_WARN=20, NH3_DANGER=25 — see backend/airnest/config.py
const NH3_MIN = 0;
const NH3_MAX = 100;

function Field({ label, id, help, children }) {
  return (
    <div className="field-row">
      <label htmlFor={id} className="field-row__label">{label}</label>
      <div className="field-row__control">
        {children}
        {help && <p className="field-row__help">{help}</p>}
      </div>
    </div>
  );
}

export default function Settings() {
  const { settings, updateSettings, loadSettings, demoMode, backendOnline, deviceId, houses } = useApp();
  const [form, setForm]   = useState(settings);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadSettings().then(s => setForm(s)).catch(() => {});
  }, [loadSettings]);

  function set(path, value) {
    setForm(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      const keys = path.split('.');
      let obj = next;
      for (let i = 0; i < keys.length - 1; i++) obj = obj[keys[i]];
      obj[keys[keys.length - 1]] = value;
      return next;
    });
    setSaved(false);
  }

  async function save(e) {
    e.preventDefault();
    await updateSettings(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  const w = form.thresholds?.warning ?? 25;
  const d = form.thresholds?.danger  ?? 35;
  const invalid = d <= w;

  // Active house name
  const activeHouse = houses.find(h => h.device_id === deviceId);

  return (
    <div className="page">
      <form onSubmit={save}>

        {/* Ammonia alert thresholds — these are in ppm, matching the backend */}
        <Card title="Ammonia Alert Thresholds (ppm)" style={{ marginBottom: '16px' }}>
          <p style={{ fontSize: '12px', color: '#64748B', marginBottom: '16px', lineHeight: '1.6' }}>
            Backend safe limit: <strong>25 ppm</strong> (NH3_DANGER in config.py).
            Adjust these dashboard thresholds to match your flock conditions.
          </p>
          <Field label="Warning (ppm)" id="warn" help="Alert turns yellow at or above this level.">
            <input id="warn" type="number" min={NH3_MIN} max={NH3_MAX} step={0.5}
              value={w}
              onChange={e => set('thresholds.warning', parseFloat(e.target.value))}
              className="field-input" />
          </Field>
          <Field label="Danger (ppm)" id="danger" help="Alert turns red at or above this level.">
            <input id="danger" type="number" min={NH3_MIN} max={NH3_MAX} step={0.5}
              value={d}
              onChange={e => set('thresholds.danger', parseFloat(e.target.value))}
              className="field-input" />
            {invalid && <p style={{ color: '#DC2626', fontSize: '12px', marginTop: '4px' }}>Danger must be above Warning.</p>}
          </Field>
        </Card>

        {/* Display */}
        <Card title="Display" style={{ marginBottom: '16px' }}>
          <Field label="Temperature unit" id="unit">
            <select id="unit" value={form.temperature_unit ?? 'C'}
              onChange={e => set('temperature_unit', e.target.value)} className="field-input">
              <option value="C">Celsius (°C)</option>
              <option value="F">Fahrenheit (°F)</option>
            </select>
          </Field>
        </Card>

        {/* Notifications */}
        <Card title="Notifications" style={{ marginBottom: '16px' }}>
          {[
            { key: 'notifications.sound', label: 'Sound alerts', id: 'snd' },
            { key: 'notifications.email', label: 'Email alerts',  id: 'eml' },
          ].map(({ key, label, id }) => {
            const val = key.split('.').reduce((o, k) => o?.[k], form);
            return (
              <Field key={id} label={label} id={id}>
                <label className="toggle-label">
                  <input id={id} type="checkbox" checked={val ?? false}
                    onChange={e => set(key, e.target.checked)} className="toggle-input" />
                  <span className="toggle-track" />
                  <span className="toggle-text">{val ? 'On' : 'Off'}</span>
                </label>
              </Field>
            );
          })}
        </Card>

        {/* Connection info */}
        <Card title="Connection Info" style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
            <Info size={16} color="#0077B6" style={{ flexShrink: 0, marginTop: '2px' }} />
            <div style={{ fontSize: '13px', color: '#64748B', lineHeight: '2.1' }}>
              <div>
                <strong>Backend API:</strong>{' '}
                <code>{import.meta.env.VITE_API_URL || 'http://localhost:8000'}</code>
              </div>
              <div>
                <strong>API status:</strong>{' '}
                <span style={{ color: backendOnline ? '#16A34A' : '#DC2626', fontWeight: 600 }}>
                  {demoMode ? 'Demo mode' : backendOnline ? 'Connected' : 'Unreachable'}
                </span>
              </div>
              {activeHouse && (
                <div><strong>Active house:</strong> {activeHouse.name} ({deviceId})</div>
              )}
              {!demoMode && houses.length > 0 && (
                <div>
                  <strong>Registered houses:</strong>{' '}
                  {houses.map(h => h.name).join(', ')}
                </div>
              )}
              <div>
                <strong>Backend NH3 thresholds:</strong>{' '}
                warn 20 ppm · danger 25 ppm (from config.py)
              </div>
            </div>
          </div>
        </Card>

        <div className="settings-actions">
          <button type="button" className="btn btn--secondary" onClick={() => setForm(settings)}>Reset</button>
          <button type="submit" className="btn btn--primary" disabled={invalid}>
            <Save size={14} />{saved ? 'Saved!' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
}
