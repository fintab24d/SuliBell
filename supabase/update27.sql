-- 3.7: Központi játékosprofil és egyedi játékosnév-foglalás (ismétlődő nevek tiltása)

create table if not exists public.player_profiles (
  school_id uuid not null,
  player_id text not null,
  player_name text not null,
  name_key text not null,
  updated_at timestamptz not null default now(),
  primary key (school_id, player_id)
);

create unique index if not exists player_profiles_school_name_key_uidx
  on public.player_profiles (school_id, name_key);

alter table public.player_profiles enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'player_profiles'
      and policyname = 'player_profiles_read'
  ) then
    create policy "player_profiles_read" on public.player_profiles
      for select to anon, authenticated
      using (true);
  end if;
end $$;

create or replace function public.normalize_player_key(p_name text)
returns text
language sql immutable
as $$
  select translate(
    regexp_replace(lower(trim(coalesce(p_name, ''))), '\s+', ' ', 'g'),
    'áéíóöőúüű',
    'aeiooouuu'
  )
$$;

create or replace function public.claim_player_name(
  p_school uuid,
  p_player text,
  p_name text,
  p_name_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_name text;
  v_key text;
begin
  v_name := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_key := coalesce(nullif(trim(coalesce(p_name_key, '')), ''), public.normalize_player_key(v_name));

  if v_name = '' or v_key = '' or length(v_name) > 24 then
    return jsonb_build_object('ok', false, 'error', 'invalid_name');
  end if;

  if exists (
    select 1
    from public.player_profiles
    where school_id = p_school
      and name_key = v_key
      and player_id <> p_player
  ) then
    return jsonb_build_object('ok', false, 'error', 'name_taken');
  end if;

  if exists (
    select 1
    from public.arena_scores
    where school_id = p_school
      and day >= (current_date - 30)
      and public.normalize_player_key(player_name) = v_key
      and player_id <> p_player
  ) then
    return jsonb_build_object('ok', false, 'error', 'name_taken');
  end if;

  insert into public.player_profiles(school_id, player_id, player_name, name_key, updated_at)
    values (p_school, p_player, v_name, v_key, now())
    on conflict (school_id, player_id)
    do update set
      player_name = excluded.player_name,
      name_key = excluded.name_key,
      updated_at = now();

  update public.arena_scores
    set player_name = v_name
    where school_id = p_school
      and day >= (current_date - 1)
      and player_id = p_player;

  return jsonb_build_object('ok', true, 'name', v_name, 'name_key', v_key);
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'name_taken');
end $$;

create or replace function public.submit_arena_score(
  p_school uuid,
  p_day date,
  p_player text,
  p_name text,
  p_mode text,
  p_score int
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_name text;
  v_key text;
  v_claimed text;
begin
  if p_score <= 0 or p_score > 5000 or p_mode not in ('reflex', 'quiz', 'snake') then
    return;
  end if;

  select player_name into v_claimed
  from public.player_profiles
  where school_id = p_school and player_id = p_player;

  v_name := coalesce(nullif(trim(v_claimed), ''), regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'));
  v_key := public.normalize_player_key(v_name);

  if v_name = '' or v_key = '' then
    return;
  end if;

  if exists (
    select 1
    from public.player_profiles
    where school_id = p_school
      and name_key = v_key
      and player_id <> p_player
  ) then
    return;
  end if;

  if v_claimed is null then
    insert into public.player_profiles(school_id, player_id, player_name, name_key, updated_at)
      values (p_school, p_player, v_name, v_key, now())
      on conflict do nothing;
  end if;

  insert into arena_scores(school_id, day, player_id, player_name, mode, score)
    values (p_school, p_day, p_player, v_name, p_mode, p_score)
    on conflict (school_id, day, player_id, mode)
    do update set
      score = greatest(arena_scores.score, excluded.score),
      player_name = excluded.player_name,
      created_at = case when excluded.score > arena_scores.score then now() else arena_scores.created_at end;
end $$;

grant execute on function public.normalize_player_key(text) to anon, authenticated;
grant execute on function public.claim_player_name(uuid, text, text, text) to anon, authenticated;
grant execute on function public.submit_arena_score(uuid, date, text, text, text, int) to anon, authenticated;
