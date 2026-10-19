-- 3.0: Pihenő mód kapcsolója (hétvégén, ünnepen, szünetben vicces üzenet + visszaszámláló + Snake). Futtasd az update12.sql után.
alter table settings add column if not exists rest_mode boolean not null default true;
