import { FlaskConical } from 'lucide-react';
import { useApp } from '../context/AppContext';

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
        padding: '7px 16px',
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
        <strong>Demo Data</strong> — Start the backend (<code style={{ background: 'rgba(255,255,255,0.15)', padding: '1px 6px', borderRadius: '3px' }}>uvicorn server.main:app --port 8000</code>) then exit demo to view live data.
      </span>
      <button
        onClick={() => toggleDemoMode(false)}
        aria-label="Exit demo mode"
        style={{
          background: 'transparent',
          border: '1px solid rgba(255,255,255,0.4)',
          color: '#fff',
          borderRadius: '4px',
          padding: '2px 12px',
          fontSize: '12px',
          fontWeight: 600,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
        }}
      >
        Exit Demo
      </button>
    </div>
  );
}
