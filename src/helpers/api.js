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
  listDirectoryUsers: () => request('/api/directory/users'),
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
  financeData: () => request('/api/finance/data'),
  saveFinanceRecord: (collection, record) => request(`/api/finance/${collection}/${encodeURIComponent(record.id)}`, {
    method: 'PUT',
    body: record,
  }),
  deleteFinanceRecord: (collection, id) => request(`/api/finance/${collection}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  }),
  finalizeAmendment: (record) => request('/api/amendments/finalize', {
    method: 'POST',
    body: { amendment: record },
  }),
  createPaymentProofUpload: (paymentId, payload) => request(`/api/payments/${encodeURIComponent(paymentId)}/proof-upload`, {
    method: 'POST',
    body: payload,
  }),
  completePaymentProofUpload: (paymentId, payload) => request(`/api/payments/${encodeURIComponent(paymentId)}/proof-complete`, {
    method: 'POST',
    body: payload,
  }),
  paymentProofViewUrl: (paymentId, proofId) => request(`/api/payments/${encodeURIComponent(paymentId)}/proofs/${encodeURIComponent(proofId)}/view-url`),
  bulkImportFinance: (collection, records) => request(`/api/finance/${collection}/bulk`, {
    method: 'POST',
    body: { records },
  }),
  parsePnr: (text, provider = 'auto') => request('/api/bookings/parse-pnr', {
    method: 'POST',
    body: { text, provider },
  }),
  parseBookingText: (text, source, provider = 'auto') => request('/api/bookings/parse-text', {
    method: 'POST',
    body: { text, source, provider },
  }),
  securityOverview: () => request('/api/security/overview'),
  securityLoginHistory: (params = {}) => request(`/api/security/login-history?${new URLSearchParams(params)}`),
  securityAuditTrail: (params = {}) => request(`/api/security/audit-trail?${new URLSearchParams(params)}`),
  securitySessions: () => request('/api/security/sessions'),
  securityAlerts: (params = {}) => request(`/api/security/alerts?${new URLSearchParams(params)}`),
  updateSecurityAlert: (id, payload) => request(`/api/security/alerts/${id}`, { method: 'PATCH', body: payload }),
  revokeSecuritySession: (id) => request(`/api/security/sessions/${id}/revoke`, { method: 'POST' }),
  revokeUserSecuritySessions: (userId) => request(`/api/security/users/${userId}/revoke-sessions`, { method: 'POST' }),
  revokeAllSecuritySessions: () => request('/api/security/sessions/revoke-all', { method: 'POST' }),
  securityTimeline: (user) => request(`/api/security/timeline?user=${encodeURIComponent(user)}`),
};
