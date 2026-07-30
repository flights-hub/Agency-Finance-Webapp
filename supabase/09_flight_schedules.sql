create table if not exists public.airports (
  iata_code varchar(3) primary key,
  icao_code varchar(4),
  name varchar(255) not null,
  city varchar(100) not null,
  country varchar(100) not null,
  latitude decimal(9, 6),
  longitude decimal(9, 6),
  timezone varchar(50) not null
);

create table if not exists public.flight_schedules (
  id bigserial primary key,
  flight_number varchar(10) not null,
  carrier_code varchar(3) not null,
  flight_digit varchar(6) not null,
  origin_iata varchar(3) not null,
  destination_iata varchar(3) not null,
  std_utc time not null,
  sta_utc time not null,
  aircraft_type varchar(10),
  days_of_operation varchar(7) default '1234567',
  source varchar(50) default 'open_dataset',
  confidence_score numeric(3, 2) default 0.35,
  schedule_time_reliable boolean default false,
  valid_from date,
  valid_to date,
  verified_at timestamptz,
  source_url text,
  departure_terminal varchar(10),
  arrival_terminal varchar(10),
  schedule_notes text,
  created_at timestamptz default current_timestamp,
  updated_at timestamptz default current_timestamp,
  constraint flight_schedules_route_unique unique (flight_number, origin_iata, destination_iata)
);

create index if not exists idx_flight_schedules_lookup
on public.flight_schedules (flight_number, origin_iata, destination_iata);

create index if not exists idx_flight_number
on public.flight_schedules (flight_number);

drop trigger if exists flight_schedules_set_updated_at on public.flight_schedules;
create trigger flight_schedules_set_updated_at
before update on public.flight_schedules
for each row execute function public.set_updated_at();

alter table public.airports enable row level security;
alter table public.flight_schedules enable row level security;

drop policy if exists "service role full airports access" on public.airports;
create policy "service role full airports access" on public.airports
  for all to service_role using (true) with check (true);

drop policy if exists "service role full flight schedules access" on public.flight_schedules;
create policy "service role full flight schedules access" on public.flight_schedules
  for all to service_role using (true) with check (true);
