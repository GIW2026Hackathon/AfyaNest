import { useState, useEffect } from 'react';
import { Save, Info, AlertTriangle } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import PageHeader from '../../components/PageHeader';
import Card from '../../components/Card';

function FieldRow({ label, id, children, help }) {
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
  const { settings, updateSettings, demoMode, loadSettings } = useApp();
  const [form, setForm] = useState(settings);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const s = await loadSettings();
        setForm(s);
      } finally {
        setLoading(false);
      }
    })();
  }, [loadSettings]);

  function handleChange(path, value) {
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

  async function handleSave(e) {
    e.preventDefault();
    await updateSettings(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  function handleReset() {
    setForm(settings);
    setSaved(false);
  }

  return (
    <div className="page">
      <PageHeader
        title="Settings"
        subtitle="Configure thresholds, display preferences and notification options"
      />

      {demoMode && (
        <div className="demo-notice" style={{ marginBottom: '24px' }}>
          Settings saved in demo mode are stored locally and will not persist after a page reload.
        </div>
      )}

      <form onSubmit={handleSave}>
        {/* Threshold config */}
        <Card title="Ammonia Threshold Configuration" style={{ marginBottom: '24px' }}>
          <div className="settings-notice">
            <AlertTriangle size={16} color="#EAB308" aria-hidden="true" />
            <span>
              These are <strong>prototype demonstration thresholds</strong> based on raw ADC values from the
              uncalibrated MQ-137 sensor. They are not scientifically validated ammonia safety limits. Do not
              use these values to make animal welfare or occupational health decisions without proper sensor
              calibration against a reference gas standard.
            </span>
          </div>

          <FieldRow
            label="Warning threshold (ADC)"
            id="warn-threshold"
            help="Readings at or above this value will trigger a Warning status."
          >
            <input
              id="warn-threshold"
              type="number"
              min={0}
              max={1023}
              value={form.thresholds?.warning ?? 300}
              onChange={e => handleChange('thresholds.warning', Number(e.target.value))}
              className="field-input"
              aria-describedby="warn-threshold-help"
            />
          </FieldRow>

          <FieldRow
            label="Danger threshold (ADC)"
            id="danger-threshold"
            help="Readings at or above this value will trigger a Danger status."
          >
            <input
              id="danger-threshold"
              type="number"
              min={0}
              max={1023}
              value={form.thresholds?.danger ?? 400}
              onChange={e => handleChange('thresholds.danger', Number(e.target.value))}
              className="field-input"
              aria-describedby="danger-threshold-help"
            />
            {form.thresholds?.danger <= form.thresholds?.warning && (
              <p style={{ color: '#DC2626', fontSize: '12px', marginTop: '4px' }}>
                Danger threshold must be greater than the warning threshold.
              </p>
            )}
          </FieldRow>
        </Card>

        {/* Display preferences */}
        <Card title="Display Preferences" style={{ marginBottom: '24px' }}>
          <FieldRow
            label="Temperature unit"
            id="temp-unit"
            help="Choose how temperature is displayed across the dashboard."
          >
            <select
              id="temp-unit"
              value={form.temperature_unit ?? 'C'}
              onChange={e => handleChange('temperature_unit', e.target.value)}
              className="field-input"
            >
              <option value="C">Celsius (°C)</option>
              <option value="F">Fahrenheit (°F)</option>
            </select>
          </FieldRow>
        </Card>

        {/* Notifications */}
        <Card title="Notification Preferences" style={{ marginBottom: '24px' }}>
          <FieldRow label="Sound alerts" id="notif-sound">
            <label className="toggle-label">
              <input
                id="notif-sound"
                type="checkbox"
                checked={form.notifications?.sound ?? true}
                onChange={e => handleChange('notifications.sound', e.target.checked)}
                className="toggle-input"
              />
              <span className="toggle-track" aria-hidden="true" />
              <span className="toggle-text">
                {form.notifications?.sound ? 'Enabled' : 'Disabled'}
              </span>
            </label>
          </FieldRow>
          <FieldRow label="Email notifications" id="notif-email" help="Email alerts require backend configuration.">
            <label className="toggle-label">
              <input
                id="notif-email"
                type="checkbox"
                checked={form.notifications?.email ?? false}
                onChange={e => handleChange('notifications.email', e.target.checked)}
                className="toggle-input"
              />
              <span className="toggle-track" aria-hidden="true" />
              <span className="toggle-text">
                {form.notifications?.email ? 'Enabled' : 'Disabled'}
              </span>
            </label>
          </FieldRow>
        </Card>

        {/* Device info */}
        <Card title="Device Configuration Info" style={{ marginBottom: '24px' }}>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
            <Info size={18} color="#0077B6" style={{ flexShrink: 0, marginTop: '2px' }} aria-hidden="true" />
            <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', fontSize: '13px', color: '#64748B', lineHeight: '2' }}>
              <li><strong>Hardware:</strong> Arduino Uno + MQ-137 + DHT22</li>
              <li><strong>Connection:</strong> USB Serial (no Wi-Fi)</li>
              <li><strong>Backend URL:</strong> {import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000'}</li>
              <li><strong>Firmware:</strong> Prototype v1.0</li>
              <li><strong>ADC range:</strong> 0–1023 (10-bit Arduino analog input)</li>
            </ul>
          </div>
        </Card>

        {/* Actions */}
        <div className="settings-actions">
          <button
            type="button"
            className="btn btn--secondary"
            onClick={handleReset}
          >
            Reset Changes
          </button>
          <button
            type="submit"
            className="btn btn--primary"
            disabled={form.thresholds?.danger <= form.thresholds?.warning}
          >
            <Save size={14} aria-hidden="true" />
            {saved ? 'Saved!' : 'Save Settings'}
          </button>
        </div>
      </form>
    </div>
  );
}
