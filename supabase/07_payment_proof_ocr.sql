-- Payment proof evidence, local OCR metadata, and atomic verification posting.
-- R2 keeps original evidence private; Postgres stores only metadata, OCR
-- extraction, verification state, and ledger/audit postings.

create extension if not exists pgcrypto;

create table if not exists public.payment_proofs (
  id uuid primary key default gen_random_uuid(),
  payment_id text not null references public.payments(id) on delete cascade,
  r2_bucket text not null,
  r2_key text not null unique,
  original_filename text not null,
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'application/pdf')),
  size_bytes bigint not null check (size_bytes > 0),
  sha256 text,
  status text not null default 'PENDING_UPLOAD' check (status in ('PENDING_UPLOAD', 'UPLOADED', 'VERIFIED', 'REJECTED', 'ORPHANED')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  uploaded_at timestamptz,
  verified_at timestamptz
);

create index if not exists payment_proofs_payment_idx on public.payment_proofs (payment_id, created_at desc);
create index if not exists payment_proofs_status_idx on public.payment_proofs (status, created_at desc);

create table if not exists public.payment_proof_ocr (
  id uuid primary key default gen_random_uuid(),
  proof_id uuid not null references public.payment_proofs(id) on delete cascade,
  payment_id text not null references public.payments(id) on delete cascade,
  engine text not null,
  parser_version text not null,
  raw_text text not null default '',
  extracted jsonb not null default '{}',
  confidence numeric,
  status text not null default 'EXTRACTED' check (status in ('EXTRACTED', 'NO_TEXT', 'FAILED')),
  warnings text[] not null default '{}',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists payment_proof_ocr_payment_idx on public.payment_proof_ocr (payment_id, created_at desc);
create index if not exists payment_proof_ocr_proof_idx on public.payment_proof_ocr (proof_id, created_at desc);

create table if not exists public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  entry_group_id uuid not null,
  payment_id text not null references public.payments(id) on delete cascade,
  entry_side text not null check (entry_side in ('DEBIT', 'CREDIT')),
  account_key text not null,
  account_type text not null,
  amount numeric(14, 2) not null check (amount > 0),
  currency text not null default 'EUR',
  posted_by uuid references public.profiles(id) on delete set null,
  posted_at timestamptz not null default now(),
  source_type text not null default 'PAYMENT',
  source_id text not null,
  data jsonb not null default '{}',
  voided_at timestamptz,
  void_reason text
);

create index if not exists ledger_entries_payment_idx on public.ledger_entries (payment_id, posted_at desc);
create index if not exists ledger_entries_account_idx on public.ledger_entries (account_key, posted_at desc);
create unique index if not exists ledger_entries_active_payment_side_idx
  on public.ledger_entries (payment_id, entry_side, account_key)
  where voided_at is null;

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  record_type text not null,
  record_id text not null,
  old_value jsonb,
  new_value jsonb,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists audit_events_record_idx on public.audit_events (record_type, record_id, created_at desc);
create index if not exists audit_events_actor_idx on public.audit_events (actor_id, created_at desc);

alter table public.payment_proofs enable row level security;
alter table public.payment_proof_ocr enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.audit_events enable row level security;

drop policy if exists "service role full payment proofs access" on public.payment_proofs;
create policy "service role full payment proofs access" on public.payment_proofs
  for all to service_role using (true) with check (true);

drop policy if exists "service role full payment proof ocr access" on public.payment_proof_ocr;
create policy "service role full payment proof ocr access" on public.payment_proof_ocr
  for all to service_role using (true) with check (true);

drop policy if exists "service role full ledger entries access" on public.ledger_entries;
create policy "service role full ledger entries access" on public.ledger_entries
  for all to service_role using (true) with check (true);

drop policy if exists "service role full audit events access" on public.audit_events;
create policy "service role full audit events access" on public.audit_events
  for all to service_role using (true) with check (true);

grant all on table public.payment_proofs to service_role;
grant all on table public.payment_proof_ocr to service_role;
grant all on table public.ledger_entries to service_role;
grant all on table public.audit_events to service_role;
revoke all on table public.payment_proofs from anon, authenticated;
revoke all on table public.payment_proof_ocr from anon, authenticated;
revoke all on table public.ledger_entries from anon, authenticated;
revoke all on table public.audit_events from anon, authenticated;

