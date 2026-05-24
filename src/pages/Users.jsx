import { useEffect, useMemo, useState } from 'react';
import { ArrowUpDown, Clipboard, History, KeyRound, Search, Shield, UserPlus, UserX } from 'lucide-react';
import { api } from '../helpers/api';
import { ALL_PERMISSIONS, PERMISSION_LABELS, ROLE_LABELS, ROLE_OPTIONS } from '../helpers/permissions';

const EMPTY_FORM = {
  name: '',
  email: '',
  role: 'AGENT',
  linked_agent_id: '',
  linked_supplier_id: '',
  permissions: [],
};

function normalizeLabel(value) {
  return String(value || '').replace(/_/g, ' ');
}

function formatDate(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

export default function Users() {
  const [users, setUsers] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [permissions, setPermissions] = useState(ALL_PERMISSIONS);
  const [form, setForm] = useState(EMPTY_FORM);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [sortKey, setSortKey] = useState('created_at');
  const [sortDir, setSortDir] = useState('desc');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [credential, setCredential] = useState(null);
  const [auditTarget, setAuditTarget] = useState(null);
  const [auditLogs, setAuditLogs] = useState([]);

  const templateMap = useMemo(
    () => Object.fromEntries(templates.map((template) => [template.role, template.permission_keys || []])),
    [templates],
  );

  const load = async () => {
    setLoading(true);
    try {
      const [userData, templateData] = await Promise.all([api.listUsers(), api.roleTemplates()]);
      setUsers(userData.users || []);
      setTemplates(templateData.templates || []);
      setPermissions(templateData.permissions || ALL_PERMISSIONS);
      setForm((current) => ({
        ...current,
        permissions: templateData.templates?.find((template) => template.role === current.role)?.permission_keys || [],
      }));
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return users
      .filter((user) => {
        const matchesQuery = !query || [user.name, user.email, user.role, user.status]
          .some((value) => String(value || '').toLowerCase().includes(query));
        return matchesQuery && (!roleFilter || user.role === roleFilter);
      })
      .sort((a, b) => {
        const result = String(a[sortKey] || '').localeCompare(String(b[sortKey] || ''), undefined, { numeric: true });
        return sortDir === 'asc' ? result : -result;
      });
  }, [roleFilter, search, sortDir, sortKey, users]);

  const handleSort = (key) => {
    if (sortKey === key) setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const updateForm = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const setRole = (role) => {
    setForm((current) => ({
      ...current,
      role,
      linked_agent_id: role === 'AGENT' ? current.linked_agent_id : '',
      linked_supplier_id: role === 'SUPPLIER' ? current.linked_supplier_id : '',
      permissions: templateMap[role] || [],
    }));
  };

  const togglePermission = (permission, checked, target = 'form') => {
    if (target === 'form') {
      setForm((current) => ({
        ...current,
        permissions: checked
          ? [...new Set([...current.permissions, permission])]
          : current.permissions.filter((item) => item !== permission),
      }));
      return;
    }

    setTemplates((current) => current.map((template) => {
      if (template.role !== target) return template;
      return {
        ...template,
        permission_keys: checked
          ? [...new Set([...(template.permission_keys || []), permission])]
          : (template.permission_keys || []).filter((item) => item !== permission),
      };
    }));
  };

  const createUser = async (event) => {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    setCredential(null);
    try {
      const data = await api.createUser(form);
      setCredential(data);
      setForm({ ...EMPTY_FORM, permissions: templateMap.AGENT || [] });
      await load();
      setMessage('User created. Share the temporary password securely.');
    } catch (err) {
      setMessage(err.message);
    } finally {
      setSaving(false);
    }
  };

  const resetPassword = async (user) => {
    setMessage('');
    try {
      const data = await api.resetPassword(user.id);
      setCredential({
        user,
        temporaryPassword: data.temporaryPassword,
        loginUrl: `/login?email=${encodeURIComponent(user.email)}&temporary=1`,
      });
      setMessage('Temporary password generated.');
      await load();
    } catch (err) {
      setMessage(err.message);
    }
  };

  const updateStatus = async (user, status) => {
    setMessage('');
    try {
      await api.updateUser(user.id, { status });
      await load();
      setMessage(status === 'SUSPENDED' ? 'User suspended.' : 'User reactivated.');
    } catch (err) {
      setMessage(err.message);
    }
  };

  const bulkAction = async (action) => {
    setMessage('');
    try {
      await api.bulkUsers({ action, userIds: [...selectedIds] });
      setSelectedIds(new Set());
      await load();
      setMessage(action === 'suspend' ? 'Selected users suspended.' : 'Selected users reactivated.');
    } catch (err) {
      setMessage(err.message);
    }
  };

  const viewAuditLogs = async (user) => {
    setAuditTarget(user);
    setAuditLogs([]);
    try {
      const data = await api.auditLogs(user.id);
      setAuditLogs(data.logs || []);
    } catch (err) {
      setMessage(err.message);
    }
  };

  const saveTemplate = async (template) => {
    setMessage('');
    try {
      await api.updateRoleTemplate(template.role, template.permission_keys || []);
      await load();
      setMessage(`${ROLE_LABELS[template.role]} template saved.`);
    } catch (err) {
      setMessage(err.message);
    }
  };

  const copyCredential = async () => {
    if (!credential) return;
    const text = [
      `Email: ${credential.user.email}`,
      `Temporary password: ${credential.temporaryPassword}`,
      `Login path: ${credential.loginUrl}`,
    ].join('\n');
    await navigator.clipboard.writeText(text);
    setMessage('Credentials copied.');
  };

  const toggleSelected = (id, checked) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  return (
    <div className="page-container fade-in users-page">
      <header className="page-header">
        <div>
          <h1>Users</h1>
          <p>Create logins, assign role-linked access, reset temporary passwords, and review audit history.</p>
        </div>
      </header>

      {message && <div className="notice">{message}</div>}

      <div className="users-layout">
        <form className="card user-create-card" onSubmit={createUser}>
          <div className="card-head">
            <div>
              <h3>Create User</h3>
              <p>Temporary credentials are generated after saving.</p>
            </div>
            <UserPlus size={22} />
          </div>
          <div className="booking-form-grid">
            <label>
              <span>Name</span>
              <input value={form.name} onChange={(event) => updateForm('name', event.target.value)} placeholder="Display name" required />
            </label>
            <label>
              <span>Email</span>
              <input type="email" value={form.email} onChange={(event) => updateForm('email', event.target.value)} placeholder="user@flyforsure.com" required />
            </label>
            <label>
              <span>Role</span>
              <select value={form.role} onChange={(event) => setRole(event.target.value)}>
                {ROLE_OPTIONS.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
              </select>
            </label>
            {form.role === 'AGENT' && (
              <label>
                <span>Agent assignment</span>
                <input value={form.linked_agent_id} onChange={(event) => updateForm('linked_agent_id', event.target.value)} placeholder="Agent profile id or code" />
              </label>
            )}
            {form.role === 'SUPPLIER' && (
              <label>
                <span>Supplier assignment</span>
                <input value={form.linked_supplier_id} onChange={(event) => updateForm('linked_supplier_id', event.target.value)} placeholder="Supplier profile id or code" />
              </label>
            )}
          </div>
          <div className="permission-grid">
            {permissions.map((permission) => (
              <label key={permission}>
                <input
                  type="checkbox"
                  checked={form.permissions.includes(permission)}
                  onChange={(event) => togglePermission(permission, event.target.checked)}
                />
                <span>{PERMISSION_LABELS[permission] || normalizeLabel(permission)}</span>
              </label>
            ))}
          </div>
          <div className="form-actions">
            <button className="btn btn-primary" type="submit" disabled={saving}>
              <UserPlus size={16} /> {saving ? 'Creating...' : 'Create and generate password'}
            </button>
          </div>
          {credential && (
            <div className="credential-box">
              <strong>Temporary credential</strong>
              <span>{credential.user.email}</span>
              <code>{credential.temporaryPassword}</code>
              <button className="btn btn-secondary btn-sm" type="button" onClick={copyCredential}>
                <Clipboard size={15} /> Copy
              </button>
            </div>
          )}
        </form>

        <div className="card">
          <div className="card-head">
            <div>
              <h3>Role Templates</h3>
              <p>Defaults applied when a new user role is selected.</p>
            </div>
            <Shield size={22} />
          </div>
          <div className="template-list">
            {templates.map((template) => (
              <section className="template-row" key={template.role}>
                <div className="template-row-head">
                  <div>
                    <strong>{ROLE_LABELS[template.role] || template.name}</strong>
                    <span>{(template.permission_keys || []).length} permissions</span>
                  </div>
                  <button className="btn btn-secondary btn-sm" type="button" onClick={() => saveTemplate(template)}>Save</button>
                </div>
                <div className="permission-grid compact">
                  {permissions.map((permission) => (
                    <label key={permission}>
                      <input
                        type="checkbox"
                        checked={(template.permission_keys || []).includes(permission)}
                        onChange={(event) => togglePermission(permission, event.target.checked, template.role)}
                      />
                      <span>{PERMISSION_LABELS[permission] || normalizeLabel(permission)}</span>
                    </label>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>

      <div className="card booking-controls">
        <h3>User List</h3>
        <div className="booking-filter-grid compact">
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
              {ROLE_OPTIONS.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
            </select>
          </label>
        </div>
        <div className="booking-table-actions">
          <div className="table-meta">
            <span><strong>{filteredUsers.length}</strong> users</span>
            <span><strong>{selectedIds.size}</strong> selected</span>
          </div>
          <div className="booking-action-group">
            <button className="btn btn-secondary btn-sm" type="button" disabled={!selectedIds.size} onClick={() => bulkAction('reactivate')}>Reactivate</button>
            <button className="btn btn-secondary btn-sm" type="button" disabled={!selectedIds.size} onClick={() => bulkAction('suspend')}>
              <UserX size={15} /> Suspend
            </button>
          </div>
        </div>
      </div>

      <div className="card table-card">
        <div className="table-scroll">
          <table className="data-table dense-table users-table">
            <thead>
              <tr>
                <th>Select</th>
                {[
                  ['name', 'Name'],
                  ['email', 'Email'],
                  ['role', 'Role'],
                  ['status', 'Status'],
                  ['last_login', 'Last Login'],
                  ['created_at', 'Created'],
                ].map(([key, label]) => (
                  <th key={key}>
                    <button type="button" onClick={() => handleSort(key)}>
                      {label}
                      <ArrowUpDown size={13} />
                    </button>
                  </th>
                ))}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => (
                <tr key={user.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(user.id)}
                      onChange={(event) => toggleSelected(user.id, event.target.checked)}
                    />
                  </td>
                  <td>{user.name}</td>
                  <td>{user.email}</td>
                  <td><span className="badge badge-neutral">{ROLE_LABELS[user.role] || user.role}</span></td>
                  <td><span className={`badge ${user.status === 'SUSPENDED' ? 'badge-fail' : 'badge-pass'}`}>{normalizeLabel(user.status)}</span></td>
                  <td>{formatDate(user.last_login)}</td>
                  <td>{formatDate(user.created_at)}</td>
                  <td>
                    <div className="booking-action-group nowrap">
                      <button className="btn btn-secondary btn-sm" type="button" onClick={() => resetPassword(user)}>
                        <KeyRound size={15} /> Reset
                      </button>
                      <button className="btn btn-secondary btn-sm" type="button" onClick={() => updateStatus(user, user.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED')}>
                        {user.status === 'SUSPENDED' ? 'Reactivate' : 'Suspend'}
                      </button>
                      <button className="btn btn-secondary btn-sm" type="button" onClick={() => viewAuditLogs(user)}>
                        <History size={15} /> Audit
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && filteredUsers.length === 0 && (
                <tr><td className="empty-table-cell" colSpan={8}>No users found.</td></tr>
              )}
              {loading && (
                <tr><td className="empty-table-cell" colSpan={8}>Loading users...</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {auditTarget && (
        <div className="card audit-panel">
          <div className="card-head">
            <div>
              <h3>Audit Logs</h3>
              <p>{auditTarget.email}</p>
            </div>
            <button className="btn btn-secondary btn-sm" type="button" onClick={() => setAuditTarget(null)}>Close</button>
          </div>
          <div className="audit-list">
            {auditLogs.map((log) => (
              <div key={log.id}>
                <strong>{normalizeLabel(log.action)}</strong>
                <span>{formatDate(log.created_at)}</span>
                <code>{JSON.stringify(log.metadata || {})}</code>
              </div>
            ))}
            {auditLogs.length === 0 && <p className="muted">No audit entries yet.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
