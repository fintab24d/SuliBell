-- Update 20: Aréna toplista moderáció és pontszámtörlés adminoknak

create or replace function delete_arena_score(
  p_school uuid,
  p_day date,
  p_player text,
  p_mode text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_school_admin(p_school) then return; end if;
  delete from arena_scores
  where school_id = p_school and day = p_day and player_id = p_player and mode = p_mode;
end $$;

create or replace function clear_arena_scores(
  p_school uuid,
  p_day date
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_school_admin(p_school) then return; end if;
  delete from arena_scores
  where school_id = p_school and day = p_day;
end $$;

drop policy if exists arena_scores_admin_delete on arena_scores;
create policy arena_scores_admin_delete on arena_scores
for delete to authenticated using (is_school_admin(school_id));

grant execute on function delete_arena_score(uuid, date, text, text), clear_arena_scores(uuid, date) to authenticated;
