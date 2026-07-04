-- Booking servicing cases (amendment + cancellation cases) and allocation
-- records. Applied to the Agency-Finance-Webapp Supabase project on
-- 2026-07-05 as migration `servicing_cases_and_allocations`.
-- Same jsonb document pattern as bookings/payments/refunds
-- (04_finance_tables.sql): the web app owns the record shape, generated
-- columns cover the fields we filter and join on.
-- `allocations` backs the continuous-ledger settlement records that the
-- server already served but never had a table for.

create table if not exists public.allocations (
  id text primary key,
  data jsonb not null default '{}',
  pnr text generated always as (upper(data->>'pnr')) stored,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.amendments (
  id text primary key,
  data jsonb not null default '{}',
  pnr text generated always as (upper(data->>'pnr')) stored,
  booking_id text generated always as (data->>'booking_id') stored,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cancellations (
  id text primary key,
  data jsonb not null default '{}',
  pnr text generated always as (upper(data->>'pnr')) stored,
  booking_id text generated always as (data->>'booking_id') stored,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists allocations_pnr_idx on public.allocations (pnr);
create index if not exists amendments_pnr_idx on public.amendments (pnr);
create index if not exists amendments_booking_id_idx on public.amendments (booking_id);
create index if not exists cancellations_pnr_idx on public.cancellations (pnr);
create index if not exists cancellations_booking_id_idx on public.cancellations (booking_id);

drop trigger if exists allocations_set_updated_at on public.allocations;
create trigger allocations_set_updated_at
before update on public.allocations
for each row execute function public.set_updated_at();

drop trigger if exists amendments_set_updated_at on public.amendments;
create trigger amendments_set_updated_at
before update on public.amendments
for each row execute function public.set_updated_at();

drop trigger if exists cancellations_set_updated_at on public.cancellations;
create trigger cancellations_set_updated_at
before update on public.cancellations
for each row execute function public.set_updated_at();

alter table public.allocations enable row level security;
alter table public.amendments enable row level security;
alter table public.cancellations enable row level security;

drop policy if exists "service role full allocations access" on public.allocations;
create policy "service role full allocations access" on public.allocations
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists "service role full amendments access" on public.amendments;
create policy "service role full amendments access" on public.amendments
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

drop policy if exists "service role full cancellations access" on public.cancellations;
create policy "service role full cancellations access" on public.cancellations
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
