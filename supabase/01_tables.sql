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
