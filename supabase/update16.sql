-- 3.3: AI-asszisztens külön jogosultsága ('ai' terület). Futtasd az update15.sql után.
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
