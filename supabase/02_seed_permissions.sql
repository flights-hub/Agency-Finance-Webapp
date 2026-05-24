insert into public.permissions (permission_key, label, description) values
  ('view_bookings', 'View bookings', 'Open booking ledgers and booking detail views.'),
  ('create_bookings', 'Create bookings', 'Create new customer bookings.'),
  ('edit_bookings', 'Edit bookings', 'Update booking passenger, ticket, and flight fields.'),
  ('view_payments', 'View payments', 'Read incoming payment records.'),
  ('record_payments', 'Record payments', 'Create and update incoming payment records.'),
  ('view_refunds', 'View refunds', 'Read refund records and lifecycle states.'),
  ('process_refunds', 'Process refunds', 'Create and update refund records.'),
  ('view_financials', 'View financials', 'See fares, profit, payables, balances, and settlement values.'),
  ('edit_financials', 'Edit financials', 'Edit financial amounts and payment-sensitive fields.'),
  ('view_statements', 'View statements', 'Open agent, supplier, and admin statements.'),
  ('send_statements', 'Send statements', 'Send or schedule statements.'),
  ('manage_users', 'Manage users', 'Create users, change roles, suspend users, and reset passwords.'),
  ('view_audit_logs', 'View audit logs', 'Read user-management and login activity logs.'),
  ('configure_settings', 'Configure settings', 'Change application-level preferences.')
on conflict (permission_key) do update set
  label = excluded.label,
  description = excluded.description;

insert into public.role_templates (role, name, permission_keys) values
  (
    'ADMIN',
    'Admin',
    array[
      'view_bookings', 'create_bookings', 'edit_bookings',
      'view_payments', 'record_payments',
      'view_refunds', 'process_refunds',
      'view_financials', 'edit_financials',
      'view_statements', 'send_statements',
      'manage_users', 'view_audit_logs', 'configure_settings'
    ]
  ),
  (
    'EMPLOYEE',
    'Employee',
    array[
      'view_bookings', 'create_bookings', 'edit_bookings',
      'view_payments', 'record_payments',
      'view_refunds', 'process_refunds',
      'view_financials',
      'view_statements', 'send_statements'
    ]
  ),
  (
    'AGENT',
    'Agent',
    array[
      'view_bookings', 'create_bookings', 'edit_bookings',
      'view_payments',
      'view_statements'
    ]
  ),
  (
    'SUPPLIER',
    'Supplier',
    array[
      'view_bookings',
      'view_payments',
      'view_statements'
    ]
  )
on conflict (role) do update set
  name = excluded.name,
  permission_keys = excluded.permission_keys;
