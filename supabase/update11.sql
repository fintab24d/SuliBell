-- 3.0: élő szavazás (a TV-n eredmény + QR, telefonról szavazás). Futtasd az update10.sql után.
create table if not exists polls (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  question text not null check (length(question) between 1 and 200),
  options text[] not null check (array_length(options, 1) between 2 and 6),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
-- Egyszerre egy aktív szavazás lehet iskolánként.
create unique index if not exists polls_one_active on polls(school_id) where active;
create table if not exists poll_votes (
  poll_id uuid not null references polls(id) on delete cascade,
  voter text not null check (length(voter) between 8 and 64),
  opt int not null check (opt between 0 and 5),
  created_at timestamptz not null default now(),
  primary key (poll_id, voter)
);
alter table polls enable row level security;
alter table poll_votes enable row level security;

drop policy if exists polls_read on polls;
create policy polls_read on polls for select using (true);
drop policy if exists polls_admin on polls;
create policy polls_admin on polls for all using (is_school_admin(school_id)) with check (is_school_admin(school_id));
-- A szavazatokat közvetlenül senki nem éri el, csak az alábbi függvényeken át.

create or replace function cast_vote(p_poll uuid, p_opt int, p_voter text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from polls where id = p_poll and active and p_opt < array_length(options, 1)) then
    raise exception 'A szavazás nem aktív';
  end if;
  insert into poll_votes(poll_id, voter, opt) values (p_poll, p_voter, p_opt)
    on conflict (poll_id, voter) do update set opt = excluded.opt;
end $$;

create or replace function poll_counts(p_poll uuid) returns int[]
language sql security definer stable set search_path = public as $$
  select array(select coalesce((select count(*)::int from poll_votes v where v.poll_id = p.id and v.opt = i - 1), 0)
               from polls p, generate_series(1, array_length(p.options, 1)) i where p.id = p_poll order by i)
$$;
grant execute on function cast_vote(uuid, int, text), poll_counts(uuid) to anon, authenticated;

-- Napló (az update5/6 audit_trigger függvényével)
drop trigger if exists audit_polls on polls;
create trigger audit_polls after insert or update or delete on polls for each row execute function audit_trigger();
