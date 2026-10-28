-- 3.1: AI-asszisztens (Gemini). Futtasd az update13.sql után.
alter table settings add column if not exists ask_enabled boolean not null default false;

-- Kérdés-napló a visszaélés elleni korláthoz (csak az eszköz ujjlenyomata, szöveg nem kerül tárolásra).
create table if not exists ask_log (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  created_at timestamptz not null default now()
);
create index if not exists ask_log_idx on ask_log(ip_hash, created_at);
create index if not exists ask_log_time_idx on ask_log(created_at);
alter table ask_log enable row level security;   -- szándékosan nincs szabály: csak az Edge Function (service role) éri el
