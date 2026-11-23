-- Saját napi Zenegép-szavazatok biztonságos lekérdezése voter_id alapján (RLS mellett is)
create or replace function public.get_my_jukebox_votes(
  p_school uuid,
  p_day date,
  p_voter text
)
returns table(song_id text)
language sql
stable
security definer
set search_path = public
as $$
  select jv.song_id
  from public.jukebox_votes jv
  where jv.school_id = p_school
    and jv.day = p_day
    and jv.voter_id = p_voter;
$$;

grant execute on function public.get_my_jukebox_votes(uuid, date, text) to anon, authenticated;
