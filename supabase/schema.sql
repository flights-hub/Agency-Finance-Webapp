create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  name text not null,
  role text not null check (role in ('ADMIN', 'EMPLOYEE', 'AGENT', 'SUPPLIER')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUSPENDED')),
  linked_agent_id text,
  linked_supplier_id text,
  must_change_password boolean not null default false,
  last_login timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.permissions (
  permission_key text primary key,
  label text not null,
  description text not null default ''
);

create table if not exists public.role_templates (
  role text primary key check (role in ('ADMIN', 'EMPLOYEE', 'AGENT', 'SUPPLIER')),
  name text not null,
  permission_keys text[] not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists public.user_permissions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  permission_key text not null references public.permissions(permission_key) on delete cascade,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, permission_key)
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  target_user_id uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists role_templates_set_updated_at on public.role_templates;
create trigger role_templates_set_updated_at
before update on public.role_templates
for each row execute function public.set_updated_at();

drop trigger if exists user_permissions_set_updated_at on public.user_permissions;
create trigger user_permissions_set_updated_at
before update on public.user_permissions
for each row execute function public.set_updated_at();

insert into public.permissions (permission_key, label, description) values
  ('view_bookings', 'View bookings', 'Open booking ledgers and booking detail views.'),
  ('create_bookings', 'Create bookings', 'Create new customer bookings.'),
  ('edit_bookings', 'Edit bookings', 'Update booking passenger, ticket, and flight fields.'),
  ('view_payments', 'View payments', 'Read incoming payment records.'),
  ('record_payments', 'Record payments', 'Create and update incoming payment records.'),
  ('verify_payments', 'Verify payments', 'Approve payment records so they post to the financial ledger.'),
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
      'view_payments', 'record_payments', 'verify_payments',
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
      'view_bookings',
      'view_payments',
      'record_payments',
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

alter table public.profiles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_templates enable row level security;
alter table public.user_permissions enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists "service role full profiles access" on public.profiles;
create policy "service role full profiles access" on public.profiles
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists "service role full permissions access" on public.permissions;
create policy "service role full permissions access" on public.permissions
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists "service role full templates access" on public.role_templates;
create policy "service role full templates access" on public.role_templates
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists "service role full user permissions access" on public.user_permissions;
create policy "service role full user permissions access" on public.user_permissions
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists "service role full audit access" on public.audit_logs;
create policy "service role full audit access" on public.audit_logs
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
-- Finance records: bookings, payments, refunds, expenses.
-- Records keep the JSON shape produced by the web app (client-generated ids),
-- with generated columns for the fields we filter and join on.

create table if not exists public.bookings (
  id text primary key,
  data jsonb not null default '{}',
  pnr text generated always as (upper(data->>'pnr')) stored,
  booking_ref text generated always as (data->>'booking_ref') stored,
  invoice_no text generated always as (data->>'invoice_no') stored,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payments (
  id text primary key,
  data jsonb not null default '{}',
  pnr text generated always as (upper(data->>'pnr')) stored,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.refunds (
  id text primary key,
  data jsonb not null default '{}',
  pnr text generated always as (upper(data->>'pnr')) stored,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id text primary key,
  data jsonb not null default '{}',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Allocation / reconciliation records: which payment or refund credit
-- settled which open item. Allocations never change ledger balances.
create table if not exists public.allocations (
  id text primary key,
  data jsonb not null default '{}',
  pnr text generated always as (upper(data->>'pnr')) stored,
  source_id text generated always as (data->>'source_id') stored,
  target_id text generated always as (data->>'target_id') stored,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bookings_pnr_idx on public.bookings (pnr);
create index if not exists bookings_booking_ref_idx on public.bookings (booking_ref);
create index if not exists bookings_invoice_no_idx on public.bookings (invoice_no);
create index if not exists payments_pnr_idx on public.payments (pnr);
create index if not exists refunds_pnr_idx on public.refunds (pnr);
create index if not exists allocations_pnr_idx on public.allocations (pnr);
create index if not exists allocations_source_idx on public.allocations (source_id);
create index if not exists allocations_target_idx on public.allocations (target_id);

drop trigger if exists bookings_set_updated_at on public.bookings;
create trigger bookings_set_updated_at
before update on public.bookings
for each row execute function public.set_updated_at();

drop trigger if exists payments_set_updated_at on public.payments;
create trigger payments_set_updated_at
before update on public.payments
for each row execute function public.set_updated_at();

drop trigger if exists refunds_set_updated_at on public.refunds;
create trigger refunds_set_updated_at
before update on public.refunds
for each row execute function public.set_updated_at();

drop trigger if exists expenses_set_updated_at on public.expenses;
create trigger expenses_set_updated_at
before update on public.expenses
for each row execute function public.set_updated_at();

drop trigger if exists allocations_set_updated_at on public.allocations;
create trigger allocations_set_updated_at
before update on public.allocations
for each row execute function public.set_updated_at();

alter table public.bookings enable row level security;
alter table public.payments enable row level security;
alter table public.refunds enable row level security;
alter table public.expenses enable row level security;
alter table public.allocations enable row level security;

drop policy if exists "service role full bookings access" on public.bookings;
create policy "service role full bookings access" on public.bookings
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists "service role full payments access" on public.payments;
create policy "service role full payments access" on public.payments
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists "service role full refunds access" on public.refunds;
create policy "service role full refunds access" on public.refunds
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists "service role full expenses access" on public.expenses;
create policy "service role full expenses access" on public.expenses
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists "service role full allocations access" on public.allocations;
create policy "service role full allocations access" on public.allocations
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
