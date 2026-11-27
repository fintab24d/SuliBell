-- Ünnep ('holiday') visszaszámláló fajta hozzáadása a countdowns táblához
alter table public.countdowns drop constraint if exists countdowns_kind_check;
alter table public.countdowns add constraint countdowns_kind_check check (kind in ('summer','autumn','winter','spring','holiday','other'));
