-- 3.6: Snake napi toplista + Heti és Havi Nagy Győztesek

alter table public.arena_scores drop constraint if exists arena_scores_mode_check;
alter table public.arena_scores add constraint arena_scores_mode_check check (mode in ('reflex', 'quiz', 'snake'));

create index if not exists arena_scores_school_day_idx on public.arena_scores(school_id, day desc);

create or replace function public.submit_arena_score(
  p_school uuid,
  p_day date,
  p_player text,
  p_name text,
  p_mode text,
  p_score int
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_score <= 0 or p_score > 5000 or p_mode not in ('reflex','quiz','snake') then return; end if;
  insert into arena_scores(school_id, day, player_id, player_name, mode, score)
    values (p_school, p_day, p_player, trim(p_name), p_mode, p_score)
    on conflict (school_id, day, player_id, mode)
    do update set
      score = greatest(arena_scores.score, excluded.score),
      player_name = excluded.player_name,
      created_at = case when excluded.score > arena_scores.score then now() else arena_scores.created_at end;
end $$;

create or replace function public.get_arena_leaderboard(p_school uuid, p_day date)
returns table(player_id text, player_name text, mode text, score int, created_at timestamptz)
language sql security definer stable set search_path = public as $$
  select player_id, player_name, mode, score, created_at
  from arena_scores
  where school_id = p_school and day = p_day
  order by score desc, created_at asc
  limit 45
$$;

create or replace function public.get_arena_champions(p_school uuid, p_day date)
returns table(period text, rank int, player_id text, player_name text, wins int, total_score int)
language sql security definer stable set search_path = public as $$
with bounds as (
  select
    (date_trunc('week', p_day::timestamp)::date - 7) as prev_week_start,
    (date_trunc('week', p_day::timestamp)::date - 1) as prev_week_end,
    date_trunc('week', p_day::timestamp)::date as cur_week_start,
    (date_trunc('month', p_day::timestamp)::date - interval '1 month')::date as prev_month_start,
    (date_trunc('month', p_day::timestamp)::date - 1) as prev_month_end,
    date_trunc('month', p_day::timestamp)::date as cur_month_start
),
ranked_daily as (
  select
    a.day,
    a.mode,
    a.player_id,
    a.player_name,
    a.score,
    a.created_at,
    row_number() over (partition by a.day, a.mode order by a.score desc, a.created_at asc) as rn
  from public.arena_scores a
  cross join bounds b
  where a.school_id = p_school
    and a.day >= least(b.prev_week_start, b.prev_month_start)
    and a.day <= p_day
    and a.score > 0
),
daily_winners as (
  select day, mode, player_id, player_name, score, created_at
  from ranked_daily
  where rn = 1
),
periods as (
  select 'prev_week'::text as period, 1 as max_rank, w.player_id,
    (array_agg(w.player_name order by w.day desc, w.created_at desc))[1] as player_name,
    count(*)::int as wins, sum(w.score)::int as total_score, min(w.created_at) as first_win
  from daily_winners w cross join bounds b
  where w.day between b.prev_week_start and b.prev_week_end
  group by w.player_id
  union all
  select 'cur_week'::text as period, 3 as max_rank, w.player_id,
    (array_agg(w.player_name order by w.day desc, w.created_at desc))[1] as player_name,
    count(*)::int as wins, sum(w.score)::int as total_score, min(w.created_at) as first_win
  from daily_winners w cross join bounds b
  where w.day between b.cur_week_start and p_day
  group by w.player_id
  union all
  select 'prev_month'::text as period, 1 as max_rank, w.player_id,
    (array_agg(w.player_name order by w.day desc, w.created_at desc))[1] as player_name,
    count(*)::int as wins, sum(w.score)::int as total_score, min(w.created_at) as first_win
  from daily_winners w cross join bounds b
  where w.day between b.prev_month_start and b.prev_month_end
  group by w.player_id
  union all
  select 'cur_month'::text as period, 3 as max_rank, w.player_id,
    (array_agg(w.player_name order by w.day desc, w.created_at desc))[1] as player_name,
    count(*)::int as wins, sum(w.score)::int as total_score, min(w.created_at) as first_win
  from daily_winners w cross join bounds b
  where w.day between b.cur_month_start and p_day
  group by w.player_id
),
ordered as (
  select
    period,
    max_rank,
    row_number() over (partition by period order by wins desc, total_score desc, first_win asc)::int as rank,
    player_id,
    player_name,
    wins,
    total_score
  from periods
)
select period, rank, player_id, player_name, wins, total_score
from ordered
where rank <= max_rank
order by period, rank;
$$;

grant execute on function public.submit_arena_score(uuid, date, text, text, text, int), public.get_arena_leaderboard(uuid, date), public.get_arena_champions(uuid, date) to anon, authenticated;
