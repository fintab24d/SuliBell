-- update18.sql: Zene és videó előnézet kapcsoló a settings táblához
alter table settings add column if not exists preview_disabled boolean not null default false;
