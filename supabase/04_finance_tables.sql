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

create index if not exists bookings_pnr_idx on public.bookings (pnr);
create index if not exists bookings_booking_ref_idx on public.bookings (booking_ref);
create index if not exists bookings_invoice_no_idx on public.bookings (invoice_no);
create index if not exists payments_pnr_idx on public.payments (pnr);
create index if not exists refunds_pnr_idx on public.refunds (pnr);

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

alter table public.bookings enable row level security;
alter table public.payments enable row level security;
alter table public.refunds enable row level security;
alter table public.expenses enable row level security;

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
