-- 3.5: "Csak zenék kivétele" ('music_mod') korlátozott admin jogosultság + RLS/RPC szigorítások

-- 1. set_member: 'music_mod' terület engedélyezése
create or replace function set_member(sid uuid, p_email text, p_perms text[]) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not is_full_admin(sid) then raise exception 'Csak teljes jogú admin módosíthat jogosultságot'; end if;
  if p_perms is not null and not (p_perms <@ array['ai','menu','changes','announcements','calendar','schedules','settings','polls','videos','music_mod','push']) then raise exception 'Ismeretlen terület'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then raise exception 'Nincs ilyen felhasználó. Előbb hozd létre a Supabase Authentication → Users részén.'; end if;
  insert into school_members(user_id, school_id, perms) values (uid, sid, p_perms)
    on conflict (user_id, school_id) do update set perms = excluded.perms;
  if not exists (select 1 from school_members where school_id = sid and perms is null) then raise exception 'Legalább egy teljes jogú adminnak maradnia kell'; end if;
end $$;

-- 2. jukebox_songs RLS és RPC-k szigorítása ('videos' vagy 'music_mod' területre)
drop policy if exists jukebox_songs_admin on jukebox_songs;
create policy jukebox_songs_admin on jukebox_songs
  for all to authenticated
  using (can_edit(school_id, 'videos') or can_edit(school_id, 'music_mod'))
  with check (can_edit(school_id, 'videos') or can_edit(school_id, 'music_mod'));

create or replace function admin_delete_jukebox_song(
  p_school uuid,
  p_day date,
  p_id text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (can_edit(p_school, 'videos') or can_edit(p_school, 'music_mod')) then
    raise exception 'Nincs jogosultság a zene törléséhez.';
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
  if not (can_edit(p_school, 'videos') or can_edit(p_school, 'music_mod')) then
    raise exception 'Nincs jogosultság a zenék törléséhez.';
  end if;

  update jukebox_songs
  set deleted = true
  where school_id = p_school and day = p_day;
end $$;

create or replace function delete_jukebox_song(p_school uuid, p_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (can_edit(p_school, 'videos') or can_edit(p_school, 'music_mod')) then return; end if;
  delete from jukebox_songs where school_id = p_school and song_id = p_id;
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
  if can_edit(p_school, 'videos') or can_edit(p_school, 'music_mod') then
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

-- 3. arena_scores szigorítása ('music_mod'-only admin ne törölhessen toplistát)
drop policy if exists arena_scores_delete on arena_scores;
drop policy if exists arena_scores_admin_delete on arena_scores;
create policy arena_scores_admin_delete on arena_scores
  for delete to authenticated
  using (can_edit(school_id, 'videos') or can_edit(school_id, 'settings'));

create or replace function delete_arena_score(
  p_school uuid,
  p_day date,
  p_player text,
  p_mode text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (can_edit(p_school, 'videos') or can_edit(p_school, 'settings')) then return; end if;
  delete from arena_scores
  where school_id = p_school and day = p_day and player_id = p_player and mode = p_mode;
end $$;

create or replace function clear_arena_scores(
  p_school uuid,
  p_day date
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (can_edit(p_school, 'videos') or can_edit(p_school, 'settings')) then return; end if;
  delete from arena_scores
  where school_id = p_school and day = p_day;
end $$;

-- 4. announcements policy frissítése (SuliRádió és AutoMod szabályok + music_mod tiltás)
drop policy if exists admin_write on announcements;
create policy admin_write on announcements
  for all to authenticated
  using (
    can_edit(school_id, 'announcements')
    or (can_edit(school_id, 'videos') and (text like '__RADIO__:%' or text like '__BANNED_WORDS__:%'))
    or (can_edit(school_id, 'settings') and (text like '__MAINT__:%' or text like '__BANNED_WORDS__:%'))
  )
  with check (
    can_edit(school_id, 'announcements')
    or (can_edit(school_id, 'videos') and (text like '__RADIO__:%' or text like '__BANNED_WORDS__:%'))
    or (can_edit(school_id, 'settings') and (text like '__MAINT__:%' or text like '__BANNED_WORDS__:%'))
  );
