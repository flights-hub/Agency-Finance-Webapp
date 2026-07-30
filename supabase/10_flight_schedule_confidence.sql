alter table public.flight_schedules
add column if not exists confidence_score numeric(3, 2) default 0.35,
add column if not exists schedule_time_reliable boolean default false,
add column if not exists valid_from date,
add column if not exists valid_to date,
add column if not exists verified_at timestamptz,
add column if not exists source_url text,
add column if not exists departure_terminal varchar(10),
add column if not exists arrival_terminal varchar(10),
add column if not exists schedule_notes text;

update public.flight_schedules
set
  confidence_score = case
    when source = 'manual_verified' then 1.00
    when source in ('gds', 'airline_site') then 0.95
    when source = 'flightinfo' then 0.85
    else 0.35
  end,
  schedule_time_reliable = source in ('manual_verified', 'gds', 'airline_site', 'flightinfo'),
  verified_at = case
    when source in ('manual_verified', 'gds', 'airline_site', 'flightinfo')
      then coalesce(verified_at, updated_at, current_timestamp)
    else verified_at
  end;

create index if not exists idx_flight_schedules_source_quality
on public.flight_schedules (flight_number, source, confidence_score desc, updated_at desc);
