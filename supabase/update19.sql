-- SuliBell update19: Szavazatok egyedisége (1 szavazat / ember) és napváltási takarítás
create table if not exists jukebox_votes (
  school_id uuid not null,
  day date not null,
  song_id text not null,
  voter_id text not null,
  created_at timestamptz default now(),
  primary key (school_id, day, song_id, voter_id)
);

create or replace function vote_jukebox_song(
  p_school uuid,
  p_day date,
  p_id text,
  p_voter text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_voter is null or length(trim(p_voter)) = 0 then
    return;
  end if;

  insert into jukebox_votes(school_id, day, song_id, voter_id)
    values (p_school, p_day, p_id, p_voter)
    on conflict do nothing;

  if not found then
    return; -- Már szavazott ez a felhasználó
  end if;

  update jukebox_songs
  set votes = votes + 1
  where school_id = p_school and day = p_day and song_id = p_id;
end $$;

grant execute on function vote_jukebox_song(uuid, date, text, text) to anon, authenticated;
grant all on table jukebox_votes to anon, authenticated;
