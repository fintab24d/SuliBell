# AI-asszisztens beállítása (Google Gemini, ingyenes)

Az oldalon megjelenik egy **Kérdezz** gomb. A látogatók az iskola adatairól kérdezhetnek (csengetés, szünetek, ebéd, változások), a választ a Gemini adja az oldal saját adataiból.

1. **Kulcs szerzése:** nyisd meg az <https://aistudio.google.com/apikey> oldalt, jelentkezz be Google-fiókkal, és kattints az **Create API key** gombra. Másold ki a kulcsot.
2. **SQL:** a Supabase **SQL Editor**ban futtasd le a `supabase/update14.sql` fájlt.
3. **Függvény:** Supabase → **Edge Functions** → **Deploy a new function** → név: `ask` → illeszd be a `supabase/functions/ask/index.ts` tartalmát → **Deploy**.
4. **Titok:** Supabase → **Edge Functions** → **Secrets** → új titok: név `GEMINI_API_KEY`, érték a kulcs.
5. **Bekapcsolás:** admin felület → Beállítások → **AI-asszisztens** jelölőnégyzet → mentés.

Nem kötelező titkok: `GEMINI_MODEL` (alap: `gemini-2.5-flash`; ha a Google lecseréli, itt adhatod meg az újat), `ASK_DAILY_CAP` (az egész oldalon naponta legfeljebb ennyi kérdés, alap: 900).

Védelem: eszközönként percenként 6, naponta 60 kérdés lehet. A kérdések szövege nem kerül tárolásra, csak az eszköz ujjlenyomata a korlát számolásához.
