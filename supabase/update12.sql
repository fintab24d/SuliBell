-- 3.0: szünet-videók (az admin YouTube- vagy .mp4-linkeket ad meg, szünetben ezek játszódnak). Futtasd az update11.sql után.
create table if not exists break_videos (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  url text not null check (url like 'https://%' and length(url) < 500),
  title text not null default '' check (length(title) < 120),
  created_at timestamptz not null default now()
);
create index if not exists break_videos_school_idx on break_videos(school_id);
alter table break_videos enable row level security;
drop policy if exists bv_read on break_videos;
create policy bv_read on break_videos for select using (true);
drop policy if exists bv_admin on break_videos;
create policy bv_admin on break_videos for all using (is_school_admin(school_id)) with check (is_school_admin(school_id));

alter table settings add column if not exists break_videos boolean not null default true;

drop trigger if exists audit_break_videos on break_videos;
create trigger audit_break_videos after insert or update or delete on break_videos for each row execute function audit_trigger();
