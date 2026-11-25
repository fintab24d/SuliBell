-- 3.8 (Újrakezdés): meglévő nevek, profilok és napi/heti/havi aréna eredmények teljes törlése
delete from public.arena_scores;
delete from public.player_profile_secrets;
delete from public.player_profiles;
