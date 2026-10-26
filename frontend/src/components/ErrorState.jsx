import { AlertCircle, RefreshCw } from 'lucide-react';

/**
 * ErrorState — shown on API errors or connection failures.
 * Props:
 *   message  string
 *   onRetry  function
 */
export default function ErrorState({ message = 'Something went wrong.', onRetry }) {
  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px 24px',
        textAlign: 'center',
        gap: '12px',
      }}
    >
      <AlertCircle size={40} color="#DC2626" strokeWidth={1.4} aria-hidden="true" />
      <p style={{ margin: 0, fontWeight: 600, fontSize: '16px', color: '#172B3A' }}>Unable to load data</p>
      <p style={{ margin: 0, fontSize: '14px', color: '#64748B', maxWidth: '360px', lineHeight: '1.6' }}>{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          style={{
            marginTop: '8px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            padding: '8px 16px',
            background: '#0077B6',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <RefreshCw size={14} aria-hidden="true" />
          Retry
        </button>
      )}
    </div>
  );
}
