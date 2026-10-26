import { Inbox } from 'lucide-react';

/**
 * EmptyState — shown when a data set is empty or not yet collected.
 * Props:
 *   icon     ReactNode (defaults to Inbox)
 *   title    string
 *   message  string
 *   action   ReactNode  (optional CTA button)
 */
export default function EmptyState({
  icon,
  title = 'No data available',
  message = 'Data will appear here once the system starts collecting readings.',
  action,
}) {
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '48px 24px',
        textAlign: 'center',
        color: '#64748B',
        gap: '12px',
      }}
    >
      <span style={{ color: '#D9E5EC' }} aria-hidden="true">
        {icon ?? <Inbox size={48} strokeWidth={1.2} />}
      </span>
      <p style={{ margin: 0, fontWeight: 600, fontSize: '16px', color: '#172B3A' }}>{title}</p>
      <p style={{ margin: 0, fontSize: '14px', maxWidth: '400px', lineHeight: '1.6' }}>{message}</p>
      {action && <div style={{ marginTop: '8px' }}>{action}</div>}
    </div>
  );
}