create or replace function public.verify_and_post_payment(
  p_payment_id text,
  p_payment_data jsonb,
  p_verified_by uuid,
  p_notes text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_existing public.payments%rowtype;
  v_now timestamptz := now();
  v_next jsonb;
  v_amount numeric;
  v_currency text;
  v_method text;
  v_status text;
  v_direction text;
  v_party_type text;
  v_is_supplier boolean;
  v_counterparty_account text;
  v_cash_account text;
  v_counterparty_side text;
  v_cash_side text;
  v_group uuid := gen_random_uuid();
begin
  select * into v_existing
  from public.payments
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'Payment % not found', p_payment_id;
  end if;

  v_next := coalesce(p_payment_data, '{}'::jsonb)
    || jsonb_build_object(
      'id', p_payment_id,
      'verification_status', 'VERIFIED',
      'verified_by_user_id', p_verified_by,
      'verified_at', v_now
    );

  if p_notes is not null then
    v_next := jsonb_set(v_next, '{verification_notes}', to_jsonb(p_notes), true);
  end if;

  update public.payments
  set data = v_next,
      updated_at = v_now
  where id = p_payment_id;

  update public.ledger_entries
  set voided_at = v_now,
      void_reason = 'replaced by verify_and_post_payment'
  where payment_id = p_payment_id
    and voided_at is null;

  v_status := coalesce(nullif(v_next->>'ledger_posting_status', ''), 'POSTED');

  if v_status = 'POSTED' then
    v_amount := nullif(v_next->>'amount_paid', '')::numeric;
    if v_amount is null or v_amount <= 0 then
      raise exception 'Cannot post payment % without a positive amount', p_payment_id;
    end if;

    v_currency := coalesce(nullif(v_next->>'transaction_currency', ''), 'EUR');
    v_method := coalesce(nullif(v_next->>'payment_method', ''), nullif(v_next->>'payment_mode', ''), 'UNKNOWN');
    v_direction := coalesce(nullif(v_next->>'payment_direction', ''), 'RECEIVED');
    v_party_type := coalesce(nullif(v_next->>'party_type', ''), 'CUSTOMER');
    v_is_supplier := v_direction = 'SUPPLIER_OUT' or v_party_type = 'SUPPLIER';
    v_counterparty_account := lower(v_party_type || ':' || coalesce(
      nullif(v_next->>'party_name', ''),
      nullif(v_next->>'supplier_name', ''),
      nullif(v_next->>'passenger_name', ''),
      nullif(v_next->>'pnr', ''),
      'unassigned'
    ));
    v_cash_account := lower(coalesce(
      nullif(v_next->>'internal_bank_account_id', ''),
      nullif(v_next->>'cashbox_id', ''),
      nullif(v_next->>'internal_upi_account_id', ''),
      nullif(v_next->>'pos_terminal_id', ''),
      nullif(v_next->>'payment_gateway', ''),
      'undeposited-funds'
    ));
    v_counterparty_side := case when v_is_supplier or v_direction = 'PAID' then 'DEBIT' else 'CREDIT' end;
    v_cash_side := case when v_counterparty_side = 'DEBIT' then 'CREDIT' else 'DEBIT' end;

    insert into public.ledger_entries (
      entry_group_id, payment_id, entry_side, account_key, account_type,
      amount, currency, posted_by, source_id, data
    ) values
      (
        v_group, p_payment_id, v_cash_side, v_cash_account, 'CASH_OR_BANK',
        round(v_amount, 2), v_currency, p_verified_by, p_payment_id,
        jsonb_build_object('method', v_method)
      ),
      (
        v_group, p_payment_id, v_counterparty_side, v_counterparty_account, v_party_type,
        round(v_amount, 2), v_currency, p_verified_by, p_payment_id,
        jsonb_build_object('pnr', v_next->>'pnr', 'payment_reference', v_next->>'payment_reference')
      );
  end if;

  insert into public.audit_events (
    actor_id, event_type, record_type, record_id, old_value, new_value, metadata
  ) values (
    p_verified_by,
    'verify_and_post_payment',
    'payment',
    p_payment_id,
    v_existing.data,
    v_next,
    jsonb_build_object('ledger_posting_status', v_status)
  );

  return jsonb_build_object(
    'record', v_next,
    'ledger_posted', v_status = 'POSTED'
  );
end;
$$;

revoke all on function public.verify_and_post_payment(text, jsonb, uuid, text) from public;
revoke all on function public.verify_and_post_payment(text, jsonb, uuid, text) from anon;
revoke all on function public.verify_and_post_payment(text, jsonb, uuid, text) from authenticated;
grant execute on function public.verify_and_post_payment(text, jsonb, uuid, text) to service_role;
