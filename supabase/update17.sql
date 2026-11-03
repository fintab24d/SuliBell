-- 3.4: Élő Hangulatfal (Emoji-reakciók) és Szüneti Mini-Aréna napi toplista. Futtasd az update16.sql után.

create table if not exists school_vibes (
  school_id uuid not null references schools(id) on delete cascade,
  day date not null,
  vibe text not null check (vibe in ('fire','party','sleep','mind','coffee','love')),
  cnt int not null default 0,
  primary key (school_id, day, vibe)
);

alter table school_vibes enable row level security;
drop policy if exists school_vibes_read on school_vibes;
create policy school_vibes_read on school_vibes for select using (true);

create or replace function add_vibe(p_school uuid, p_day date, p_vibe text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_vibe not in ('fire','party','sleep','mind','coffee','love') then return; end if;
  insert into school_vibes(school_id, day, vibe, cnt) values (p_school, p_day, p_vibe, 1)
    on conflict (school_id, day, vibe) do update set cnt = school_vibes.cnt + 1;
end $$;

create or replace function get_vibe_counts(p_school uuid, p_day date)
returns table(vibe text, cnt int)
language sql security definer stable set search_path = public as $$
  select vibe, cnt from school_vibes where school_id = p_school and day = p_day
$$;

grant execute on function add_vibe(uuid, date, text), get_vibe_counts(uuid, date) to anon, authenticated;

-- Szüneti Mini-Aréna napi toplista
create table if not exists arena_scores (
  school_id uuid not null references schools(id) on delete cascade,
  day date not null,
  player_id text not null check (length(player_id) between 4 and 64),
  player_name text not null check (length(player_name) between 1 and 24),
  mode text not null check (mode in ('reflex','quiz')),
  score int not null check (score > 0 and score <= 5000),
  created_at timestamptz not null default now(),
  primary key (school_id, day, player_id, mode)
);

alter table arena_scores enable row level security;
drop policy if exists arena_scores_read on arena_scores;
create policy arena_scores_read on arena_scores for select using (true);

create or replace function submit_arena_score(
  p_school uuid,
  p_day date,
  p_player text,
  p_name text,
  p_mode text,
  p_score int
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_score <= 0 or p_score > 5000 or p_mode not in ('reflex','quiz') then return; end if;
  insert into arena_scores(school_id, day, player_id, player_name, mode, score)
    values (p_school, p_day, p_player, trim(p_name), p_mode, p_score)
    on conflict (school_id, day, player_id, mode)
    do update set
      score = greatest(arena_scores.score, excluded.score),
      player_name = excluded.player_name,
      created_at = case when excluded.score > arena_scores.score then now() else arena_scores.created_at end;
end $$;

create or replace function get_arena_leaderboard(p_school uuid, p_day date)
returns table(player_id text, player_name text, mode text, score int, created_at timestamptz)
language sql security definer stable set search_path = public as $$
  select player_id, player_name, mode, score, created_at
  from arena_scores
  where school_id = p_school and day = p_day
  order by score desc, created_at asc
  limit 20
$$;

grant execute on function submit_arena_score(uuid, date, text, text, text, int), get_arena_leaderboard(uuid, date) to anon, authenticated;
