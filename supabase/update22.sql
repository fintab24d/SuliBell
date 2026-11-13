-- Látogatottsági statisztika (napi bontás, / és /display útvonalanként)
create table if not exists public.visit_stats (
  school_id uuid not null references public.schools(id) on delete cascade,
  day date not null,
  path text not null,
  views integer not null default 0,
  unique_visitors integer not null default 0,
  primary key (school_id, day, path)
);

alter table public.visit_stats enable row level security;

drop policy if exists "School members can view visit stats" on public.visit_stats;
create policy "School members can view visit stats"
  on public.visit_stats
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.school_members m
      where m.school_id = visit_stats.school_id
        and m.user_id = auth.uid()
    )
  );

create or replace function public.track_visit(
  p_school_id uuid,
  p_path text,
  p_is_unique boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := (now() AT TIME ZONE 'Europe/Budapest')::date;
  v_path text := case
    when p_path like '/display%' then '/display'
    when p_path like '/telepites%' then '/telepites'
    else '/'
  end;
begin
  if p_school_id is null then
    return;
  end if;

  insert into public.visit_stats (school_id, day, path, views, unique_visitors)
  values (
    p_school_id,
    v_day,
    v_path,
    1,
    case when p_is_unique then 1 else 0 end
  )
  on conflict (school_id, day, path)
  do update set
    views = visit_stats.views + 1,
    unique_visitors = visit_stats.unique_visitors + case when p_is_unique then 1 else 0 end;
end;
$$;

revoke all on function public.track_visit(uuid, text, boolean) from public;
grant execute on function public.track_visit(uuid, text, boolean) to anon, authenticated;
