# SuliBell Discord Zenelejátszó Bot

Önálló Node.js zenelejátszó bot a SuliBell Discord szerverhez (YouTube keresés, linkek, lejátszási listák, várólista, slash `/` és `!` parancsok).

## Beállítás (egyszeri)

1. Nyisd meg a [Discord Developer Portal](https://discord.com/developers/applications) oldalt, és válaszd ki a SuliBell botodat.
2. A **Bot** fülön kapcsold be a **Message Content Intent** kapcsolót (hogy a `!play` parancsok is működjenek; a `/play` enélkül is megy).
3. Győződj meg róla, hogy a botnak megvannak a **Connect** és **Speak** jogosultságai a hangcsatornákhoz.
4. Lépj be a `discord-bot` mappába és telepítsd a csomagokat:
   ```bash
   cd discord-bot
   npm install
   ```
5. Másold le a `.env.example` fájlt `.env` névre, és írd bele a Discord Bot Tokent (`DISCORD_BOT_TOKEN`).
6. Indítás:
   ```bash
   npm start
   ```

## Parancsok

- `/play <dal vagy YouTube link>` vagy `!play <dal vagy YouTube link>`
- `/skip` vagy `!skip` — jelenlegi dal átugrása
- `/pause` / `/resume` — szüneteltetés / folytatás
- `/stop` — leállítás és várólista törlése
- `/queue` — várólista megtekintése
- `/np` — éppen szóló dal
- `/leave` — kilépés a hangcsatornából
- `/help` — súgó

## 24/7 futtatás
Mivel a hangfolyam folyamatos WebSocket + UDP kapcsolatot igényel, a botot érdemes saját gépen, egy olcsó VPS-en (pl. Oracle Free Tier / Hetzner), vagy Render/Railway/Fly.io worker-ként futtatni (a Supabase Edge Function nem tud folyamatos hangcsatornában maradni).
