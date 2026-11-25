-- 5.0: Diák-zenék admin jóváhagyási sora (csak elfogadás után kerülnek a szüneti műsorba)

alter table public.jukebox_songs
  add column if not exists approved boolean not null default true;

alter table public.jukebox_songs
  add column if not exists approved_at timestamptz;

update public.jukebox_songs
  set approved_at = coalesce(approved_at, created_at)
  where approved = true and approved_at is null;

create or replace function public.submit_jukebox_wish(
  p_school uuid,
  p_day date,
  p_id text,
  p_title text,
  p_by text,
  p_yt text default null,
  p_media text default null,
  p_kind text default 'music',
  p_voter text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_deleted boolean;
begin
  if length(trim(coalesce(p_title, ''))) = 0 then return; end if;

  select deleted into v_deleted
  from public.jukebox_songs
  where school_id = p_school and day = p_day and song_id = p_id;

  if v_deleted is true then
    return;
  end if;

  insert into public.jukebox_songs(
    school_id, day, song_id, title, requester, yt_id, media_url, kind, votes, deleted, approved, approved_at
  )
    values (
      p_school,
      p_day,
      p_id,
      left(trim(p_title), 80),
      left(trim(coalesce(p_by, '')), 32),
      nullif(trim(coalesce(p_yt, '')), ''),
      nullif(trim(coalesce(p_media, '')), ''),
      case when p_kind = 'video' then 'video' else 'music' end,
      1,
      false,
      false,
      null
    )
    on conflict (school_id, day, song_id) do nothing;

  if p_voter is not null and length(trim(p_voter)) > 0 then
    insert into public.jukebox_votes(school_id, day, song_id, voter_id)
      values (p_school, p_day, p_id, p_voter)
      on conflict do nothing;
  end if;
end $$;

drop function if exists public.get_jukebox_state(uuid, date);

create or replace function public.get_jukebox_state(p_school uuid, p_day date)
returns table(
  song_id text,
  title text,
  requester text,
  yt_id text,
  media_url text,
  kind text,
  votes integer,
  deleted boolean,
  approved boolean,
  approved_at timestamptz,
  created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    song_id,
    title,
    requester,
    yt_id,
    media_url,
    kind,
    votes,
    deleted,
    approved,
    approved_at,
    created_at
  from public.jukebox_songs
  where school_id = p_school and day = p_day
  order by coalesce(approved_at, created_at) asc, created_at asc
  limit 80
$$;

create or replace function public.get_jukebox_songs(p_school uuid, p_day date)
returns table(
  song_id text,
  title text,
  requester text,
  yt_id text,
  votes integer,
  created_at timestamp with time zone
)
language sql stable security definer set search_path = public as $$
  select song_id, title, requester, yt_id, votes, coalesce(approved_at, created_at) as created_at
  from public.jukebox_songs
  where school_id = p_school and day = p_day and deleted = false and approved = true
  order by coalesce(approved_at, created_at) asc, created_at asc
  limit 40
$$;

create or replace function public.admin_approve_jukebox_song(
  p_school uuid,
  p_day date,
  p_id text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (public.can_edit(p_school, 'videos') or public.can_edit(p_school, 'music_mod')) then
    raise exception 'Nincs jogosultság a zene elfogadásához.';
  end if;

  update public.jukebox_songs
    set approved = true,
        approved_at = coalesce(approved_at, now()),
        deleted = false
    where school_id = p_school and day = p_day and song_id = p_id;
end $$;

grant execute on function public.get_jukebox_state(uuid, date) to anon, authenticated;
grant execute on function public.get_jukebox_songs(uuid, date) to anon, authenticated;
grant execute on function public.submit_jukebox_wish(uuid, date, text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.admin_approve_jukebox_song(uuid, date, text) to authenticated;
