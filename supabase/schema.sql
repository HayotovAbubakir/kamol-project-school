-- ============================================================
-- KAMOL SCHOOL — SCHEMA (idempotent — ma’lumotni o‘chirmaydi)
-- Fayl: supabase/schema.sql
-- Cleanup alohida: supabase/cleanup.sql (faqat toza o‘rnatishda)
--
-- Faqat 2 ta SQL fayl: schema.sql + cleanup.sql
--
-- Supabase → SQL Editor → Run (qayta-qayta ishlatish mumkin)
-- Toza o‘rnatish: avval cleanup.sql, keyin shu fayl
--
-- Keyin Authentication → Providers → Email:
--   • Confirm email = OFF
--   • Min password length = 4 (ixtiyoriy)
-- Seed userlar (Dashboard → Auth → Users):
--   owner@kamol.school / owner123
--   admin@kamol.school / admin123
-- Login UI: owner / owner123
-- ============================================================

create extension if not exists "pgcrypto";

-- ============================================================
-- 1) Profiles (auth.users bilan 1:1) — parol YO‘Q
-- ============================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  name text not null,
  role text not null check (role in ('owner', 'admin', 'teacher')),
  teacher_id uuid,
  created_at timestamptz not null default now()
);

create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('owner', 'admin')
  );
$$;

-- ============================================================
-- 2) Teachers
-- ============================================================
create table if not exists public.teachers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null default '',
  monthly_salary numeric not null default 0,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_teacher_id_fkey'
  ) then
    alter table public.profiles
      add constraint profiles_teacher_id_fkey
      foreign key (teacher_id) references public.teachers(id) on delete set null;
  end if;
end $$;

-- ============================================================
-- 3) Groups
-- schedule: [{ "day": 1-7, "startTime": "HH:MM", "endTime": "HH:MM", "teacherId": "uuid" }]
-- teacher_id — asosiy/birinchi slot o‘qituvchisi (qisqa ko‘rsatish + eski RLS)
-- ============================================================
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  teacher_id uuid references public.teachers(id) on delete set null,
  monthly_fee numeric not null default 0,
  schedule jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

-- Eski guruhlar: teacher_id ni slotlarga ko‘chirish
update public.groups g
set schedule = coalesce((
  select jsonb_agg(
    case
      when nullif(slot->>'teacherId', '') is not null then slot
      when g.teacher_id is not null then slot || jsonb_build_object('teacherId', g.teacher_id::text)
      else slot
    end
    order by ordinality
  )
  from jsonb_array_elements(coalesce(g.schedule, '[]'::jsonb)) with ordinality as t(slot, ordinality)
), '[]'::jsonb)
where g.teacher_id is not null
  and exists (
    select 1
    from jsonb_array_elements(coalesce(g.schedule, '[]'::jsonb)) as slot
    where nullif(slot->>'teacherId', '') is null
  );

-- ============================================================
-- 4) Students
-- parent_phone: "+998...|+998..." (ota|ona) yoki bitta raqam
-- ============================================================
create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null default '',
  parent_phone text not null default '',
  monthly_fee numeric not null default 0,
  joined_at date not null default current_date,
  created_at timestamptz not null default now()
);

-- Ota-ona Telegram bot uchun qisqa takrorlanmas ID (KS-XXXXXX)
alter table public.students
  add column if not exists public_code text;

create or replace function public.generate_student_public_code()
returns text
language plpgsql
as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  candidate text;
  i int;
  ch text;
begin
  loop
    candidate := 'KS-';
    for i in 1..6 loop
      ch := substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
      candidate := candidate || ch;
    end loop;
    exit when not exists (
      select 1 from public.students where public_code = candidate
    );
  end loop;
  return candidate;
end;
$$;

create or replace function public.students_set_public_code()
returns trigger
language plpgsql
as $$
begin
  if new.public_code is null or btrim(new.public_code) = '' then
    new.public_code := public.generate_student_public_code();
  else
    new.public_code := upper(btrim(new.public_code));
  end if;
  return new;
end;
$$;

drop trigger if exists students_public_code_bi on public.students;
create trigger students_public_code_bi
  before insert on public.students
  for each row execute function public.students_set_public_code();

update public.students
set public_code = public.generate_student_public_code()
where public_code is null or btrim(public_code) = '';

do $$
begin
  alter table public.students alter column public_code set not null;
exception when others then
  null;
end $$;

create unique index if not exists students_public_code_uidx
  on public.students (public_code);

-- ============================================================
-- 4b) Telegram parent links
-- ============================================================
create table if not exists public.telegram_links (
  chat_id bigint primary key,
  student_id uuid not null,
  linked_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'telegram_links_student_id_fkey'
  ) then
    alter table public.telegram_links
      add constraint telegram_links_student_id_fkey
      foreign key (student_id) references public.students(id) on delete cascade;
  end if;
end $$;

create index if not exists telegram_links_student_id_idx
  on public.telegram_links (student_id);

