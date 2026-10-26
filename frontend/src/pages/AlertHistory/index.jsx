import { useState, useMemo } from 'react';
import { Search, AlertTriangle, XCircle, CheckCircle, Info, FlaskConical } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import StatusBadge from '../../components/StatusBadge';
import EmptyState from '../../components/EmptyState';
import PageHeader from '../../components/PageHeader';

const SEVERITY_ICON = {
  warning: <AlertTriangle size={15} color="#EAB308" aria-hidden="true" />,
  danger:  <XCircle size={15} color="#DC2626" aria-hidden="true" />,
  info:    <Info size={15} color="#0077B6" aria-hidden="true" />,
};

const STATUS_BADGE = {
  resolved:  { label: 'Resolved',  color: '#16A34A', bg: '#F0FDF4', border: '#BBF7D0' },
  active:    { label: 'Active',    color: '#DC2626', bg: '#FEF2F2', border: '#FECACA' },
  pending:   { label: 'Pending',   color: '#EAB308', bg: '#FEFCE8', border: '#FDE68A' },
};

function AlertStatusPill({ status }) {
  const cfg = STATUS_BADGE[status] ?? STATUS_BADGE.pending;
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: '6px', fontSize: '11px',
      fontWeight: 600, color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.border}`,
    }}>
      {cfg.label}
    </span>
  );
}

function formatDateTime(iso) {
  return new Date(iso).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' });
}

const FILTERS = [
  { value: 'all',      label: 'All Alerts' },
  { value: 'warning',  label: 'Warning' },
  { value: 'danger',   label: 'Danger' },
  { value: 'resolved', label: 'Resolved' },
];

export default function AlertHistory() {
  const { alerts, demoMode } = useApp();
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    return alerts.filter(a => {
      const matchFilter =
        filter === 'all' ||
        (filter === 'resolved' ? a.status === 'resolved' : a.severity === filter);
      const q = search.trim().toLowerCase();
      const matchSearch = !q ||
        a.type?.toLowerCase().includes(q) ||
        a.message?.toLowerCase().includes(q) ||
        a.reading?.toLowerCase().includes(q);
      return matchFilter && matchSearch;
    });
  }, [alerts, filter, search]);

  return (
    <div className="page">
      <PageHeader
        title="Alert History"
        subtitle="A log of all environmental alerts detected by the monitoring system"
      />

      {demoMode && (
        <div className="demo-notice">
          <FlaskConical size={14} aria-hidden="true" />
          These are demonstration alerts — not real sensor events from your hardware.
        </div>
      )}

      {/* Controls */}
      <div className="alert-controls">
        <div className="tab-group" role="group" aria-label="Filter alerts">
          {FILTERS.map(f => (
            <button
              key={f.value}
              className={`tab-btn ${filter === f.value ? 'tab-btn--active' : ''}`}
              onClick={() => setFilter(f.value)}
              aria-pressed={filter === f.value}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="search-box">
          <Search size={14} aria-hidden="true" className="search-box__icon" />
          <input
            type="search"
            placeholder="Search alerts…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="search-box__input"
            aria-label="Search alerts"
          />
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <EmptyState
          title="No alerts found"
          message={
            search || filter !== 'all'
              ? 'No alerts match your current filter or search. Try changing the criteria.'
              : 'No alerts have been recorded yet. The system will log events here as they occur.'
          }
        />
      ) : (
        <div className="table-wrapper">
          <table className="data-table" aria-label="Alert history">
            <thead>
              <tr>
                <th scope="col">Timestamp</th>
                <th scope="col">Alert Type</th>
                <th scope="col">Reading</th>
                <th scope="col">Severity</th>
                <th scope="col">Message</th>
                <th scope="col">Status</th>
                {demoMode && <th scope="col">Source</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map(alert => (
                <tr key={alert.id} className={`data-table__row data-table__row--${alert.severity}`}>
                  <td className="data-table__cell data-table__cell--time">
                    {formatDateTime(alert.timestamp)}
                  </td>
                  <td className="data-table__cell">
                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {SEVERITY_ICON[alert.severity] ?? SEVERITY_ICON.info}
                      {alert.type}
                    </span>
                  </td>
                  <td className="data-table__cell data-table__cell--mono">{alert.reading}</td>
                  <td className="data-table__cell">
                    <StatusBadge
                      status={alert.severity === 'danger' ? 'danger' : alert.severity === 'warning' ? 'warning' : 'safe'}
                      size="sm"
                    />
                  </td>
                  <td className="data-table__cell data-table__cell--message">{alert.message}</td>
                  <td className="data-table__cell">
                    <AlertStatusPill status={alert.status} />
                  </td>
                  {demoMode && (
                    <td className="data-table__cell">
                      {alert._demo ? (
                        <span style={{ fontSize: '11px', color: '#64748B', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <FlaskConical size={11} /> Demo
                        </span>
                      ) : 'Live'}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="table-footer">
            Showing {filtered.length} of {alerts.length} alert{alerts.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}
    </div>
  );
}
