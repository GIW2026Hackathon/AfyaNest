import { FlaskConical, X } from 'lucide-react';
import { useApp } from '../context/AppContext';

/**
 * DemoBanner — persistent top banner shown when demo mode is active.
 * Makes it visually clear to any viewer that data is simulated.
 */
export default function DemoBanner() {
  const { demoMode, toggleDemoMode } = useApp();

  if (!demoMode) return null;

  return (
    <div
      role="banner"
      aria-label="Demo mode active"
      style={{
        background: '#023E8A',
        color: '#fff',
        padding: '8px 16px',
        fontSize: '13px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px',
        flexShrink: 0,
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <FlaskConical size={14} aria-hidden="true" />
        <strong>Demo Data</strong> — simulated sensor values. Connect the Arduino and disable demo mode to view live readings.
      </span>
      <button
        onClick={() => toggleDemoMode(false)}
        aria-label="Exit demo mode"
        style={{
          background: 'transparent',
          border: '1px solid rgba(255,255,255,0.4)',
          color: '#fff',
          borderRadius: '4px',
          padding: '2px 10px',
          fontSize: '12px',
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        Exit Demo
      </button>
    </div>
  );
}
