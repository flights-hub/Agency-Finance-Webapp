export const PERMISSION_LABELS = {
  view_bookings: 'View bookings',
  create_bookings: 'Create bookings',
  edit_bookings: 'Edit bookings',
  view_payments: 'View payments',
  record_payments: 'Record payments',
  verify_payments: 'Verify payments',
  view_refunds: 'View refunds',
  process_refunds: 'Process refunds',
  view_financials: 'View financials',
  edit_financials: 'Edit financials',
  view_statements: 'View statements',
  send_statements: 'Send statements',
  manage_users: 'Manage users',
  view_audit_logs: 'View audit logs',
  configure_settings: 'Configure settings',
};

export const ALL_PERMISSIONS = Object.keys(PERMISSION_LABELS);

export const ROLE_LABELS = {
  ADMIN: 'Admin',
  EMPLOYEE: 'Employee',
  AGENT: 'Agent',
  SUPPLIER: 'Supplier',
};

export const ROLE_OPTIONS = Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }));

export function hasPermission(user, permission) {
  return user?.role === 'ADMIN' || user?.permissions?.includes(permission);
}
