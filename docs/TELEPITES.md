# Telepítési útmutató (React + Vite + Supabase)

Oldalak: `/` irányítópult (teljes napi rend), `/display` TV-mód.

## Beüzemelés (kb. 15 perc, 0 Ft)
1. **Supabase projekt:** supabase.com → New project (Free). Várd meg, míg elkészül.
2. **Adatbázis:** bal menü *SQL Editor* → New query → másold be a `supabase/schema.sql` tartalmát → Run. Ez létrehozza a táblákat, az RLS szabályokat és a kezdő csengetési rendet (8 óra, 2026.10.23 és 2026.11.02 tanítás nélküli nappal).
   Utána futtasd le ugyanígy a `supabase/update.sql`-t is (logó-tároló és TV-beállítások).
   Végül futtasd a `supabase/update2.sql`-t is (visszaszámlálók: szünetek, ünnepek; példa adatokkal).
   Majd futtasd a `supabase/update3.sql`-t is (közlemények).
   Végül futtasd a `supabase/update4.sql`-t is (oldal verziója).
   Majd sorban az `update5.sql` (módosítási napló), `update6.sql` (különleges napok, változások, étlap, kiemelt közlemény, tanév), `update7.sql` (időjárás), `update8.sql` (QR-kód) `update9.sql` (saját csengőhang) `update10.sql` (értesítések) `update11.sql` (szavazás) `update12.sql` (szünet-videók) `update13.sql` (pihenő mód) `update14.sql` (AI-asszisztens, lásd `docs/AI.md`) és `update15.sql` (admin jogosultságok).
3. **URL és kulcs:** *Project Settings → API*: ott van a **Project URL** és az **anon / publishable key** (a service_role kulcsot SOHA ne tedd a frontendbe).
4. **Env:** másold a `.env.example`-t `.env` néven, töltsd ki a két értéket.
5. **Helyi indítás:** `npm install` majd `npm run dev` → http://localhost:5173 és /display
6. **Admin:** *Authentication → Users → Add user* (email + jelszó). Majd SQL Editorban:
   `insert into school_members select '<USER_UUID>', id from schools where slug='demo';`
   Ezután csak ez a felhasználó tud írni az iskola adataiba (RLS), a rendeket, ünnepnapokat és beállításokat a `/admin` oldalon (belépés után) szerkesztheti.
7. **Vercel:** töltsd fel GitHubra → vercel.com → Add New Project → importáld → *Environment Variables*-be vidd fel a 3 `VITE_` változót → Deploy.

## Hogyan működik
Az idő számítása `Europe/Budapest` zónában történik (Intl, nyári/téli átállással), a böngésző időzónájától függetlenül; a gép óráját feltételezzük pontosnak (kijelzőn érdemes NTP). A rend a `localStorage`-ba cache-elődik: ha elmegy a net, "Offline mód" jelenik meg, de a nap tovább fut; visszatérő nettel újra szinkronizál (5 percenként is).

## Értesítések beüzemelése (egyszeri, kb. 10 perc)
1. **Kulcspár készítése** a saját gépeden: `npx web-push generate-vapid-keys`. Két kulcsot ír ki: *Public Key* és *Private Key*. A privátot senkinek ne add át, és ne tedd a GitHubra.
2. **Vercel:** *Settings → Environment Variables*: `VITE_VAPID_PUBLIC_KEY` = a Public Key. Utána *Redeploy*.
3. **Supabase függvény:** *Edge Functions → Deploy a new function → Via Editor*, a neve legyen pontosan `send-push`, a tartalma a `supabase/functions/send-push/index.ts` fájl. Deploy.
4. **Titkok:** *Edge Functions → Secrets* (vagy a függvény Secrets oldala): `VAPID_PUBLIC_KEY` (a Public Key), `VAPID_PRIVATE_KEY` (a Private Key), `VAPID_SUBJECT` (pl. `mailto:te@email.hu`).
5. Futtasd le az `update10.sql`-t az SQL Editorban.
6. Próba: az oldalon nyomd meg az **Értesítések** gombot, engedélyezd, majd az `/admin` oldalon az *Értesítések* szekcióban küldj egy próbaüzenetet.

Az értesítés csak az élesített, HTTPS-es oldalon működik. iPhone-on (iOS 16.4 vagy újabb) csak a főképernyőre telepített alkalmazásban.

## Free tier korlátok
- Supabase Free: 500 MB adatbázis, 50 000 havi aktív felhasználó, 5 GB forgalom; **1 hét inaktivitás után a projekt szünetel** (a kijelző 5 perces lekérdezése ezt megelőzi, ha folyamatosan nyitva van).
- Vercel Hobby: nem kereskedelmi célra, 100 GB/hó sávszélesség – egy iskolának bőven elég.
