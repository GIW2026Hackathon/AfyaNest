import { useState, useMemo } from 'react';
import { Search, AlertTriangle, XCircle, Info } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import StatusBadge from '../../components/StatusBadge';
import EmptyState from '../../components/EmptyState';

const SEVERITY_ICON = {
  warning: <AlertTriangle size={14} color="#EAB308" />,
  danger:  <XCircle size={14} color="#DC2626" />,
  info:    <Info size={14} color="#0077B6" />,
};

const STATUS_CFG = {
  resolved: { label: 'Resolved', color: '#16A34A', bg: '#F0FDF4', border: '#BBF7D0' },
  active:   { label: 'Active',   color: '#DC2626', bg: '#FEF2F2', border: '#FECACA' },
  pending:  { label: 'Pending',  color: '#EAB308', bg: '#FEFCE8', border: '#FDE68A' },
};

function StatusPill({ status }) {
  const c = STATUS_CFG[status] ?? STATUS_CFG.pending;
  return (
    <span style={{ padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 600,
      color: c.color, background: c.bg, border: `1px solid ${c.border}` }}>
      {c.label}
    </span>
  );
}

function fmt(iso) {
  return new Date(iso).toLocaleString('en-KE', { month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit' });
}

const FILTERS = [
  { value: 'all',      label: 'All' },
  { value: 'warning',  label: 'Warning' },
  { value: 'danger',   label: 'Danger' },
  { value: 'resolved', label: 'Resolved' },
];

export default function AlertHistory() {
  const { alerts } = useApp();
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => alerts.filter(a => {
    const matchFilter = filter === 'all' ||
      (filter === 'resolved' ? a.status === 'resolved' : a.severity === filter);
    const q = search.trim().toLowerCase();
    return matchFilter && (!q ||
      a.type?.toLowerCase().includes(q) ||
      a.message?.toLowerCase().includes(q));
  }), [alerts, filter, search]);

  return (
    <div className="page">
      <div className="alert-controls">
        <div className="tab-group" role="group" aria-label="Filter">
          {FILTERS.map(f => (
            <button key={f.value}
              className={`tab-btn ${filter === f.value ? 'tab-btn--active' : ''}`}
              onClick={() => setFilter(f.value)}
            >{f.label}</button>
          ))}
        </div>
        <div className="search-box">
          <Search size={14} className="search-box__icon" />
          <input type="search" placeholder="Search…" value={search}
            onChange={e => setSearch(e.target.value)}
            className="search-box__input" aria-label="Search alerts" />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No alerts" message="Alerts will appear here when sensor thresholds are exceeded." />
      ) : (
        <div className="table-wrapper">
          <table className="data-table" aria-label="Alert history">
            <thead>
              <tr>
                <th>Time</th>
                <th>Type</th>
                <th>Reading</th>
                <th>Severity</th>
                <th>Message</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(a => (
                <tr key={a.id} className={`data-table__row data-table__row--${a.severity}`}>
                  <td className="data-table__cell data-table__cell--time">{fmt(a.timestamp)}</td>
                  <td className="data-table__cell">
                    <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      {SEVERITY_ICON[a.severity] ?? SEVERITY_ICON.info}
                      {a.type}
                    </span>
                  </td>
                  <td className="data-table__cell data-table__cell--mono">{a.reading}</td>
                  <td className="data-table__cell">
                    <StatusBadge status={a.severity === 'danger' ? 'danger' : a.severity === 'warning' ? 'warning' : 'safe'} size="sm" />
                  </td>
                  <td className="data-table__cell data-table__cell--message">{a.message}</td>
                  <td className="data-table__cell"><StatusPill status={a.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="table-footer">{filtered.length} of {alerts.length} alerts</div>
        </div>
      )}
    </div>
  );
}
