async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.error || 'Request failed');
    error.status = response.status;
    error.details = data.details;
    throw error;
  }

  return data;
}

export const api = {
  login: (email, password) => request('/api/auth/login', { method: 'POST', body: { email, password } }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  me: () => request('/api/auth/me'),
  changePassword: (password) => request('/api/auth/change-password', { method: 'POST', body: { password } }),
  listUsers: () => request('/api/admin/users'),
  createUser: (payload) => request('/api/admin/users', { method: 'POST', body: payload }),
  updateUser: (id, payload) => request(`/api/admin/users/${id}`, { method: 'PATCH', body: payload }),
  resetPassword: (id) => request(`/api/admin/users/${id}/reset-password`, { method: 'POST' }),
  bulkUsers: (payload) => request('/api/admin/users/bulk', { method: 'POST', body: payload }),
  auditLogs: (id) => request(`/api/admin/users/${id}/audit-logs`),
  roleTemplates: () => request('/api/admin/role-templates'),
  updateRoleTemplate: (role, permission_keys) => request(`/api/admin/role-templates/${role}`, {
    method: 'PUT',
    body: { permission_keys },
  }),
  parsePnr: (text, provider = 'auto') => request('/api/bookings/parse-pnr', {
    method: 'POST',
    body: { text, provider },
  }),
};
