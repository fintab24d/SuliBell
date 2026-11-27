-- 3.9: Elfelejtett PIN-kód jelzése a diákoktól az adminnak

create table if not exists public.pin_reset_requests (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  player_id text not null,
  player_name text not null,
  note text not null default '',
  status text not null default 'pending' check (status in ('pending', 'resolved', 'dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists idx_pin_reset_requests_school_status
  on public.pin_reset_requests (school_id, status, created_at desc);

alter table public.pin_reset_requests enable row level security;

drop policy if exists "admin_read_pin_reset_requests" on public.pin_reset_requests;
create policy "admin_read_pin_reset_requests"
  on public.pin_reset_requests
  for select
  to authenticated
  using (public.can_edit(school_id, 'videos') or public.can_edit(school_id, 'settings'));

grant select on public.pin_reset_requests to authenticated;

create or replace function public.request_pin_reset(
  p_school uuid,
  p_name text,
  p_note text default ''
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_key text;
  v_note text;
  v_prof record;
  v_pending_id uuid;
begin
  v_key := public.normalize_player_key(p_name);
  v_note := left(trim(coalesce(p_note, '')), 140);

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

  if not v_prof.has_pin then
    return jsonb_build_object('ok', false, 'error', 'already_reset', 'name', v_prof.player_name);
  end if;

  select id
    into v_pending_id
  from public.pin_reset_requests
  where school_id = p_school
    and player_id = v_prof.player_id
    and status = 'pending'
  order by created_at desc
  limit 1;

  if found then
    if v_note <> '' then
      update public.pin_reset_requests
        set note = v_note
        where id = v_pending_id;
    end if;
    return jsonb_build_object('ok', true, 'already_pending', true, 'name', v_prof.player_name);
  end if;

  insert into public.pin_reset_requests (school_id, player_id, player_name, note, status)
    values (p_school, v_prof.player_id, v_prof.player_name, v_note, 'pending');

  return jsonb_build_object('ok', true, 'already_pending', false, 'name', v_prof.player_name);
end $$;

create or replace function public.admin_dismiss_pin_reset(
  p_school uuid,
  p_request_id uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not (public.can_edit(p_school, 'videos') or public.can_edit(p_school, 'settings')) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  update public.pin_reset_requests
    set status = 'dismissed',
        resolved_at = now()
    where id = p_request_id
      and school_id = p_school
      and status = 'pending';

  return jsonb_build_object('ok', true);
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

  update public.pin_reset_requests
    set status = 'resolved',
        resolved_at = now()
    where school_id = p_school
      and player_id = p_player
      and status = 'pending';

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

  update public.pin_reset_requests
    set status = 'resolved',
        resolved_at = now()
    where school_id = p_school
      and player_id = p_player
      and status = 'pending';

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
  update public.pin_reset_requests
    set status = 'resolved',
        resolved_at = now()
    where school_id = p_school and status = 'pending';

  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.request_pin_reset(uuid, text, text) from public;
grant execute on function public.request_pin_reset(uuid, text, text) to anon, authenticated;

revoke all on function public.admin_dismiss_pin_reset(uuid, uuid) from public;
grant execute on function public.admin_dismiss_pin_reset(uuid, uuid) to authenticated;

revoke all on function public.admin_reset_player_pin(uuid, text) from public;
grant execute on function public.admin_reset_player_pin(uuid, text) to authenticated;

revoke all on function public.admin_delete_player_profile(uuid, text, boolean) from public;
grant execute on function public.admin_delete_player_profile(uuid, text, boolean) to authenticated;

revoke all on function public.admin_reset_all_arena_and_profiles(uuid) from public;
grant execute on function public.admin_reset_all_arena_and_profiles(uuid) to authenticated;
