insert into public.profiles (
  id,
  email,
  name,
  role,
  status,
  must_change_password
) values (
  'c5be3230-4f58-4d46-866b-8086da44d660',
  'flyforsureitalia@gmail.com',
  'Admin',
  'ADMIN',
  'ACTIVE',
  false
)
on conflict (id) do update set
  email = excluded.email,
  name = excluded.name,
  role = excluded.role,
  status = excluded.status,
  must_change_password = excluded.must_change_password;
