-- Push-értesítések: a feliratkozott eszközök tárolója. Futtasd az update9.sql után.
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references schools(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  check (endpoint like 'https://%' and length(endpoint) < 1000 and length(p256dh) < 200 and length(auth) < 100)
);
create index if not exists push_subscriptions_school_idx on push_subscriptions(school_id);
alter table push_subscriptions enable row level security;

-- Feliratkozni bárki tud (a látogatók eszközei), de olvasni csak az iskola adminja.
drop policy if exists anyone_subscribe on push_subscriptions;
create policy anyone_subscribe on push_subscriptions for insert to anon, authenticated with check (true);
drop policy if exists admin_read on push_subscriptions;
create policy admin_read on push_subscriptions for select using (is_school_admin(school_id));
-- Törölni csak a küldő függvény tud (service role), amikor egy eszköz már nem érhető el.
