-- ============================================================================
-- SuliBell: Ko-fi Támogatói és VIP Feloldó Rendszer (Supabase SQL + RLS + RPC)
-- ============================================================================

create extension if not exists pgcrypto;

-- 1. VIP kódok tábla (közvetlenül NEM listázható kliensoldalról)
create table if not exists public.vip_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (char_length(btrim(code)) >= 3),
  max_uses integer not null default 2 check (max_uses >= 1),
  used_count integer not null default 0 check (used_count >= 0),
  tier text not null default 'standard' check (tier in ('standard', 'top')),
  created_at timestamptz not null default now()
);

-- Kis- és nagybetű-független egyediség + gyors keresés az RPC számára
create unique index if not exists vip_codes_code_upper_idx
  on public.vip_codes (upper(btrim(code)));

-- 2. Támogatók tábla (nyilvános támogatói fal és pörgő üzenetek)
create table if not exists public.supporters (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) >= 1),
  class_name text,
  message text,
  is_top_tier boolean not null default false,
  is_approved boolean not null default true,
  created_at timestamptz not null default now()
);

-- Részleges index a jóváhagyott támogatók gyors rendezett lekérdezéséhez
create index if not exists supporters_approved_order_idx
  on public.supporters (is_top_tier desc, created_at desc)
  where is_approved = true;

-- 3. Row-Level Security (RLS) bekapcsolása
alter table public.vip_codes enable row level security;
alter table public.supporters enable row level security;

-- Jogosultságok a Data API-hoz
revoke all on public.vip_codes from anon;
revoke all on public.vip_codes from authenticated;
grant select, insert, update, delete on public.vip_codes to authenticated;

revoke all on public.supporters from anon;
revoke all on public.supporters from authenticated;
grant select on public.supporters to anon, authenticated;
grant insert, update, delete on public.supporters to authenticated;

-- RLS szabályok (idempotens létrehozás)
do $$
begin
  -- Supporters: bárki olvashatja a jóváhagyott támogatókat
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'supporters' and policyname = 'supporters_public_read_approved'
  ) then
    create policy "supporters_public_read_approved"
      on public.supporters
      for select
      to anon, authenticated
      using (is_approved = true);
  end if;

  -- Supporters: iskola adminjai (school_members) kezelhetik az összes sort
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'supporters' and policyname = 'supporters_admin_manage'
  ) then
    create policy "supporters_admin_manage"
      on public.supporters
      for all
      to authenticated
      using (
        exists (
          select 1 from public.school_members m where m.user_id = (select auth.uid())
        )
      )
      with check (
        exists (
          select 1 from public.school_members m where m.user_id = (select auth.uid())
        )
      );
  end if;

  -- VIP codes: kliensoldalról anon nem listázhatja; csak az iskola adminjai kezelhetik
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'vip_codes' and policyname = 'vip_codes_admin_manage'
  ) then
    create policy "vip_codes_admin_manage"
      on public.vip_codes
      for all
      to authenticated
      using (
        exists (
          select 1 from public.school_members m where m.user_id = (select auth.uid())
        )
      )
      with check (
        exists (
          select 1 from public.school_members m where m.user_id = (select auth.uid())
        )
      );
  end if;
end $$;

-- 4. Biztonságos RPC függvény a VIP kód atomi ellenőrzéséhez és beváltásához
create or replace function public.verify_vip_code(input_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clean text := upper(btrim(coalesce(input_code, '')));
  v_tier text;
  v_used integer;
  v_max integer;
  v_exists boolean;
begin
  if v_clean = '' then
    return jsonb_build_object('valid', false, 'reason', 'empty');
  end if;

  -- Atomi frissítés: párhuzamos beváltáskor sem léphető túl a max_uses keret
  update public.vip_codes
     set used_count = used_count + 1
   where upper(btrim(code)) = v_clean
     and used_count < max_uses
  returning tier, used_count, max_uses
       into v_tier, v_used, v_max;

  if found then
    return jsonb_build_object(
      'valid', true,
      'tier', v_tier,
      'used_count', v_used,
      'max_uses', v_max
    );
  end if;

  select exists(
    select 1 from public.vip_codes where upper(btrim(code)) = v_clean
  ) into v_exists;

  if v_exists then
    return jsonb_build_object('valid', false, 'reason', 'limit_reached');
  end if;

  return jsonb_build_object('valid', false, 'reason', 'invalid');
end;
$$;

revoke all on function public.verify_vip_code(text) from public;
grant execute on function public.verify_vip_code(text) to anon, authenticated;

-- Realtime engedélyezése a supporters táblára
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'supporters'
    ) then
      alter publication supabase_realtime add table public.supporters;
    end if;
  end if;
end $$;
