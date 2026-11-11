-- Update 21: Központosított szinkronizáció, szerver oldali videó/zene törlés (tombstone), .mp4 támogatás és Realtime publikáció

alter table jukebox_songs
  add column if not exists kind text not null default 'music',
  add column if not exists media_url text,
  add column if not exists deleted boolean not null default false;

create index if not exists jukebox_songs_day_deleted_idx
  on jukebox_songs(school_id, day, deleted);

create or replace function get_jukebox_songs(p_school uuid, p_day date)
returns table(song_id text, title text, requester text, yt_id text, votes int, created_at timestamptz)
language sql security definer stable set search_path = public as $$
  select song_id, title, requester, yt_id, votes, created_at
  from jukebox_songs
  where school_id = p_school and day = p_day and deleted = false
  order by votes desc, created_at asc
  limit 20
$$;

create or replace function get_jukebox_state(p_school uuid, p_day date)
returns table(song_id text, title text, requester text, yt_id text, media_url text, kind text, votes int, deleted boolean, created_at timestamptz)
language sql security definer stable set search_path = public as $$
  select song_id, title, requester, yt_id, media_url, kind, votes, deleted, created_at
  from jukebox_songs
  where school_id = p_school and day = p_day
  order by votes desc, created_at asc
  limit 60
$$;

create or replace function submit_jukebox_wish(
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
  from jukebox_songs
  where school_id = p_school and day = p_day and song_id = p_id;

  if v_deleted is true then
    return;
  end if;

  insert into jukebox_songs(school_id, day, song_id, title, requester, yt_id, media_url, kind, votes, deleted)
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
      false
    )
    on conflict (school_id, day, song_id) do nothing;

  if p_voter is not null and length(trim(p_voter)) > 0 then
    insert into jukebox_votes(school_id, day, song_id, voter_id)
      values (p_school, p_day, p_id, p_voter)
      on conflict do nothing;
  end if;
end $$;

create or replace function vote_jukebox_wish(
  p_school uuid,
  p_day date,
  p_id text,
  p_voter text,
  p_title text default null,
  p_by text default null,
  p_yt text default null,
  p_media text default null,
  p_kind text default 'music',
  p_base_votes int default 1
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_deleted boolean;
begin
  if p_voter is null or length(trim(p_voter)) = 0 then return; end if;

  select deleted into v_deleted
  from jukebox_songs
  where school_id = p_school and day = p_day and song_id = p_id;

  if v_deleted is true then
    return;
  end if;

  if not found and length(trim(coalesce(p_title, ''))) > 0 then
    insert into jukebox_songs(school_id, day, song_id, title, requester, yt_id, media_url, kind, votes, deleted)
      values (
        p_school,
        p_day,
        p_id,
        left(trim(p_title), 80),
        left(trim(coalesce(p_by, '')), 32),
        nullif(trim(coalesce(p_yt, '')), ''),
        nullif(trim(coalesce(p_media, '')), ''),
        case when p_kind = 'video' then 'video' else 'music' end,
        greatest(1, coalesce(p_base_votes, 1)),
        false
      )
      on conflict (school_id, day, song_id) do nothing;
  end if;

  insert into jukebox_votes(school_id, day, song_id, voter_id)
    values (p_school, p_day, p_id, p_voter)
    on conflict do nothing;

  if not found then
    return;
  end if;

  update jukebox_songs
  set votes = votes + 1
  where school_id = p_school and day = p_day and song_id = p_id and deleted = false;
end $$;

create or replace function admin_delete_jukebox_song(
  p_school uuid,
  p_day date,
  p_id text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (is_school_admin(p_school) or can_edit(p_school, 'videos')) then
    raise exception 'Nincs adminisztrátori jogosultság a törléshez.';
  end if;

  update jukebox_songs
  set deleted = true
  where school_id = p_school and song_id = p_id;

  if p_day is not null then
    insert into jukebox_songs(school_id, day, song_id, title, requester, votes, deleted)
      values (p_school, p_day, p_id, '(törölve)', '', 0, true)
      on conflict (school_id, day, song_id) do update set deleted = true;
  end if;
end $$;

create or replace function admin_clear_jukebox_day(
  p_school uuid,
  p_day date
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (is_school_admin(p_school) or can_edit(p_school, 'videos')) then
    raise exception 'Nincs adminisztrátori jogosultság a törléshez.';
  end if;

  update jukebox_songs
  set deleted = true
  where school_id = p_school and day = p_day;
end $$;

create or replace function mark_jukebox_played(
  p_school uuid,
  p_day date,
  p_id text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_votes int;
begin
  if is_school_admin(p_school) or can_edit(p_school, 'videos') then
    update jukebox_songs set deleted = true where school_id = p_school and song_id = p_id;
    return;
  end if;

  select votes into v_votes
  from jukebox_songs
  where school_id = p_school and day = p_day and song_id = p_id;

  if coalesce(v_votes, 0) >= 5 or p_id like 'dc-%' then
    insert into jukebox_songs(school_id, day, song_id, title, requester, votes, deleted)
      values (p_school, p_day, p_id, '(lejátszva)', '', greatest(5, coalesce(v_votes, 5)), true)
      on conflict (school_id, day, song_id) do update set deleted = true;
  end if;
end $$;

grant execute on function
  get_jukebox_state(uuid, date),
  submit_jukebox_wish(uuid, date, text, text, text, text, text, text, text),
  vote_jukebox_wish(uuid, date, text, text, text, text, text, text, text, int),
  mark_jukebox_played(uuid, date, text)
  to anon, authenticated;

grant execute on function
  admin_delete_jukebox_song(uuid, date, text),
  admin_clear_jukebox_day(uuid, date)
  to authenticated;

do $$
declare
  t text;
  tbls text[] := array[
    'schools', 'settings', 'schedules', 'lessons', 'closed_days',
    'countdowns', 'announcements', 'schedule_dates', 'changes',
    'menus', 'polls', 'break_videos', 'jukebox_songs', 'arena_scores'
  ];
begin
  foreach t in array tbls loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception
      when duplicate_object then null;
      when undefined_table then null;
    end;
  end loop;
end $$;
