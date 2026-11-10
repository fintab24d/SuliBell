# SuliBell 🔔
> **Iskolai Valós Idejű Csengetési, Tájékoztatási és Közösségi Rendszer**  
> *Hivatalos weboldal:* [sulibell.vercel.app](https://sulibell.vercel.app)  
> *Copyright © 2026 Finta Benjámin (SuliBell). Minden jog fenntartva (All Rights Reserved).*

A **SuliBell** egy modern, valós idejű iskolai csengetési és közösségi webalkalmazás, amely másodperc pontosan mutatja a tanítási órákat, szüneteket, órarendi változásokat, és élménnyé teszi az iskolai mindennapokat a diákok, a tanárok és az iskola vezetősége számára.

> [!TIP]
> **Iskolai PC-kről és laptopokról is elérhető!**  
> Mivel a tanítási időszakban a mobiltelefonokat a diákoknak le kell adniuk, a SuliBell közvetlenül böngészőből futtatható az iskolai géptermek (informatikatermek) számítógépein és laptopokon is a **[sulibell.vercel.app](https://sulibell.vercel.app)** címen telepítés nélkül.

---

## 🚀 Főbb Elérhetőségek és Nézetek

- **Főoldal (`/`)**: 3 oszlopos Bento Dashboard élmény telefonon, tableten és asztali böngészőben ([sulibell.vercel.app](https://sulibell.vercel.app)).
- **Folyosói Kijelző / TV Mód (`/display`)**: Fix 100svh felbontású, görgetésmentes nézet folyosói és aulában elhelyezett TV-kijelzőkre, óriási számlappal és QR-kóddal a gyors megnyitáshoz.
- **Adminisztrátori Felület (`/admin`)**: Jelszóval és szerepkörökkel (Tulajdonos, Főadmin, Admin) védett vezérlőpult a csengetési rendek, változások, menük, zenék, előnézet-kapcsolók és rendszerbeállítások kezelésére.
- **Privát Admin Tesztlabor (`/teszt`)**: Valósághű szimulációs környezet az adminoknak időléptetéssel, hó/eső és változások kockázatmentes teszteléséhez (a látogatók nem látják).
- **Alkalmazás Telepítés (`/telepites`)**: Útmutató az alkalmazás kezdőképernyőre való telepítéséhez (PWA).

---

## ✨ Kiemelt Funkciók

### 🕒 Élő Csengetési Számláló & Harangjáték
- **LED Neon számlap**: Színkódolt analóg-digitális ív (óra, szünet, tanítás előtt/után), finoman váltó neon számjegyekkel.
- **10 másodperces finish**: Az utolsó 10 másodpercben pulzáló animáció és csengetési fényhullám.
- **Bővített Iskolai Harangjáték**: 7 hangos melodikus polifónikus szignál harmonikus felhangokkal (~7 másodperces kiterjesztett csengőhang), amely becsengetéskor és kicsengetéskor is tisztán hallható.
- **Okos órarend-követés**: Az elmaradó órákat áthúzva jelöli, és a szünet-visszaszámláló automatikusan átugorja őket a következő tényleges óráig.
- **Nap haladása & Csengetési lista**: Arányos grafikus idősáv és a következő csengetések pontos listája.

### 📚 Személyes Órarend (Saját óráim)
- A diákok és tanárok beállíthatják saját tantárgyaikat és tantermeiket a hét minden napjára.
- **AI-alapú intelligens felismerés**: Bemásolt órarend-szövegből vagy fotó leírásából egy kattintással kitölti a heti órákat és termeket.
- A számlap és a napirend ezután a saját tantárgyat és a terem jelzését (pl. `📍 204. terem`) mutatja.

### 🎵 Szüneti Zenegép & 🎬 Videólejátszó (Jukebox)
- **Különválasztott zene- és videóbeküldés**: Zenéket és 4K videókat külön dedikált űrlapon és Discord csatornán keresztül lehet beküldeni.
- **🗳️ 5 szavazatos aktiválás & 1 ember 1 szavazat**:
  - A szüneti lejátszáshoz **legalább 5 szavazat** szükséges egy zenére vagy videóra. Amíg nem éri el az 5 szavazatot, nem indul el, a felület jelzi a szavazás állását.
  - **1 ember = 1 szavazat**: Egy diák egy számra csak egyetlen szavazatot adhat le (egyedi szavazóazonosítóval a Supabase `jukebox_votes` táblában és helyi tárhelyen védve; az újraküldés sem duplázhat szavazatot).
- **🗑️ Lejátszás utáni automatikus törlés**: Miután egy szám vagy videó lement a szünetben, automatikusan kikerül a beküldött listából, hogy ne ismétlődjön, és helyet adjon az új kívánságoknak.
- **🌅 Napváltáskor tiszta lap**: Éjfélkor / új tanítási nap kezdetén a rendszer automatikusan törli az összes előző napról megmaradt kívánságot, szavazatot és gyorsítótárat — minden nap tiszta listával indul.
- **🛡️ Automatikus Moderációs & NSFW Szűrő**:
  - **Nincs névtelen beküldés**: Kötelező megadni a diák nevét vagy becenevét, anonim módon sem zene, sem videó nem küldhető be.
  - **Káromkodás- és tartalomvédelem**: Beépített magyar és angol nyelvű leetspeak- és ékezetnormalizált szűrő védi a felületet a trágár, alpári vagy kétértelmű kifejezésektől.
  - **Admin AutoMod (Egyéni tiltott szavak)**: Pont úgy, mint a Discord AutoModban, az adminok saját tiltott szavakat, neveket vagy `*minta*` kifejezéseket adhatnak hozzá az admin felületen, amelyeket a rendszer valós időben azonnal letilt az egész oldalon (Zenegépben, játékosnevekben és a toplistán), élő tesztelő mezővel.
  - **YouTube korhatár és beágyazás-ellenőrzés**: Valós idejű YouTube oEmbed vizsgálat szűri ki a korhatáros (NSFW / 18+) tartalmakat még a közzététel előtt.
- **🔒 Adminisztrátori Előnézet**: A főoldalról a diákok számára az előnézet / belehallgatás teljesen el van távolítva; a beküldött számokat és 4K videókat kizárólag az admin tudja az adminisztrációs felületen előnézetben megnézni, belehallgatni és ellenőrizni.
- **Neon Equalizer & Visualizer**: Élő hanghullám-animáció és dinamikus szüneti lejátszás.

### 💬 Élő Hangulatfal & Reakciók (Emoji-eső)
- A diákok egyetlen kattintással élő reakciókat küldhetnek be (🔥, 🎉, 😴, 🤯, ☕, ❤️).
- A reakciók valós időben úsznak fel az oldalon és a folyosói TV-kijelzőkön, a statisztika pedig mutatja a suli aktuális hangulatát.

### ⚡ Szüneti Mini-Aréna & Napi Ranglista
- **⚡ Neon Reflex**: Reakcióidő-fejlesztő pörgős játék bónuszokkal és kerülendő bombákkal.
- **🧠 Napi Villám-Kvíz**: 60+ kérdéses tudásbázis, naponta determinisztikusan generált egyedi kérdéssor (történelem, földrajz, irodalom, reál tárgyak, logika és fejszámolás) napi iskolai toplistával.
- **⏱️ Szünetenként 1 játék**: Egy diák egy szünetben legfeljebb 1 játékot indíthat, így mindenkinek egyenlő esélye van felkerülni a toplistára, és a játék nem vonja el a figyelmet. A következő szünetben a rendszer automatikusan újra engedélyezi a játékot.
- **🛡️ Nincs névtelen játék**: A játékok indítása előtt kötelező megadni a diák nevét vagy osztályát (pl. Dani 10.B). Névtelen vagy káromkodást tartalmazó névvel nem lehet játszani, és a pontszámok sem kerülhetnek fel anonim módon a ranglistára.
- **🗑️ Admin Toplista & Név Moderáció**: Az adminisztrációs felületen az adminok egy kattintással kitörölhetnek bármilyen nem odaillő nevet vagy csaló pontszámot a toplistáról (azonnal eltűnik a folyosói TV-ről és minden kijelzőről), vagy egy gombnyomással üríthetik a teljes napi toplistát.
- Tanítási óra közben automatikusan összezárul, hogy ne vonja el a figyelmet a tanulásról.

### 🎮 Pihenő Mód & Szezonális Mini-játékok
- Hétvégén, ünnepnapokon és tanítási szünetekben a visszaszámláló Pihenő módra vált.
- **4 nehézségi fokozatú Snake**: Könnyű, Normál, Nehéz és Extrém sebességbeállítás a Snake játékban névvel ellátott játékos-HUD-dal (itt is kötelező a név megadása, névtelen játék tiltva).
- **Szezonális játékok**: Ősszel Halloween édességfogó, télen Karácsonyi ajándékfogó, tavasszal Húsvéti tojásvadászat.

### 🌧️ Valós Idejű Időjárás & Fizikai Csapadékeffektek
- Helyi meteorológiai adatok az **Open-Meteo** szolgáltatásból (hőmérséklet, csapadékvalószínűség, időjárási ikonok).
- Valódi csapadék szimuláció: esőcseppek becsapódása, sűrű havazás megmaradó, a kártyák tetején lebegő hórétegekkel, vihar villámlással.

### 💬 Hivatalos Discord Integráció & Automatizáció
- Kétirányú adatkapcsolat a SuliBell és a hivatalos Discord szerver között Supabase Edge Function (`discord-bridge`) segítségével.
- **Dedikált csatornák a közösségnek**:
  - `📌 INFORMÁCIÓK` (`#👋-üdvözlő`, `#📜-szabályzat`, `#📢-közlemények`, `#🚪-belépések-és-kilépések`)
  - `💬 DIÁK KÖZÖSSÉG`:
    - `#🎵-zenekérés-ötletek`: Zenei javaslatok beküldése és szavazás (Discord reakciók = weboldali szavazat).
    - `#🎬-videóbeküldés`: Külön dedikált videóbeküldő szoba sulis és szüneti videóknak.
    - `#💡-ötletek-javaslatok`: Fórum csatorna külön bejegyzésekkel, szavazással és címkékkel (✨ Új funkció, 🎵 Zenegép, 🎮 Játékok, 🎨 Design, 📱 Mobil, 💡 Egyéb).
    - `#🐛-hibajelentés`, `#🔊-szüneti-társalgó`
  - `🔒 FEJLESZTŐI ZÓNA (DEV)`:
    - `#🚀-deploy-és-git`: Valós idejű GitHub commit és automatikus Vercel deploy értesítések commit üzenettel és szerzővel.
    - `#🆕-frissítések`: Automatikus értesítés verzióváltáskor a weboldal újdonságaival és a [sulibell.vercel.app](https://sulibell.vercel.app) közvetlen hivatkozásával.
    - `#🤖-bot-napló`: Rendszernaplózás és tagváltozások.

### 🔄 Rendszerfrissítés / Karbantartási Képernyő
- Az adminisztrátorok külön aktiválhatják a főoldalra és a TV-kijelzőre.
- **10 másodperces felkészülési visszaszámláló**: Bekapcsoláskor egy lebegő sáv figyelmezteti a diákokat a hátralévő másodpercekre.
- Leteltével automatikusan homályosított (`is-updating`) állapotba kapcsol a felület a frissítés idejére.

### 📱 PWA & Web Push Értesítések
- Önálló alkalmazásként telepíthető Androidra, iOS-re és asztali operációs rendszerekre.
- Azonnali Web Push értesítések az órarendi változásokról (elmaradó órák, helyettesítés).
- Teljes offline működés hálózati kimaradás esetén a legfrissebb gyorsítótárazott adatokkal.

---

## 🛠️ Technológiai Háttér

- **Frontend keretrendszer:** React 18, TypeScript, Vite
- **Hosztolás & Kiszolgálás:** Vercel ([sulibell.vercel.app](https://sulibell.vercel.app))
- **Adatbázis & Backend:** Supabase (PostgreSQL, Realtime WebSocket csatornák, Row-Level Security, Edge Functions)
- **Stílus és Megjelenés:** Tiszta, optimalizált CSS3 (Glassmorphism, Neon glow, Tabular numbers, Responsive Bento Grid)
- **Fizikai Effektek:** Kétrétegű HTML5 Canvas részecskemotor DOM-elemekhez rögzített ütközésvizsgálattal
- **Időjárás:** Open-Meteo Geocoding & Forecast API

---

## 🔒 Szerzői Jogi és Licenc Nyilatkozat

**Ez a projekt zárt forráskódú, saját tulajdonú szoftver (Proprietary / All Rights Reserved).**  
**Szerző és kizárólagos tulajdonos:** Finta Benjámin (2026)

A SuliBell teljes forráskódja, felhasználói felülete, designja, egyedi grafikái és adatbázis-struktúrája szerzői jogi védelem alatt áll.

- **SZIGORÚAN TILOS** a forráskód vagy annak részeinek másolása, sokszorosítása, forkolása, újrahasznosítása vagy újrahostolása a szerző (**Finta Benjámin**) előzetes írásos engedélye nélkül.
- A GitHub repository megtekinthetősége kizárólag a kód áttekintésére szolgál, **nem jelent nyílt forráskódú licencet (Open Source)**, és nem jogosít fel a projekt használatára vagy terjesztésére.
- Részletes jogi nyilatkozat a [LICENSE](LICENSE) fájlban olvasható.
