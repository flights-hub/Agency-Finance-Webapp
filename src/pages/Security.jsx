import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, Ban, Download, FileSearch, Globe, LaptopMinimal,
  LogIn, MonitorSmartphone, RefreshCcw, Search, ShieldAlert, ShieldCheck, UserX,
} from 'lucide-react';
import { api } from '../helpers/api';
import { downloadCSV } from '../helpers/downloadCSV';
import { ROLE_OPTIONS } from '../helpers/permissions';
import { useAuth } from '../AuthContext';

const TABS = [
  { key: 'overview', label: 'Overview', icon: Activity },
  { key: 'logins', label: 'Login History', icon: LogIn },
  { key: 'sessions', label: 'Active Sessions', icon: MonitorSmartphone },
  { key: 'audit', label: 'Audit Trail', icon: FileSearch },
  { key: 'alerts', label: 'Alerts', icon: ShieldAlert },
  { key: 'investigate', label: 'Investigate', icon: Search },
];

const RISK_BADGE = { low: 'badge-neutral', medium: 'badge-info', high: 'badge-warn', critical: 'badge-fail' };
const STATUS_BADGE = {
  SUCCESS: 'badge-pass', FAILED: 'badge-fail', BLOCKED: 'badge-fail', EXPIRED: 'badge-warn', MFA_FAILED: 'badge-fail',
  ACTIVE: 'badge-pass', REVOKED: 'badge-fail',
  OPEN: 'badge-fail', UNDER_REVIEW: 'badge-warn', RESOLVED: 'badge-pass', FALSE_POSITIVE: 'badge-neutral',
};

function formatDate(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function formatDuration(seconds) {
  if (seconds == null) return '-';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function Badge({ value, map = STATUS_BADGE }) {
  if (!value) return <span className="badge badge-neutral">-</span>;
  return <span className={`badge ${map[value] || 'badge-neutral'}`}>{String(value).replace(/_/g, ' ')}</span>;
}

function RiskBadge({ value }) {
  return <Badge value={value} map={RISK_BADGE} />;
}

export default function Security() {
  const { user } = useAuth();
  const [tab, setTab] = useState('overview');
  const [message, setMessage] = useState('');

  return (
    <div className="page-container fade-in">
      <div className="page-header">
        <div>
          <p className="page-kicker">Security &amp; Compliance</p>
          <h1>Security Center</h1>
          <p>Login history, audit trail, live sessions, and suspicious-activity monitoring.</p>
        </div>
      </div>

      <div className="preset-group" role="tablist" style={{ marginBottom: 16 }}>
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`preset-pill ${tab === item.key ? 'active' : ''}`}
            onClick={() => { setTab(item.key); setMessage(''); }}
          >
            <item.icon size={14} /> {item.label}
          </button>
        ))}
      </div>

      {message && <div className="notice">{message}</div>}

      {tab === 'overview' && <OverviewTab />}
      {tab === 'logins' && <LoginHistoryTab setMessage={setMessage} />}
      {tab === 'sessions' && <SessionsTab currentUser={user} setMessage={setMessage} />}
      {tab === 'audit' && <AuditTrailTab setMessage={setMessage} />}
      {tab === 'alerts' && <AlertsTab currentUser={user} setMessage={setMessage} />}
      {tab === 'investigate' && <InvestigateTab setMessage={setMessage} />}
    </div>
  );
}

function OverviewTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.securityOverview().then(setData).catch((err) => setError(err.message));
  }, []);

  if (error) return <div className="notice">{error}</div>;
  if (!data) return <div className="empty-state"><h5>Loading security overview…</h5></div>;

  const stats = [
    { label: 'Successful logins today', value: data.login.success, icon: ShieldCheck },
    { label: 'Failed attempts today', value: data.login.failed, icon: Ban },
    { label: 'Blocked attempts today', value: data.login.blocked, icon: UserX },
    { label: 'Admin logins today', value: data.login.admin, icon: LogIn },
    { label: 'New device logins', value: data.login.newDevice, icon: LaptopMinimal },
    { label: 'New location logins', value: data.login.newLocation, icon: Globe },
    { label: 'Open security alerts', value: data.risk.openAlerts, icon: ShieldAlert },
    { label: 'Critical open alerts', value: data.risk.criticalAlerts, icon: AlertTriangle },
    { label: 'High-risk events (7d)', value: data.risk.highRiskEvents7d, icon: Activity },
    { label: 'Active sessions', value: data.sessions.active, icon: MonitorSmartphone },
  ];

  return (
    <>
      <div className="metric-grid">
        {stats.map((stat) => (
          <div className="stat-card" key={stat.label}>
            <div className="stat-icon"><stat.icon size={18} /></div>
            <div className="stat-content">
              <span className="stat-value">{stat.value}</span>
              <span className="stat-label">{stat.label}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="grid-2" style={{ marginTop: 16 }}>
        <div className="table-card">
          <div className="section-head"><h3>Users with repeated failed logins today</h3></div>
          {data.risk.repeatedFailureUsers.length === 0
            ? <div className="empty-state"><p>No repeated failures today.</p></div>
            : (
              <table className="data-table">
                <thead><tr><th>User</th><th>Failed attempts</th></tr></thead>
                <tbody>
                  {data.risk.repeatedFailureUsers.map((row) => (
                    <tr key={row.username}><td>{row.username}</td><td><span className="badge badge-fail">{row.count}</span></td></tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
        <div className="table-card">
          <div className="section-head"><h3>Suspicious IP addresses today</h3></div>
          {data.risk.suspiciousIps.length === 0
            ? <div className="empty-state"><p>No suspicious IPs today.</p></div>
            : (
              <table className="data-table">
                <thead><tr><th>IP address</th><th>Failed attempts</th></tr></thead>
                <tbody>
                  {data.risk.suspiciousIps.map((row) => (
                    <tr key={row.ip}><td>{row.ip}</td><td><span className="badge badge-fail">{row.count}</span></td></tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
      </div>
    </>
  );
}

const LOGIN_FILTERS = { from: '', to: '', user: '', role: '', status: '', ip: '', country: '', city: '', device: '', risk: '' };

function FilterBar({ filters, setFilters, onApply, children }) {
  return (
    <div className="booking-filter-grid" style={{ marginBottom: 12 }}>
      <label>From<input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} /></label>
      <label>To<input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} /></label>
      <label>User<input placeholder="email or name" value={filters.user} onChange={(e) => setFilters({ ...filters, user: e.target.value })} /></label>
      {children}
      <label style={{ alignSelf: 'end' }}>
        <button className="btn btn-primary btn-sm" type="button" onClick={onApply}>Apply filters</button>
      </label>
    </div>
  );
}

function useFetcher(fetcher) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async (params) => {
    setLoading(true);
    try {
      const data = await fetcher(params);
      setRows(data.rows || data.sessions || []);
      return data;
    } finally {
      setLoading(false);
    }
  }, [fetcher]);
  return { rows, loading, load };
}

function cleanParams(filters) {
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
}

function LoginHistoryTab({ setMessage }) {
  const [filters, setFilters] = useState(LOGIN_FILTERS);
  const { rows, loading, load } = useFetcher(api.securityLoginHistory);

  useEffect(() => { load({}).catch((err) => setMessage(err.message)); }, [load, setMessage]);

  const applyFilters = () => load(cleanParams(filters)).catch((err) => setMessage(err.message));

  const exportCsv = async () => {
    try {
      const data = await api.securityLoginHistory({ ...cleanParams(filters), export: '1' });
      downloadCSV('login-history', [
        ['login_time', 'Login time'], ['logout_time', 'Logout time'], ['session_duration', 'Duration (s)'],
        ['username', 'User'], ['role', 'Role'], ['login_status', 'Status'], ['failure_reason', 'Failure reason'],
        ['ip_address', 'IP'], ['country', 'Country'], ['region', 'Region'], ['city', 'City'], ['isp', 'ISP'],
        ['device_type', 'Device'], ['operating_system', 'OS'], ['browser', 'Browser'], ['browser_version', 'Version'],
        ['is_new_device', 'New device'], ['is_new_location', 'New location'], ['vpn_proxy_tor_status', 'VPN/Proxy'],
        ['risk_score', 'Risk'],
      ], data.rows || []);
    } catch (err) {
      setMessage(err.message);
    }
  };

  return (
    <div className="table-card">
      <div className="section-head">
        <h3>Login history</h3>
        <button className="btn btn-secondary btn-sm" type="button" onClick={exportCsv}><Download size={14} /> Export CSV</button>
      </div>
      <FilterBar filters={filters} setFilters={setFilters} onApply={applyFilters}>
        <label>Role
          <select value={filters.role} onChange={(e) => setFilters({ ...filters, role: e.target.value })}>
            <option value="">All roles</option>
            {ROLE_OPTIONS.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
          </select>
        </label>
        <label>Status
          <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
            <option value="">All</option>
            {['SUCCESS', 'FAILED', 'BLOCKED', 'EXPIRED'].map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </label>
        <label>IP<input value={filters.ip} onChange={(e) => setFilters({ ...filters, ip: e.target.value })} /></label>
        <label>Country<input value={filters.country} onChange={(e) => setFilters({ ...filters, country: e.target.value })} /></label>
        <label>City<input value={filters.city} onChange={(e) => setFilters({ ...filters, city: e.target.value })} /></label>
        <label>Device
          <select value={filters.device} onChange={(e) => setFilters({ ...filters, device: e.target.value })}>
            <option value="">All</option>
            {['desktop', 'mobile', 'tablet'].map((device) => <option key={device} value={device}>{device}</option>)}
          </select>
        </label>
        <label>Risk
          <select value={filters.risk} onChange={(e) => setFilters({ ...filters, risk: e.target.value })}>
            <option value="">All</option>
            {['low', 'medium', 'high', 'critical'].map((risk) => <option key={risk} value={risk}>{risk}</option>)}
          </select>
        </label>
      </FilterBar>
      <div className="table-scroll">
        <table className="data-table dense-table">
          <thead>
            <tr>
              <th>Time</th><th>User</th><th>Role</th><th>Status</th><th>IP</th><th>Location</th>
              <th>Device</th><th>Browser</th><th>New device</th><th>New location</th><th>VPN/Proxy</th><th>Duration</th><th>Risk</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={13} className="empty-table-cell">Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={13} className="empty-table-cell">No login records match the filters.</td></tr>}
            {!loading && rows.map((row) => (
              <tr key={row.id}>
                <td>{formatDate(row.login_time)}</td>
                <td>{row.username || '-'}</td>
                <td>{row.role || '-'}</td>
                <td><Badge value={row.login_status} />{row.failure_reason ? <small className="muted"> {row.failure_reason.replace(/_/g, ' ')}</small> : null}</td>
                <td>{row.ip_address || '-'}</td>
                <td>{[row.city, row.country].filter(Boolean).join(', ') || '-'}</td>
                <td>{row.device_type} / {row.operating_system}</td>
                <td>{row.browser} {row.browser_version}</td>
                <td>{row.is_new_device ? <span className="badge badge-warn">yes</span> : 'no'}</td>
                <td>{row.is_new_location ? <span className="badge badge-warn">yes</span> : 'no'}</td>
                <td>{row.vpn_proxy_tor_status || '-'}</td>
                <td>{formatDuration(row.session_duration)}</td>
                <td><RiskBadge value={row.risk_score} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SessionsTab({ currentUser, setMessage }) {
  const { rows, loading, load } = useFetcher(api.securitySessions);
  const isAdmin = currentUser?.role === 'ADMIN';

  const reload = useCallback(() => load().catch((err) => setMessage(err.message)), [load, setMessage]);
  useEffect(() => { reload(); }, [reload]);

  const revoke = async (session) => {
    if (!window.confirm(`Force logout ${session.email || session.user_id}?`)) return;
    try {
      await api.revokeSecuritySession(session.id);
      setMessage('Session revoked.');
      reload();
    } catch (err) { setMessage(err.message); }
  };

  const revokeUser = async (session) => {
    if (!window.confirm(`Force logout ALL sessions of ${session.email || session.user_id}?`)) return;
    try {
      const data = await api.revokeUserSecuritySessions(session.user_id);
      setMessage(`Revoked ${data.revoked} session(s).`);
      reload();
    } catch (err) { setMessage(err.message); }
  };

  const revokeAll = async () => {
    if (!window.confirm('EMERGENCY: force logout every user (except you)? This is logged as a critical event.')) return;
    try {
      const data = await api.revokeAllSecuritySessions();
      setMessage(`Emergency logout complete — ${data.revoked} session(s) revoked.`);
      reload();
    } catch (err) { setMessage(err.message); }
  };

  return (
    <div className="table-card">
      <div className="section-head">
        <h3>Active sessions</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary btn-sm" type="button" onClick={reload}><RefreshCcw size={14} /> Refresh</button>
          {isAdmin && (
            <button className="btn btn-coral btn-sm" type="button" onClick={revokeAll}><Ban size={14} /> Emergency logout all</button>
          )}
        </div>
      </div>
      <div className="table-scroll">
        <table className="data-table dense-table">
          <thead>
            <tr>
              <th>User</th><th>Role</th><th>IP</th><th>Location</th><th>Device</th><th>Browser</th>
              <th>Login time</th><th>Last activity</th><th>Status</th>{isAdmin && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={10} className="empty-table-cell">Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={10} className="empty-table-cell">No active sessions.</td></tr>}
            {!loading && rows.map((session) => (
              <tr key={session.id}>
                <td>{session.name || session.email || session.user_id}</td>
                <td>{session.role || '-'}</td>
                <td>{session.ip_address || '-'}</td>
                <td>{[session.city, session.country].filter(Boolean).join(', ') || '-'}</td>
                <td>{session.device || '-'}</td>
                <td>{session.browser || '-'}</td>
                <td>{formatDate(session.login_time)}</td>
                <td>{formatDate(session.last_activity)}</td>
                <td><Badge value={session.status} /></td>
                {isAdmin && (
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn btn-ghost btn-sm" type="button" onClick={() => revoke(session)}>Logout</button>
                      <button className="btn btn-ghost btn-sm" type="button" onClick={() => revokeUser(session)}>Logout all</button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const AUDIT_FILTERS = { from: '', to: '', user: '', role: '', module: '', risk: '', action: '' };

function AuditTrailTab({ setMessage }) {
  const [filters, setFilters] = useState(AUDIT_FILTERS);
  const { rows, loading, load } = useFetcher(api.securityAuditTrail);

  useEffect(() => { load({}).catch((err) => setMessage(err.message)); }, [load, setMessage]);

  const applyFilters = () => load(cleanParams(filters)).catch((err) => setMessage(err.message));

  const exportCsv = async () => {
    try {
      const data = await api.securityAuditTrail({ ...cleanParams(filters), export: '1' });
      downloadCSV('audit-trail', [
        ['created_at', 'Time'], ['username', 'User'], ['role', 'Role'], ['module_name', 'Module'],
        ['action', 'Action'], ['record_type', 'Record type'], ['record_id', 'Record id'],
        ['ip_address', 'IP'], ['country', 'Country'], ['city', 'City'], ['device', 'Device'], ['browser', 'Browser'],
        ['result', 'Result'], ['risk_level', 'Risk'], ['remarks', 'Remarks'],
      ], data.rows || []);
    } catch (err) { setMessage(err.message); }
  };

  return (
    <div className="table-card">
      <div className="section-head">
        <h3>Admin activity audit trail</h3>
        <button className="btn btn-secondary btn-sm" type="button" onClick={exportCsv}><Download size={14} /> Export CSV</button>
      </div>
      <FilterBar filters={filters} setFilters={setFilters} onApply={applyFilters}>
        <label>Role
          <select value={filters.role} onChange={(e) => setFilters({ ...filters, role: e.target.value })}>
            <option value="">All roles</option>
            {ROLE_OPTIONS.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
          </select>
        </label>
        <label>Module
          <select value={filters.module} onChange={(e) => setFilters({ ...filters, module: e.target.value })}>
            <option value="">All</option>
            {['auth', 'user_management', 'finance', 'security', 'reports', 'general'].map((module) => (
              <option key={module} value={module}>{module.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </label>
        <label>Action<input placeholder="e.g. reset_password" value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })} /></label>
        <label>Risk
          <select value={filters.risk} onChange={(e) => setFilters({ ...filters, risk: e.target.value })}>
            <option value="">All</option>
            {['low', 'medium', 'high', 'critical'].map((risk) => <option key={risk} value={risk}>{risk}</option>)}
          </select>
        </label>
      </FilterBar>
      <div className="table-scroll">
        <table className="data-table dense-table">
          <thead>
            <tr><th>Time</th><th>User</th><th>Role</th><th>Module</th><th>Action</th><th>Record</th><th>Change</th><th>IP</th><th>Result</th><th>Risk</th></tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={10} className="empty-table-cell">Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={10} className="empty-table-cell">No audit events match the filters.</td></tr>}
            {!loading && rows.map((row) => (
              <tr key={row.id}>
                <td>{formatDate(row.created_at)}</td>
                <td>{row.username || row.actor_id || '-'}</td>
                <td>{row.role || '-'}</td>
                <td>{(row.module_name || 'general').replace(/_/g, ' ')}</td>
                <td>{String(row.action || '').replace(/_/g, ' ')}</td>
                <td>{row.record_type ? `${row.record_type}${row.record_id ? ` · ${String(row.record_id).slice(0, 12)}` : ''}` : '-'}</td>
                <td style={{ maxWidth: 260 }}>
                  {row.remarks || (row.new_value ? <small className="muted">{JSON.stringify(row.new_value).slice(0, 120)}</small> : '-')}
                </td>
                <td>{row.ip_address || '-'}</td>
                <td><span className={`badge ${row.result === 'success' ? 'badge-pass' : 'badge-fail'}`}>{row.result || 'success'}</span></td>
                <td><RiskBadge value={row.risk_level} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AlertsTab({ currentUser, setMessage }) {
  const [statusFilter, setStatusFilter] = useState('');
  const { rows, loading, load } = useFetcher(api.securityAlerts);
  const isAdmin = currentUser?.role === 'ADMIN';

  const reload = useCallback((status) => (
    load(status ? { status } : {}).catch((err) => setMessage(err.message))
  ), [load, setMessage]);

  useEffect(() => { reload(statusFilter); }, [reload, statusFilter]);

  const updateAlert = async (alert, status) => {
    const notes = status === 'RESOLVED' || status === 'FALSE_POSITIVE'
      ? window.prompt('Resolution notes:', alert.resolution_notes || '')
      : alert.resolution_notes;
    if (notes === null) return;
    try {
      await api.updateSecurityAlert(alert.id, { status, resolution_notes: notes });
      reload(statusFilter);
    } catch (err) { setMessage(err.message); }
  };

  return (
    <div className="table-card">
      <div className="section-head">
        <h3>Security alerts</h3>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {['OPEN', 'UNDER_REVIEW', 'RESOLVED', 'FALSE_POSITIVE'].map((status) => (
            <option key={status} value={status}>{status.replace(/_/g, ' ')}</option>
          ))}
        </select>
      </div>
      <div className="table-scroll">
        <table className="data-table dense-table">
          <thead>
            <tr><th>Time</th><th>Type</th><th>User</th><th>Trigger</th><th>IP</th><th>Location</th><th>Risk</th><th>Status</th>{isAdmin && <th>Actions</th>}</tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={9} className="empty-table-cell">Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={9} className="empty-table-cell">No alerts.</td></tr>}
            {!loading && rows.map((alert) => (
              <tr key={alert.id}>
                <td>{formatDate(alert.alert_time)}</td>
                <td>{String(alert.alert_type || '').replace(/_/g, ' ')}</td>
                <td>{alert.username || '-'}</td>
                <td style={{ maxWidth: 320 }}>{alert.trigger_reason}{alert.resolution_notes ? <small className="muted"> — {alert.resolution_notes}</small> : null}</td>
                <td>{alert.ip_address || '-'}</td>
                <td>{[alert.city, alert.country].filter(Boolean).join(', ') || '-'}</td>
                <td><RiskBadge value={alert.risk_level} /></td>
                <td><Badge value={alert.status} /></td>
                {isAdmin && (
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {alert.status === 'OPEN' && <button className="btn btn-ghost btn-sm" type="button" onClick={() => updateAlert(alert, 'UNDER_REVIEW')}>Review</button>}
                      {alert.status !== 'RESOLVED' && <button className="btn btn-ghost btn-sm" type="button" onClick={() => updateAlert(alert, 'RESOLVED')}>Resolve</button>}
                      {alert.status !== 'FALSE_POSITIVE' && <button className="btn btn-ghost btn-sm" type="button" onClick={() => updateAlert(alert, 'FALSE_POSITIVE')}>False +</button>}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InvestigateTab({ setMessage }) {
  const [query, setQuery] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  const timeline = useMemo(() => {
    if (!data) return [];
    const events = [
      ...data.logins.map((row) => ({
        time: row.login_time,
        kind: row.login_status === 'SUCCESS' ? 'Login' : `Login ${row.login_status.toLowerCase()}`,
        detail: `${row.ip_address || 'unknown IP'} · ${[row.city, row.country].filter(Boolean).join(', ') || 'unknown location'} · ${row.browser || ''} ${row.operating_system || ''}${row.failure_reason ? ` · ${row.failure_reason}` : ''}`,
        risk: row.risk_score,
      })),
      ...data.actions.map((row) => ({
        time: row.created_at,
        kind: `Action: ${String(row.action || '').replace(/_/g, ' ')}`,
        detail: row.remarks || [row.module_name, row.record_type, row.record_id].filter(Boolean).join(' · ') || '-',
        risk: row.risk_level,
      })),
      ...data.alerts.map((row) => ({
        time: row.alert_time,
        kind: `Alert: ${String(row.alert_type || '').replace(/_/g, ' ')}`,
        detail: row.trigger_reason,
        risk: row.risk_level,
      })),
    ];
    return events.sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, 500);
  }, [data]);

  const run = async (event) => {
    event.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setMessage('');
    try {
      setData(await api.securityTimeline(query.trim()));
    } catch (err) {
      setData(null);
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  };

  const exportTimeline = () => {
    downloadCSV(`security-timeline-${data.profile.email}`, [
      ['time', 'Time'], ['kind', 'Event'], ['detail', 'Detail'], ['risk', 'Risk'],
    ], timeline);
  };

  return (
    <>
      <div className="table-card" style={{ marginBottom: 16 }}>
        <div className="section-head"><h3>Incident investigation</h3></div>
        <form onSubmit={run} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            style={{ flex: 1, minWidth: 240 }}
            placeholder="Search a user by email or name to build their full security timeline…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="btn btn-primary btn-sm" type="submit" disabled={loading}>
            <Search size={14} /> {loading ? 'Building timeline…' : 'Generate timeline'}
          </button>
          {data && <button className="btn btn-secondary btn-sm" type="button" onClick={exportTimeline}><Download size={14} /> Export</button>}
        </form>
      </div>

      {data && (
        <>
          <div className="metric-grid" style={{ marginBottom: 16 }}>
            <div className="stat-card"><div className="stat-content"><span className="stat-value">{data.profile.email}</span><span className="stat-label">{data.profile.role} · {data.profile.status} · last login {formatDate(data.profile.last_login)}</span></div></div>
            <div className="stat-card"><div className="stat-content"><span className="stat-value">{data.logins.length}</span><span className="stat-label">Login attempts (last 500)</span></div></div>
            <div className="stat-card"><div className="stat-content"><span className="stat-value">{data.actions.length}</span><span className="stat-label">Actions recorded</span></div></div>
            <div className="stat-card"><div className="stat-content"><span className="stat-value">{data.alerts.length}</span><span className="stat-label">Security alerts</span></div></div>
          </div>

          <div className="table-card">
            <div className="section-head"><h3>Full security timeline — {data.profile.name || data.profile.email}</h3></div>
            <div className="table-scroll">
              <table className="data-table dense-table">
                <thead><tr><th>Time</th><th>Event</th><th>Details</th><th>Risk</th></tr></thead>
                <tbody>
                  {timeline.length === 0 && <tr><td colSpan={4} className="empty-table-cell">No recorded activity for this user.</td></tr>}
                  {timeline.map((event, index) => (
                    <tr key={index}>
                      <td>{formatDate(event.time)}</td>
                      <td>{event.kind}</td>
                      <td style={{ maxWidth: 420 }}>{event.detail}</td>
                      <td><RiskBadge value={event.risk} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}
