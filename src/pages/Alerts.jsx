import { useMemo, useState } from 'react';
import { getBookings, getPayments, getRefunds } from '../helpers/storage';
import { generateAlerts } from '../helpers/calculations';
import { useAuth } from '../AuthContext';
import { canExport, canRecordPayments, canProcessRefunds, filterBookingsForUser, filterRecordsForUser } from '../helpers/access';
import { AlertTriangle, ArrowUpDown, Download, Search, SlidersHorizontal } from 'lucide-react';

const ALERT_COLUMNS = [
  ['severity', 'Severity'],
  ['alert_type', 'Type'],
  ['pnr', 'PNR'],
  ['ticket_no', 'Ticket'],
  ['message', 'Message'],
  ['amount_at_risk', 'Amount at Risk'],
  ['days_to_event', 'Days'],
  ['action', 'Action'],
];

function money(value) {
  return `EUR ${Number(value || 0).toLocaleString()}`;
}

export default function Alerts() {
  const { user } = useAuth();
  const allowExport = canExport(user);
  const allowRecordPayment = canRecordPayments(user);
  const allowProcessRefund = canProcessRefunds(user);
  const bookings = filterBookingsForUser(user, getBookings());
  const payments = filterRecordsForUser(user, getPayments(), 'payments', { bookings });
  const refunds = filterRecordsForUser(user, getRefunds(), 'refunds', { bookings });
  const alerts = filterRecordsForUser(user, generateAlerts(bookings, payments, refunds), 'alerts', { bookings });
  const [search, setSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [showColumns, setShowColumns] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState(() => new Set(ALERT_COLUMNS.map(([key]) => key)));
  const [sortKey, setSortKey] = useState('severity');
  const [sortDir, setSortDir] = useState('asc');
  const counts = {
    CRITICAL: alerts.filter((alert) => alert.severity === 'CRITICAL').length,
    URGENT: alerts.filter((alert) => alert.severity === 'URGENT').length,
    WARNING: alerts.filter((alert) => alert.severity === 'WARNING').length,
  };

  const activeColumns = useMemo(
    () => ALERT_COLUMNS.filter(([key]) => visibleColumns.has(key)),
    [visibleColumns],
  );
  const filteredAlerts = useMemo(() => {
    const query = search.trim().toLowerCase();
    const order = { CRITICAL: 0, URGENT: 1, WARNING: 2 };
    return [...alerts]
      .filter((alert) => {
        const matchesQuery = !query || ['pnr', 'ticket_no', 'message', 'alert_type', 'severity']
          .some((key) => String(alert[key] || '').toLowerCase().includes(query));
        return matchesQuery
          && (!severityFilter || alert.severity === severityFilter)
          && (!typeFilter || alert.alert_type === typeFilter);
      })
      .sort((a, b) => {
        const result = sortKey === 'severity'
          ? (order[a.severity] ?? 99) - (order[b.severity] ?? 99)
          : typeof a[sortKey] === 'number' && typeof b[sortKey] === 'number'
            ? a[sortKey] - b[sortKey]
            : String(a[sortKey] || '').localeCompare(String(b[sortKey] || ''), undefined, { numeric: true });
        return sortDir === 'asc' ? result : -result;
      });
  }, [alerts, search, severityFilter, sortDir, sortKey, typeFilter]);
  const alertTypes = [...new Set(alerts.map((alert) => alert.alert_type))];

  const handleSort = (key) => {
    if (sortKey === key) setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const toggleColumn = (key) => {
    setVisibleColumns((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const renderValue = (alert, key) => {
    if (key === 'severity') return <span className={`badge ${alert.severity.toLowerCase()}`}>{alert.severity}</span>;
    if (key === 'alert_type') return alert.alert_type.replace(/_/g, ' ');
    if (key === 'amount_at_risk') return money(alert.amount_at_risk);
    if (key === 'message') {
      return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <AlertTriangle size={18} color={alert.severity === 'CRITICAL' ? '#FF3B30' : alert.severity === 'URGENT' ? '#FF9500' : '#B45309'} />
          {alert.message}
        </span>
      );
    }
    if (key === 'action') {
      if ((alert.ticket_no && !allowProcessRefund) || (!alert.ticket_no && !allowRecordPayment)) return '-';
      return (
        <button className="btn btn-secondary btn-sm" onClick={() => { window.location.href = alert.ticket_no ? '/refunds' : '/payments'; }}>
          {alert.ticket_no ? 'Review Refund' : 'Record Payment'}
        </button>
      );
    }
    return alert[key] || '-';
  };

  const exportCSV = () => {
    if (!allowExport) return;
    const header = activeColumns.map(([, label]) => label);
    const rows = filteredAlerts.map((alert) => activeColumns.map(([key]) => {
      if (key === 'amount_at_risk') return money(alert.amount_at_risk);
      if (key === 'action') return alert.ticket_no ? 'Review Refund' : 'Record Payment';
      return String(alert[key] || '').replace(/_/g, ' ');
    }));
    const csv = [header, ...rows].map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `alerts-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page-container fade-in">
      <header className="page-header">
        <h1>Live Alerts</h1>
        <p>Auto-generated departure and refund alerts from booking balances and processing age.</p>
      </header>

      <div className="grid-3" style={{ marginBottom: '20px' }}>
        <div className="card stat-card" style={{ border: '1px solid #FF3B30' }}>
          <div className="stat-content">
            <p className="stat-label" style={{ color: '#FF3B30' }}>Critical</p>
            <h3 className="stat-value">{counts.CRITICAL}</h3>
          </div>
        </div>
        <div className="card stat-card" style={{ border: '1px solid #FF9500' }}>
          <div className="stat-content">
            <p className="stat-label" style={{ color: '#FF9500' }}>Urgent</p>
            <h3 className="stat-value">{counts.URGENT}</h3>
          </div>
        </div>
        <div className="card stat-card" style={{ border: '1px solid #FFCC00' }}>
          <div className="stat-content">
            <p className="stat-label" style={{ color: '#B45309' }}>Warning</p>
            <h3 className="stat-value">{counts.WARNING}</h3>
          </div>
        </div>
      </div>

      <div className="card booking-controls">
        <div className="booking-filter-grid compact">
          <label>
            <span>Search</span>
            <div className="field-with-icon">
              <Search size={17} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="PNR, ticket, alert message..." />
            </div>
          </label>
          <label>
            <span>Severity</span>
            <select value={severityFilter} onChange={(event) => setSeverityFilter(event.target.value)}>
              <option value="">All severities</option>
              {['CRITICAL', 'URGENT', 'WARNING'].map((severity) => <option key={severity} value={severity}>{severity}</option>)}
            </select>
          </label>
          <label>
            <span>Type</span>
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
              <option value="">All types</option>
              {alertTypes.map((type) => <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>)}
            </select>
          </label>
        </div>
        <div className="booking-table-actions">
          <div className="table-meta">
            <span><strong>{filteredAlerts.length}</strong> of <strong>{alerts.length}</strong> alerts</span>
            <span>{activeColumns.length} visible columns</span>
          </div>
          <div className="booking-action-group">
            <button className="btn btn-secondary btn-sm" type="button" onClick={() => { setSearch(''); setSeverityFilter(''); setTypeFilter(''); }}>Reset</button>
            <button className="btn btn-secondary btn-sm" type="button" onClick={() => setShowColumns((value) => !value)}>
              <SlidersHorizontal size={15} /> Columns
            </button>
            {allowExport && (
              <button className="btn btn-primary btn-sm" type="button" onClick={exportCSV}>
                <Download size={15} /> Export
              </button>
            )}
          </div>
        </div>
        {showColumns && (
          <div className="column-panel">
            {ALERT_COLUMNS.map(([key, label]) => (
              <label key={key}>
                <input type="checkbox" checked={visibleColumns.has(key)} onChange={() => toggleColumn(key)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="card table-card">
        <div className="table-scroll">
          <table className="data-table dense-table alerts-table">
            <thead>
              <tr>
                {activeColumns.map(([key, label]) => (
                  <th key={key}>
                    <button type="button" onClick={() => handleSort(key)}>
                      {label}
                      <ArrowUpDown size={13} />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredAlerts.map((alert) => (
                <tr key={alert.id}>
                  {activeColumns.map(([key]) => <td key={key}>{renderValue(alert, key)}</td>)}
                </tr>
              ))}
              {filteredAlerts.length === 0 && (
                <tr><td className="empty-table-cell" colSpan={activeColumns.length}>No active alerts.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