-- ============================================================
-- 5) Group <-> Student
-- ============================================================
create table if not exists public.group_students (
  group_id uuid not null references public.groups(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  primary key (group_id, student_id)
);

-- ============================================================
-- 6) Payments — o'quvchi o'chirilsa ham to'lov saqlanadi
-- ============================================================
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.students(id) on delete set null,
  student_name text not null default '',
  amount numeric not null check (amount > 0),
  month int not null check (month between 1 and 12),
  year int not null check (year >= 2000),
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.payments
  add column if not exists student_name text;

update public.payments
set student_name = coalesce(student_name, '')
where student_name is null;

do $$
begin
  alter table public.payments alter column student_name set default '';
  alter table public.payments alter column student_name set not null;
exception when others then
  null;
end $$;

-- Eski DB: cascade bo‘lsa — set null ga o‘tkazish (moliya tarixi saqlansin)
do $$
declare
  fk_name text;
begin
  select con.conname into fk_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'payments'
    and con.contype = 'f'
    and pg_get_constraintdef(con.oid) ilike '%student_id%';

  if fk_name is not null then
    execute format('alter table public.payments drop constraint %I', fk_name);
  end if;

  alter table public.payments
    add constraint payments_student_id_fkey
    foreign key (student_id) references public.students(id) on delete set null;
exception when duplicate_object then
  null;
when others then
  null;
end $$;

-- ============================================================
-- 7) Salary payments
-- ============================================================
create table if not exists public.salary_payments (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  amount numeric not null check (amount > 0),
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- ============================================================
-- 8) Expenses
-- ============================================================
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  amount numeric not null check (amount > 0),
  category text not null default 'Operatsion',
  date date not null default current_date,
  recorded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 9) Attendance
-- ============================================================
create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  date date not null default current_date,
  status text not null check (status in ('present', 'late', 'absent')),
  note text not null default '',
  marked_by uuid references public.profiles(id) on delete set null,
  marked_at timestamptz not null default now(),
  unique (student_id, group_id, date)
);

-- ============================================================
-- 10) Auth signup → profile + login email lookup
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta_teacher uuid;
begin
  begin
    meta_teacher := nullif(new.raw_user_meta_data->>'teacher_id', '')::uuid;
  exception when others then
    meta_teacher := null;
  end;

  insert into public.profiles (id, username, name, role, teacher_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'role', 'admin'),
    meta_teacher
  )
  on conflict (id) do update set
    username = excluded.username,
    name = excluded.name,
    role = excluded.role,
    teacher_id = coalesce(excluded.teacher_id, public.profiles.teacher_id);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- UI login (username) → auth.users.email
create or replace function public.lookup_login_email(p_login text)
returns text
language sql
security definer
set search_path = public, auth
stable
as $$
  select u.email::text
  from auth.users u
  join public.profiles p on p.id = u.id
  where lower(p.username) = lower(trim(both from p_login))
  limit 1;
$$;

revoke all on function public.lookup_login_email(text) from public;
grant execute on function public.lookup_login_email(text) to anon, authenticated;

-- Staff (owner/admin) boshqa user parolini o‘zgartirishi
create or replace function public.staff_set_user_password(target_user uuid, new_password text)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
begin
  if not public.is_staff() then
    raise exception 'forbidden';
  end if;
  if target_user is null then
    raise exception 'user required';
  end if;
  if new_password is null or length(new_password) < 4 then
    raise exception 'password too short';
  end if;
  if not exists (select 1 from auth.users where id = target_user) then
    raise exception 'user not found';
  end if;

  update auth.users
  set
    encrypted_password = crypt(new_password, gen_salt('bf')),
    updated_at = now()
  where id = target_user;
end;
$$;

revoke all on function public.staff_set_user_password(uuid, text) from public;
grant execute on function public.staff_set_user_password(uuid, text) to authenticated;

-- Guruhda o‘qituvchi: teacher_id yoki schedule[].teacherId
create or replace function public.group_involves_teacher(g public.groups, tid uuid)
returns boolean
language sql
stable
as $$
  select tid is not null and (
    g.teacher_id = tid
    or exists (
      select 1
      from jsonb_array_elements(coalesce(g.schedule, '[]'::jsonb)) as slot
      where (slot->>'teacherId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and (slot->>'teacherId')::uuid = tid
    )
  );
$$;

-- ============================================================
-- 11) RLS
-- ============================================================
alter table public.profiles enable row level security;
alter table public.teachers enable row level security;
alter table public.groups enable row level security;
alter table public.students enable row level security;
alter table public.group_students enable row level security;
alter table public.payments enable row level security;
alter table public.salary_payments enable row level security;
alter table public.expenses enable row level security;
alter table public.attendance enable row level security;
alter table public.telegram_links enable row level security;

