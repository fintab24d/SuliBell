# SuliBell Discord Zenelejátszó Bot

Önálló Node.js zenelejátszó bot a SuliBell Discord szerverhez:
- **Támogatott források:** YouTube (dal & playlist), **Spotify** (dal, album, playlist), **SoundCloud** (dal & set/playlist), **Apple Music** (dal, album, playlist), valamint szöveges keresés.
- **Saját mentett playlistek:** létrehozhatsz, bővíthetsz és egyetlen paranccsal elindíthatsz szerver-szintű playlisteket (`playlists.json`).
- **Kettős vezérlés:** teljes slash (`/play`, `/playlist ...`) és `!` prefix parancs támogatás.

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

- `/play <link vagy keresés>` vagy `!play <link vagy keresés>` — YouTube, Spotify, SoundCloud, Apple Music dal/album/playlist indítása
- `/playlist create <név>` — új saját playlist létrehozása
- `/playlist add <név> <link vagy cím>` — dal vagy külső playlist hozzáadása
- `/playlist play <név>` — mentett playlist lejátszása
- `/playlist show <név>` / `/playlist list` / `/playlist delete <név>` (prefix: `!pl ...`)
- `/skip`, `/pause`, `/resume`, `/stop`, `/shuffle`, `/loop off|track|queue`, `/queue`, `/np`, `/leave`, `/help`
