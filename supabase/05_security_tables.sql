-- Security module: login history, session registry, enriched audit trail,
-- and security alerts. Logs are append-only (see protect triggers below).

create extension if not exists pgcrypto;

-- A. login_history — one row per login attempt (success or failure).
create table if not exists public.login_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  username text,
  role text,
  agency_id text,
  login_time timestamptz not null default now(),
  logout_time timestamptz,
  session_duration integer,
  login_status text not null check (login_status in ('SUCCESS', 'FAILED', 'BLOCKED', 'EXPIRED', 'MFA_FAILED')),
  failure_reason text,
  ip_address text,
  forwarded_ip text,
  country text,
  region text,
  city text,
  isp text,
  asn text,
  device_type text,
  operating_system text,
  browser text,
  browser_version text,
  user_agent text,
  device_fingerprint text,
  session_id text,
  is_new_device boolean not null default false,
  is_new_location boolean not null default false,
  vpn_proxy_tor_status text,
  risk_score text not null default 'low' check (risk_score in ('low', 'medium', 'high', 'critical')),
  created_at timestamptz not null default now()
);

create index if not exists login_history_user_idx on public.login_history (user_id, login_time desc);
create index if not exists login_history_username_idx on public.login_history (username, login_time desc);
create index if not exists login_history_ip_idx on public.login_history (ip_address, login_time desc);
create index if not exists login_history_status_idx on public.login_history (login_status, login_time desc);
create index if not exists login_history_session_idx on public.login_history (session_id);

-- B. user_sessions — registry of issued sessions so tokens can be revoked.
create table if not exists public.user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  session_id_hash text not null unique,
  ip_address text,
  country text,
  city text,
  device text,
  browser text,
  login_time timestamptz not null default now(),
  last_activity timestamptz not null default now(),
  expiry_time timestamptz not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'REVOKED', 'EXPIRED')),
  revoked_by uuid references public.profiles(id) on delete set null,
  revoked_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_sessions_user_idx on public.user_sessions (user_id, status);
create index if not exists user_sessions_status_idx on public.user_sessions (status, last_activity desc);

drop trigger if exists user_sessions_set_updated_at on public.user_sessions;
create trigger user_sessions_set_updated_at
before update on public.user_sessions
for each row execute function public.set_updated_at();

-- C. audit_logs — enrich the existing table with full audit-trail context.
alter table public.audit_logs add column if not exists username text;
alter table public.audit_logs add column if not exists role text;
alter table public.audit_logs add column if not exists agency_id text;
alter table public.audit_logs add column if not exists module_name text;
alter table public.audit_logs add column if not exists action_type text;
alter table public.audit_logs add column if not exists record_type text;
alter table public.audit_logs add column if not exists record_id text;
alter table public.audit_logs add column if not exists old_value jsonb;
alter table public.audit_logs add column if not exists new_value jsonb;
alter table public.audit_logs add column if not exists ip_address text;
alter table public.audit_logs add column if not exists country text;
alter table public.audit_logs add column if not exists city text;
alter table public.audit_logs add column if not exists device text;
alter table public.audit_logs add column if not exists browser text;
alter table public.audit_logs add column if not exists user_agent text;
alter table public.audit_logs add column if not exists result text not null default 'success';
alter table public.audit_logs add column if not exists error_message text;
alter table public.audit_logs add column if not exists risk_level text not null default 'low';
alter table public.audit_logs add column if not exists remarks text;

create index if not exists audit_logs_created_idx on public.audit_logs (created_at desc);
create index if not exists audit_logs_actor_idx on public.audit_logs (actor_id, created_at desc);
create index if not exists audit_logs_module_idx on public.audit_logs (module_name, created_at desc);
create index if not exists audit_logs_risk_idx on public.audit_logs (risk_level, created_at desc);

-- D. security_alerts — automatic suspicious-activity alerts.
create table if not exists public.security_alerts (
  id uuid primary key default gen_random_uuid(),
  alert_time timestamptz not null default now(),
  alert_type text not null,
  user_id uuid references public.profiles(id) on delete set null,
  username text,
  role text,
  ip_address text,
  country text,
  city text,
  device text,
  browser text,
  trigger_reason text not null,
  risk_level text not null default 'medium' check (risk_level in ('low', 'medium', 'high', 'critical')),
  status text not null default 'OPEN' check (status in ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'FALSE_POSITIVE')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  resolution_notes text,
  created_at timestamptz not null default now()
);

create index if not exists security_alerts_status_idx on public.security_alerts (status, alert_time desc);
create index if not exists security_alerts_user_idx on public.security_alerts (user_id, alert_time desc);

-- Log protection: security logs are append-only. Audit rows can never be
-- updated or deleted; login history and alerts can never be deleted
-- (login rows are updated only to close out the session on logout).
create or replace function public.block_security_log_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'security logs are append-only (% on % is not allowed)', tg_op, tg_table_name;
end;
$$;

drop trigger if exists audit_logs_block_update on public.audit_logs;
create trigger audit_logs_block_update
before update or delete on public.audit_logs
for each row execute function public.block_security_log_mutation();

drop trigger if exists login_history_block_delete on public.login_history;
create trigger login_history_block_delete
before delete on public.login_history
for each row execute function public.block_security_log_mutation();

drop trigger if exists security_alerts_block_delete on public.security_alerts;
create trigger security_alerts_block_delete
before delete on public.security_alerts
for each row execute function public.block_security_log_mutation();

-- RLS: service role only, same model as the rest of the app schema.
alter table public.login_history enable row level security;
alter table public.user_sessions enable row level security;
alter table public.security_alerts enable row level security;

drop policy if exists "service role full login history access" on public.login_history;
create policy "service role full login history access" on public.login_history
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists "service role full sessions access" on public.user_sessions;
create policy "service role full sessions access" on public.user_sessions
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists "service role full alerts access" on public.security_alerts;
create policy "service role full alerts access" on public.security_alerts
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