drop policy if exists "profiles_select_own_or_staff" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
drop policy if exists "profiles_insert_staff" on public.profiles;
drop policy if exists "profiles_delete_owner" on public.profiles;
drop policy if exists "teachers_staff_all" on public.teachers;
drop policy if exists "teachers_select_authenticated" on public.teachers;
drop policy if exists "groups_staff_all" on public.groups;
drop policy if exists "groups_teacher_select" on public.groups;
drop policy if exists "students_staff_all" on public.students;
drop policy if exists "students_teacher_select" on public.students;
drop policy if exists "group_students_staff_all" on public.group_students;
drop policy if exists "group_students_teacher_select" on public.group_students;
drop policy if exists "payments_staff_all" on public.payments;
drop policy if exists "salary_payments_staff_all" on public.salary_payments;
drop policy if exists "expenses_staff_all" on public.expenses;
drop policy if exists "attendance_staff_all" on public.attendance;
drop policy if exists "attendance_teacher_rw" on public.attendance;
drop policy if exists "telegram_links_staff_select" on public.telegram_links;

create policy "profiles_select_own_or_staff" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_staff());

create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.current_role() = 'owner');

create policy "profiles_insert_staff" on public.profiles
  for insert to authenticated
  with check (public.is_staff() or id = auth.uid());

create policy "profiles_delete_owner" on public.profiles
  for delete to authenticated
  using (public.current_role() = 'owner');

create policy "teachers_staff_all" on public.teachers
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

create policy "teachers_select_authenticated" on public.teachers
  for select to authenticated
  using (true);

create policy "groups_staff_all" on public.groups
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

create policy "groups_teacher_select" on public.groups
  for select to authenticated
  using (
    public.is_staff()
    or public.group_involves_teacher(
      groups,
      (select teacher_id from public.profiles where id = auth.uid())
    )
  );

create policy "students_staff_all" on public.students
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

create policy "students_teacher_select" on public.students
  for select to authenticated
  using (
    public.is_staff()
    or exists (
      select 1
      from public.group_students gs
      join public.groups g on g.id = gs.group_id
      where gs.student_id = students.id
        and public.group_involves_teacher(
          g,
          (select teacher_id from public.profiles where id = auth.uid())
        )
    )
  );

create policy "group_students_staff_all" on public.group_students
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

create policy "group_students_teacher_select" on public.group_students
  for select to authenticated
  using (
    public.is_staff()
    or exists (
      select 1 from public.groups g
      where g.id = group_students.group_id
        and public.group_involves_teacher(
          g,
          (select teacher_id from public.profiles where id = auth.uid())
        )
    )
  );

create policy "payments_staff_all" on public.payments
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

create policy "salary_payments_staff_all" on public.salary_payments
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

create policy "expenses_staff_all" on public.expenses
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

create policy "attendance_staff_all" on public.attendance
  for all to authenticated
  using (public.is_staff())
  with check (public.is_staff());

create policy "attendance_teacher_rw" on public.attendance
  for all to authenticated
  using (
    exists (
      select 1 from public.groups g
      where g.id = attendance.group_id
        and public.group_involves_teacher(
          g,
          (select teacher_id from public.profiles where id = auth.uid())
        )
    )
  )
  with check (
    exists (
      select 1 from public.groups g
      where g.id = attendance.group_id
        and public.group_involves_teacher(
          g,
          (select teacher_id from public.profiles where id = auth.uid())
        )
    )
  );

-- Bot service_role bilan yozadi; CRM faqat ko‘radi
create policy "telegram_links_staff_select" on public.telegram_links
  for select to authenticated
  using (public.is_staff());

-- Realtime (Telegram bot eslatmalari)
do $$
begin
  alter publication supabase_realtime add table public.attendance;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.payments;
exception when duplicate_object then null;
end $$;

alter table public.attendance replica identity full;
alter table public.payments replica identity full;

-- ============================================================
-- 12) Seed rollar (Auth userlar bo‘lsa)
-- ============================================================
update public.profiles
set name = 'Tizim Egasi', role = 'owner', username = 'owner'
where id = (select id from auth.users where email = 'owner@kamol.school');

update public.profiles
set name = 'Administrator', role = 'admin', username = 'admin'
where id = (select id from auth.users where email = 'admin@kamol.school');

-- Mavjud Auth userlar uchun profil yo‘q bo‘lsa — yaratish
insert into public.profiles (id, username, name, role)
select
  u.id,
  coalesce(u.raw_user_meta_data->>'username', split_part(u.email, '@', 1)),
  coalesce(u.raw_user_meta_data->>'name', split_part(u.email, '@', 1)),
  coalesce(u.raw_user_meta_data->>'role', 'admin')
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;

update public.profiles
set name = 'Tizim Egasi', role = 'owner', username = 'owner'
where id = (select id from auth.users where email = 'owner@kamol.school');

update public.profiles
set name = 'Administrator', role = 'admin', username = 'admin'
where id = (select id from auth.users where email = 'admin@kamol.school');
