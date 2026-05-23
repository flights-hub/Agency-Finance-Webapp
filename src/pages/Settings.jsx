import { useMemo, useState } from 'react';
import { getUsers } from '../helpers/storage';
import { ArrowUpDown, Download, Search, SlidersHorizontal } from 'lucide-react';

const USER_COLUMNS = [
  ['name', 'Name'],
  ['email', 'Email'],
  ['role', 'Role'],
  ['status', 'Status'],
];

export default function SettingsPage() {
  const [users] = useState(() => getUsers());
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [showColumns, setShowColumns] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState(() => new Set(USER_COLUMNS.map(([key]) => key)));
  const [sortKey, setSortKey] = useState('name');
  const [sortDir, setSortDir] = useState('asc');

  const directoryRows = useMemo(() => users.map((user) => ({
    ...user,
    status: user.status || 'ACTIVE',
  })), [users]);
  const activeColumns = useMemo(
    () => USER_COLUMNS.filter(([key]) => visibleColumns.has(key)),
    [visibleColumns],
  );
  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return directoryRows
      .filter((user) => {
        const matchesQuery = !query || ['name', 'email', 'role', 'status']
          .some((key) => String(user[key] || '').toLowerCase().includes(query));
        return matchesQuery && (!roleFilter || user.role === roleFilter);
      })
      .sort((a, b) => {
        const result = String(a[sortKey] || '').localeCompare(String(b[sortKey] || ''), undefined, { numeric: true });
        return sortDir === 'asc' ? result : -result;
      });
  }, [directoryRows, roleFilter, search, sortDir, sortKey]);
  const roles = [...new Set(directoryRows.map((user) => user.role).filter(Boolean))];

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

  const exportCSV = () => {
    const header = activeColumns.map(([, label]) => label);
    const rows = filteredUsers.map((user) => activeColumns.map(([key]) => String(user[key] || '').replace(/_/g, ' ')));
    const csv = [header, ...rows].map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `directory-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page-container fade-in">
      <header className="page-header">
        <h1>Settings</h1>
        <p>Manage users, roles, and application preferences.</p>
      </header>

      <div className="grid-2">
        <div>
        <div className="card booking-controls">
          <h3>Directory (Agents & Suppliers)</h3>
          <div className="booking-filter-grid compact" style={{ marginTop: 16 }}>
            <label>
              <span>Search</span>
              <div className="field-with-icon">
                <Search size={17} />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, email, role..." />
              </div>
            </label>
            <label>
              <span>Role</span>
              <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
                <option value="">All roles</option>
                {roles.map((role) => <option key={role} value={role}>{role.replace(/_/g, ' ')}</option>)}
              </select>
            </label>
          </div>
          <div className="booking-table-actions">
            <div className="table-meta">
              <span><strong>{filteredUsers.length}</strong> of <strong>{directoryRows.length}</strong> users</span>
              <span>{activeColumns.length} visible columns</span>
            </div>
            <div className="booking-action-group">
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => { setSearch(''); setRoleFilter(''); }}>Reset</button>
              <button className="btn btn-secondary btn-sm" type="button" onClick={() => setShowColumns((value) => !value)}>
                <SlidersHorizontal size={15} /> Columns
              </button>
              <button className="btn btn-primary btn-sm" type="button" onClick={exportCSV}>
                <Download size={15} /> Export
              </button>
            </div>
          </div>
          {showColumns && (
            <div className="column-panel">
              {USER_COLUMNS.map(([key, label]) => (
                <label key={key}>
                  <input type="checkbox" checked={visibleColumns.has(key)} onChange={() => toggleColumn(key)} />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="card table-card" style={{ marginTop: 16 }}>
          <div className="table-scroll">
            <table className="data-table dense-table settings-table">
              <thead>
                <tr>{activeColumns.map(([key, label]) => (
                  <th key={key}>
                    <button type="button" onClick={() => handleSort(key)}>
                      {label}
                      <ArrowUpDown size={13} />
                    </button>
                  </th>
                ))}</tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => (
                  <tr key={user.id}>
                    {activeColumns.map(([key]) => (
                      <td key={key}>
                        {key === 'role' || key === 'status'
                          ? <span className="badge badge-neutral">{String(user[key] || '').replace(/_/g, ' ')}</span>
                          : user[key]}
                      </td>
                    ))}
                  </tr>
                ))}
                {filteredUsers.length === 0 && (
                  <tr><td className="empty-table-cell" colSpan={activeColumns.length}>No users found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        </div>

        <div className="card">
          <h3>Application Preferences</h3>
          <div style={{marginTop: '20px'}}>
            <label style={{display:'block', marginBottom:'10px', fontWeight:'bold'}}>Default Currency</label>
            <select style={{width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid var(--border)', marginBottom:'20px'}}>
              <option>EUR (€)</option>
              <option>USD ($)</option>
              <option>INR (₹)</option>
            </select>

            <label style={{display:'block', marginBottom:'10px', fontWeight:'bold'}}>Alert Threshold (Days)</label>
            <input type="number" defaultValue={14} style={{width: '100%', padding: '10px', borderRadius: '4px', border: '1px solid var(--border)'}} />
            <p style={{fontSize: '0.85em', color: 'var(--zinc-500)', marginTop:'5px'}}>
              Number of days before departure to trigger a FOLLOW_UP alert for unpaid balances.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
