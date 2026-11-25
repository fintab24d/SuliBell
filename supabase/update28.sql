-- 3.8: 4 jegyű PIN-es többgépes játékosprofil + régi nevek és toplisták tiszta újrakezdése

alter table public.player_profiles
  add column if not exists has_pin boolean not null default false;

create table if not exists public.player_profile_secrets (
  school_id uuid not null,
  player_id text not null,
  pin_hash text not null,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (school_id, player_id)
);

alter table public.player_profile_secrets enable row level security;

create or replace function public.save_player_profile(
  p_school uuid,
  p_player text,
  p_name text,
  p_pin text default null,
  p_name_key text default null
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_name text;
  v_key text;
  v_pin text;
  v_existing record;
  v_mine record;
begin
  v_name := regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g');
  v_key := coalesce(nullif(trim(coalesce(p_name_key, '')), ''), public.normalize_player_key(v_name));
  v_pin := trim(coalesce(p_pin, ''));

  if v_name = '' or v_key = '' or length(v_name) > 24 then
    return jsonb_build_object('ok', false, 'error', 'invalid_name');
  end if;

  select player_id, player_name, has_pin
    into v_existing
  from public.player_profiles
  where school_id = p_school and name_key = v_key;

  if found and v_existing.player_id <> p_player then
    if v_existing.has_pin then
      return jsonb_build_object(
        'ok', false,
        'error', 'pin_required',
        'existing_name', v_existing.player_name
      );
    end if;

    -- Admin nullázta a PIN-t: az új 4 jegyű PIN beállításával átvehető a meglévő player_id
    if v_pin !~ '^\d{4}$' then
      return jsonb_build_object('ok', false, 'error', 'pin_invalid');
    end if;

    insert into public.player_profile_secrets(school_id, player_id, pin_hash, failed_attempts, locked_until, updated_at)
      values (p_school, v_existing.player_id, extensions.crypt(v_pin, extensions.gen_salt('bf', 6)), 0, null, now())
      on conflict (school_id, player_id)
      do update set
        pin_hash = excluded.pin_hash,
        failed_attempts = 0,
        locked_until = null,
        updated_at = now();

    update public.player_profiles
      set player_name = v_name,
          has_pin = true,
          updated_at = now()
      where school_id = p_school and player_id = v_existing.player_id;

    return jsonb_build_object(
      'ok', true,
      'name', v_name,
      'player_id', v_existing.player_id,
      'has_pin', true,
      'adopted', true
    );
  end if;

  select player_id, has_pin
    into v_mine
  from public.player_profiles
  where school_id = p_school and player_id = p_player;

  if found then
    if v_pin <> '' and v_pin !~ '^\d{4}$' then
      return jsonb_build_object('ok', false, 'error', 'pin_invalid');
    end if;
    if v_pin = '' and not v_mine.has_pin then
      return jsonb_build_object('ok', false, 'error', 'pin_invalid');
    end if;

    update public.player_profiles
      set player_name = v_name,
          name_key = v_key,
          has_pin = true,
          updated_at = now()
      where school_id = p_school and player_id = p_player;

    if v_pin <> '' then
      insert into public.player_profile_secrets(school_id, player_id, pin_hash, failed_attempts, locked_until, updated_at)
        values (p_school, p_player, extensions.crypt(v_pin, extensions.gen_salt('bf', 6)), 0, null, now())
        on conflict (school_id, player_id)
        do update set
          pin_hash = excluded.pin_hash,
          failed_attempts = 0,
          locked_until = null,
          updated_at = now();
    end if;

    update public.arena_scores
      set player_name = v_name
      where school_id = p_school
        and day >= (current_date - 30)
        and player_id = p_player;

    return jsonb_build_object('ok', true, 'name', v_name, 'player_id', p_player, 'has_pin', true);
  end if;

  -- Vadonatúj profil létrehozása: kötelező 4 jegyű PIN
  if v_pin !~ '^\d{4}$' then
    return jsonb_build_object('ok', false, 'error', 'pin_invalid');
  end if;

  insert into public.player_profiles(school_id, player_id, player_name, name_key, has_pin, updated_at)
    values (p_school, p_player, v_name, v_key, true, now());

  insert into public.player_profile_secrets(school_id, player_id, pin_hash, failed_attempts, locked_until, updated_at)
    values (p_school, p_player, extensions.crypt(v_pin, extensions.gen_salt('bf', 6)), 0, null, now())
    on conflict (school_id, player_id)
    do update set
      pin_hash = excluded.pin_hash,
      failed_attempts = 0,
      locked_until = null,
      updated_at = now();

  return jsonb_build_object('ok', true, 'name', v_name, 'player_id', p_player, 'has_pin', true);
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'pin_required');
end $$;

