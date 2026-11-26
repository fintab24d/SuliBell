-- 5.1: VIP Zenegép Elsőbbség (2 kérés/szünet, soron kívüli lejátszás és VIP jelvény)

alter table public.jukebox_songs
  add column if not exists is_vip boolean not null default false;

drop function if exists public.submit_jukebox_wish(uuid, date, text, text, text, text, text, text, text);

create or replace function public.submit_jukebox_wish(
  p_school uuid,
  p_day date,
  p_id text,
  p_title text,
  p_by text,
  p_yt text default null,
  p_media text default null,
  p_kind text default 'music',
  p_voter text default null,
  p_vip boolean default false
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_deleted boolean;
begin
  if length(trim(coalesce(p_title, ''))) = 0 then return; end if;

  select deleted into v_deleted
  from public.jukebox_songs
  where school_id = p_school and day = p_day and song_id = p_id;

  if v_deleted is true then
    return;
  end if;

  insert into public.jukebox_songs(
    school_id, day, song_id, title, requester, yt_id, media_url, kind, votes, deleted, approved, approved_at, is_vip
  )
    values (
      p_school,
      p_day,
      p_id,
      left(trim(p_title), 80),
      left(trim(coalesce(p_by, '')), 32),
      nullif(trim(coalesce(p_yt, '')), ''),
      nullif(trim(coalesce(p_media, '')), ''),
      case when p_kind = 'video' then 'video' else 'music' end,
      1,
      false,
      false,
      null,
      coalesce(p_vip, false)
    )
    on conflict (school_id, day, song_id) do nothing;

  if p_voter is not null and length(trim(p_voter)) > 0 then
    insert into public.jukebox_votes(school_id, day, song_id, voter_id)
      values (p_school, p_day, p_id, p_voter)
      on conflict do nothing;
  end if;
end $$;

drop function if exists public.get_jukebox_state(uuid, date);

create or replace function public.get_jukebox_state(p_school uuid, p_day date)
returns table(
  song_id text,
  title text,
  requester text,
  yt_id text,
  media_url text,
  kind text,
  votes integer,
  deleted boolean,
  approved boolean,
  approved_at timestamptz,
  is_vip boolean,
  created_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select
    song_id,
    title,
    requester,
    yt_id,
    media_url,
    kind,
    votes,
    deleted,
    approved,
    approved_at,
    is_vip,
    created_at
  from public.jukebox_songs
  where school_id = p_school and day = p_day
  order by is_vip desc, coalesce(approved_at, created_at) asc, created_at asc
  limit 80
$$;

grant execute on function public.submit_jukebox_wish(uuid, date, text, text, text, text, text, text, text, boolean) to anon, authenticated;
grant execute on function public.get_jukebox_state(uuid, date) to anon, authenticated;
