import { AlertTriangle, CheckCircle, XCircle, HelpCircle } from 'lucide-react';

const CONFIG = {
  safe:    { label: 'Safe',    color: '#16A34A', bg: '#F0FDF4', border: '#BBF7D0', Icon: CheckCircle },
  warning: { label: 'Warning', color: '#EAB308', bg: '#FEFCE8', border: '#FDE68A', Icon: AlertTriangle },
  danger:  { label: 'Danger',  color: '#DC2626', bg: '#FEF2F2', border: '#FECACA', Icon: XCircle },
  no_data: { label: 'No Data', color: '#64748B', bg: '#F8FAFC', border: '#E2E8F0', Icon: HelpCircle },
};

/**
 * StatusBadge — shows Safe / Warning / Danger / No Data
 * @param {string}  status   'safe' | 'warning' | 'danger' | 'no_data'
 * @param {string}  size     'sm' | 'md' | 'lg'
 */
export default function StatusBadge({ status = 'no_data', size = 'md' }) {
  const cfg = CONFIG[status] ?? CONFIG.no_data;
  const { label, color, bg, border, Icon } = cfg;

  const padding   = size === 'sm' ? '2px 8px'  : size === 'lg' ? '6px 14px' : '4px 10px';
  const fontSize  = size === 'sm' ? '11px'      : size === 'lg' ? '14px'     : '12px';
  const iconSize  = size === 'sm' ? 12           : size === 'lg' ? 16          : 14;

  return (
    <span
      role="status"
      aria-label={`Status: ${label}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding,
        fontSize,
        fontWeight: 600,
        color,
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: '6px',
        whiteSpace: 'nowrap',
        letterSpacing: '0.02em',
      }}
    >
      <Icon size={iconSize} aria-hidden="true" />
      {label}
    </span>
  );
}
