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
