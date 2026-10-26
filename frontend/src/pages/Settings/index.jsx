import { useState, useEffect } from 'react';
import { Save } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import Card from '../../components/Card';

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
  const { settings, updateSettings, loadSettings } = useApp();
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

  const invalid = (form.thresholds?.danger ?? 400) <= (form.thresholds?.warning ?? 300);

  return (
    <div className="page">
      <form onSubmit={save}>

        {/* Thresholds */}
        <Card title="Ammonia Thresholds (ADC)" style={{ marginBottom: '16px' }}>
          <p style={{ fontSize: '12px', color: '#64748B', marginBottom: '16px', lineHeight: '1.5' }}>
            Raw ADC values — not calibrated ppm. Adjust based on your sensor baseline.
          </p>
          <Field label="Warning" id="warn" help="Status turns yellow at this value.">
            <input id="warn" type="number" min={0} max={1023}
              value={form.thresholds?.warning ?? 300}
              onChange={e => set('thresholds.warning', Number(e.target.value))}
              className="field-input" />
          </Field>
          <Field label="Danger" id="danger" help="Status turns red at this value.">
            <input id="danger" type="number" min={0} max={1023}
              value={form.thresholds?.danger ?? 400}
              onChange={e => set('thresholds.danger', Number(e.target.value))}
              className="field-input" />
            {invalid && <p style={{ color: '#DC2626', fontSize: '12px', marginTop: '4px' }}>Danger must be above Warning.</p>}
          </Field>
        </Card>

        {/* Display */}
        <Card title="Display" style={{ marginBottom: '16px' }}>
          <Field label="Temperature unit" id="unit">
            <select id="unit" value={form.temperature_unit ?? 'C'}
              onChange={e => set('temperature_unit', e.target.value)} className="field-input">
              <option value="C">°C</option>
              <option value="F">°F</option>
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

        {/* Device info */}
        <Card title="Device Info" style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '13px', color: '#64748B', lineHeight: '2' }}>
            <div><strong>Hardware:</strong> Arduino Uno · MQ-137 · DHT22</div>
            <div><strong>Connection:</strong> USB Serial</div>
            <div><strong>Backend:</strong> {import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000'}</div>
            <div><strong>ADC range:</strong> 0 – 1023</div>
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
