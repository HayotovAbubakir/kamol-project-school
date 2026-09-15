-- ============================================================
-- KAMOL SCHOOL — FULL CLEANUP (public)
-- Fayl: supabase/cleanup.sql
--
-- Faqat toza o‘rnatish kerak bo‘lganda Run qiling.
-- Diqqat: public dagi barcha app jadvallarini O‘CHIRADI.
-- auth.users (loginlar) O‘CHIRILMAYDI.
--
-- Tartib: avval cleanup.sql, keyin schema.sql
-- Faqat 2 ta SQL: cleanup.sql + schema.sql
-- ============================================================

-- Triggerlar
drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists students_public_code_bi on public.students;

-- Funksiyalar
drop function if exists public.handle_new_user() cascade;
drop function if exists public.lookup_login_email(text) cascade;
drop function if exists public.staff_set_user_password(uuid, text) cascade;
drop function if exists public.is_staff() cascade;
drop function if exists public.current_role() cascade;
drop function if exists public.generate_student_public_code() cascade;
drop function if exists public.students_set_public_code() cascade;
drop function if exists public.group_involves_teacher(public.groups, uuid) cascade;

-- Jadvallar (FK tartibida / cascade)
drop table if exists public.telegram_links cascade;
drop table if exists public.attendance cascade;
drop table if exists public.expenses cascade;
drop table if exists public.salary_payments cascade;
drop table if exists public.payments cascade;
drop table if exists public.group_students cascade;
drop table if exists public.students cascade;
drop table if exists public.groups cascade;
drop table if exists public.rooms cascade;
drop table if exists public.teachers cascade;
drop table if exists public.profiles cascade;
