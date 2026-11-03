-- 3.2: Jogosultságok: az admin megadhatja, hogy egy adminisztrátor csak bizonyos részeket szerkeszthessen (pl. csak az étlapot).
-- Futtasd az update14.sql után. A meglévő adminok teljes jogúak maradnak (perms = NULL).
alter table school_members add column if not exists perms text[];   -- NULL = teljes jogú; különben a megengedett területek listája

-- Területek: menu, changes, announcements, calendar, schedules, settings, polls, videos, push
create or replace function can_edit(sid uuid, area text) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from school_members where user_id = auth.uid() and school_id = sid and (perms is null or area = any(perms))) $$;
create or replace function is_full_admin(sid uuid) returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from school_members where user_id = auth.uid() and school_id = sid and perms is null) $$;
grant execute on function can_edit(uuid, text), is_full_admin(uuid) to anon, authenticated;

-- Írási szabályok területenként
do $$
declare r record;
begin
  for r in select * from (values ('schedules','schedules'),('settings','settings'),('closed_days','calendar'),('countdowns','calendar'),
    ('schedule_dates','calendar'),('announcements','announcements'),('changes','changes'),('menus','menu')) v(t, a) loop
    execute format('drop policy if exists admin_write on %I', r.t);
    execute format('create policy admin_write on %I for all using (can_edit(school_id, %L)) with check (can_edit(school_id, %L))', r.t, r.a, r.a);
  end loop;
end $$;
drop policy if exists admin_write on lessons;
create policy admin_write on lessons for all
  using (can_edit((select school_id from schedules s where s.id = schedule_id), 'schedules'))
  with check (can_edit((select school_id from schedules s where s.id = schedule_id), 'schedules'));
drop policy if exists admin_write on schools;
create policy admin_write on schools for all using (is_full_admin(id)) with check (is_full_admin(id));
drop policy if exists polls_admin on polls;
create policy polls_admin on polls for all using (can_edit(school_id, 'polls')) with check (can_edit(school_id, 'polls'));
drop policy if exists bv_admin on break_videos;
create policy bv_admin on break_videos for all using (can_edit(school_id, 'videos')) with check (can_edit(school_id, 'videos'));
drop policy if exists admin_read on push_subscriptions;
create policy admin_read on push_subscriptions for select using (can_edit(school_id, 'push'));
drop policy if exists admin_read on audit_log;
create policy admin_read on audit_log for select using (school_id is not null and is_full_admin(school_id));

-- Feltöltések (logó, csengőhang) a Beállítások területhez tartoznak
drop policy if exists logos_admin_write on storage.objects;
create policy logos_admin_write on storage.objects for all to authenticated
  using (bucket_id = 'logos' and can_edit(((storage.foldername(name))[1])::uuid, 'settings'))
  with check (bucket_id = 'logos' and can_edit(((storage.foldername(name))[1])::uuid, 'settings'));
drop policy if exists sounds_admin_write on storage.objects;
create policy sounds_admin_write on storage.objects for all to authenticated
  using (bucket_id = 'sounds' and can_edit(((storage.foldername(name))[1])::uuid, 'settings'))
  with check (bucket_id = 'sounds' and can_edit(((storage.foldername(name))[1])::uuid, 'settings'));

-- Adminok kezelése (csak teljes jogú admin)
create or replace function list_members(sid uuid) returns table(user_id uuid, email text, perms text[])
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_full_admin(sid) then raise exception 'Csak teljes jogú admin láthatja'; end if;
  return query select m.user_id, u.email::text, m.perms from school_members m join auth.users u on u.id = m.user_id where m.school_id = sid order by u.email;
end $$;

create or replace function set_member(sid uuid, p_email text, p_perms text[]) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not is_full_admin(sid) then raise exception 'Csak teljes jogú admin módosíthat jogosultságot'; end if;
  if p_perms is not null and not (p_perms <@ array['ai','menu','changes','announcements','calendar','schedules','settings','polls','videos','push']) then raise exception 'Ismeretlen terület'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then raise exception 'Nincs ilyen felhasználó. Előbb hozd létre a Supabase Authentication → Users részén.'; end if;
  insert into school_members(user_id, school_id, perms) values (uid, sid, p_perms)
    on conflict (user_id, school_id) do update set perms = excluded.perms;
  if not exists (select 1 from school_members where school_id = sid and perms is null) then raise exception 'Legalább egy teljes jogú adminnak maradnia kell'; end if;
end $$;

create or replace function remove_member(sid uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_full_admin(sid) then raise exception 'Csak teljes jogú admin törölhet'; end if;
  delete from school_members where school_id = sid and user_id = p_user;
  if not exists (select 1 from school_members where school_id = sid and perms is null) then raise exception 'Legalább egy teljes jogú adminnak maradnia kell'; end if;
end $$;
grant execute on function list_members(uuid), set_member(uuid, text, text[]), remove_member(uuid, uuid) to authenticated;