create or replace function public.login_player_profile(
  p_school uuid,
  p_name text,
  p_pin text
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_key text;
  v_pin text;
  v_prof record;
  v_sec record;
  v_fails int;
begin
  v_key := public.normalize_player_key(p_name);
  v_pin := trim(coalesce(p_pin, ''));

  if v_key = '' then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select player_id, player_name, has_pin
    into v_prof
  from public.player_profiles
  where school_id = p_school and name_key = v_key;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select pin_hash, failed_attempts, locked_until
    into v_sec
  from public.player_profile_secrets
  where school_id = p_school and player_id = v_prof.player_id;

  if not found or not v_prof.has_pin then
    return jsonb_build_object('ok', false, 'error', 'no_pin');
  end if;

  if v_sec.locked_until is not null and v_sec.locked_until > now() then
    return jsonb_build_object(
      'ok', false,
      'error', 'locked',
      'retry_sec', greatest(1, ceil(extract(epoch from (v_sec.locked_until - now())))::int)
    );
  end if;

  if v_pin ~ '^\d{4}$' and extensions.crypt(v_pin, v_sec.pin_hash) = v_sec.pin_hash then
    update public.player_profile_secrets
      set failed_attempts = 0,
          locked_until = null,
          updated_at = now()
      where school_id = p_school and player_id = v_prof.player_id;

    return jsonb_build_object(
      'ok', true,
      'player_id', v_prof.player_id,
      'name', v_prof.player_name,
      'has_pin', true
    );
  end if;

  v_fails := coalesce(v_sec.failed_attempts, 0) + 1;
  if v_fails >= 5 then
    update public.player_profile_secrets
      set failed_attempts = 0,
          locked_until = now() + interval '5 minutes',
          updated_at = now()
      where school_id = p_school and player_id = v_prof.player_id;

    return jsonb_build_object('ok', false, 'error', 'locked', 'retry_sec', 300);
  end if;

  update public.player_profile_secrets
    set failed_attempts = v_fails,
        updated_at = now()
    where school_id = p_school and player_id = v_prof.player_id;

  return jsonb_build_object('ok', false, 'error', 'wrong_pin', 'attempts_left', 5 - v_fails);
end $$;

create or replace function public.admin_reset_player_pin(
  p_school uuid,
  p_player text
) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not (public.can_edit(p_school, 'videos') or public.can_edit(p_school, 'settings')) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  delete from public.player_profile_secrets
  where school_id = p_school and player_id = p_player;

  update public.player_profiles
    set has_pin = false,
        updated_at = now()
    where school_id = p_school and player_id = p_player;

  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_delete_player_profile(
  p_school uuid,
  p_player text,
  p_delete_scores boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not (public.can_edit(p_school, 'videos') or public.can_edit(p_school, 'settings')) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  delete from public.player_profile_secrets
  where school_id = p_school and player_id = p_player;

  delete from public.player_profiles
  where school_id = p_school and player_id = p_player;

  if p_delete_scores then
    delete from public.arena_scores
    where school_id = p_school and player_id = p_player;
  end if;

  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_reset_all_arena_and_profiles(
  p_school uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_edit(p_school, 'settings') then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  delete from public.arena_scores where school_id = p_school;
  delete from public.player_profile_secrets where school_id = p_school;
  delete from public.player_profiles where school_id = p_school;

  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.save_player_profile(uuid, text, text, text, text) to anon, authenticated;
grant execute on function public.login_player_profile(uuid, text, text) to anon, authenticated;
grant execute on function public.admin_reset_player_pin(uuid, text) to authenticated;
grant execute on function public.admin_delete_player_profile(uuid, text, boolean) to authenticated;
grant execute on function public.admin_reset_all_arena_and_profiles(uuid) to authenticated;
