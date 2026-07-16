-- Bank accounts: the configurable list of internal accounts money is received
-- into / paid from. Managed from Settings > Bank Accounts and shown in the
-- payment modal's "Received Into (Bank Account)" and cheque "Deposit Account"
-- dropdowns. Same JSON-in-jsonb shape as the other finance collections, with a
-- client-generated text id so historical payments keep referring to the same
-- account code even after the list changes.

create table if not exists public.bank_accounts (
  id text primary key,
  data jsonb not null default '{}',
  label text generated always as (data->>'label') stored,
  currency text generated always as (data->>'currency') stored,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bank_accounts_currency_idx on public.bank_accounts (currency);

drop trigger if exists bank_accounts_set_updated_at on public.bank_accounts;
create trigger bank_accounts_set_updated_at
before update on public.bank_accounts
for each row execute function public.set_updated_at();

alter table public.bank_accounts enable row level security;

drop policy if exists "service role full bank_accounts access" on public.bank_accounts;
create policy "service role full bank_accounts access" on public.bank_accounts
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- Seed the accounts the app previously hardcoded. Their ids match the old
-- codes so payments recorded before this feature keep resolving to a label.
insert into public.bank_accounts (id, data)
values
  ('REVOLUT_EUR', '{"label": "Revolut EUR", "currency": "EUR", "account_ref": "", "active": true}'),
  ('INTESA_SANPAOLO', '{"label": "Intesa Sanpaolo", "currency": "EUR", "account_ref": "", "active": true}'),
  ('HDFC_INDIA', '{"label": "HDFC India", "currency": "INR", "account_ref": "", "active": true}')
on conflict (id) do nothing;
