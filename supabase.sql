-- ============================================================
-- QuizMaster Pro - Supabase setup for email OTP authentication
-- Run this whole file in Supabase SQL Editor.
-- ============================================================

create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    name text not null check (char_length(name) between 1 and 80),
    email text not null unique,
    registration_id text not null unique,
    registered_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- A signed-in user can create only their own profile.
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check (auth.uid() = id);

-- A signed-in user can read their own profile.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (auth.uid() = id);

-- Lookup by Registration ID is intentionally exposed because the project
-- specifically requests Registration-ID login without an OTP.
create or replace function public.get_profile_by_registration_id(p_registration_id text)
returns table (
    id uuid,
    name text,
    email text,
    registration_id text
)
language sql
security definer
set search_path = public
as $$
    select p.id, p.name, p.email, p.registration_id
    from public.profiles p
    where upper(p.registration_id) = upper(trim(p_registration_id))
    limit 1;
$$;

grant execute on function public.get_profile_by_registration_id(text) to anon, authenticated;

-- ============================================================
-- EMAIL OTP SETTINGS
-- ============================================================
-- In Supabase Dashboard:
-- Authentication -> Providers -> Email
-- Enable Email provider.
-- Configure the email template to include {{ .Token }} if you want
-- the user to receive a 6-digit OTP rather than a magic-link URL.
-- Also configure your SMTP/email provider for production use.
