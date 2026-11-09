# SuliBell 🔔
> **Iskolai Valós Idejű Csengetési, Tájékoztatási és Közösségi Rendszer**  
> *Copyright © 2026 SuliBell. Minden jog fenntartva (All Rights Reserved).*

A **SuliBell** egy modern, valós idejű iskolai csengetési és közösségi webalkalmazás, amely másodperc pontosan mutatja a tanítási órákat, szüneteket, órarendi változásokat, és élménnyé teszi az iskolai mindennapokat a diákok, a tanárok és az iskola vezetősége számára.

---

## 🚀 Főbb Elérhetőségek és Nézetek

- **Főoldal (`/`)**: 3 oszlopos Bento Dashboard élmény telefonon, tableten és asztali böngészőben.
- **Folyosói Kijelző / TV Mód (`/display`)**: Fix 100svh felbontású, görgetésmentes nézet folyosói és aulában elhelyezett TV-kijelzőkre, óriási számlappal és QR-kóddal a telefonos megnyitáshoz.
- **Adminisztrátori Felület (`/admin`)**: Jelszóval és szerepkörökkel védett vezérlőpult a csengetési rendek, változások, menük, zenék és rendszerbeállítások kezelésére.
- **Privát Admin Tesztlabor (`/teszt`)**: Valósághű szimulációs környezet az adminoknak időléptetéssel, hó/eső és változások kockázatmentes teszteléséhez (a látogatók nem látják).
- **Alkalmazás Telepítés (`/telepites`)**: Útmutató az alkalmazás kezdőképernyőre való telepítéséhez (PWA).

---

## ✨ Kiemelt Funkciók

### 🕒 Élő Csengetési Számláló & Napsáv
- **LED Neon számlap**: Színkódolt analóg-digitális ív (óra, szünet, tanítás előtt/után), finoman váltó neon számjegyekkel.
- **10 másodperces finis**: Az utolsó 10 másodpercben pulzáló animáció és csengetési fényhullám.
- **Okos órarend-követés**: Az elmaradó órákat áthúzva jelöli, és a szünet-visszaszámláló automatikusan átugorja őket a következő tényleges óráig.
- **Nap haladása & Csengetési lista**: Arányos grafikus idősáv és a következő csengetések pontos listája.

### 📚 Személyes Órarend (Saját óráim)
- A diákok és tanárok beállíthatják saját tantárgyaikat és tantermeiket a hét minden napjára.
- **AI-alapú intelligens felismerés**: Bemásolt órarend-szövegből vagy fotó leírásából egy kattintással kitölti a heti órákat és termeket.
- A számlap és a napirend ezután a saját tantárgyat és a terem jelzését (pl. `📍 204. terem`) mutatja.

### 🎵 Szüneti Zenegép (Jukebox) & Háttér Visualizer
- **Diák kívánságműsor**: Zenék beküldése YouTube / MP3 linkkel vagy kereséssel, szavazás a legjobb számokra.
- **Váltakozó tematikus napok**: Zenei napok vs. 4K természetfilm-videók a szünetekben.
- **Neon Equalizer & Visualizer**: Élő hanghullám-animáció és dinamikus dalszöveg-megjelenítés.

### 💬 Élő Hangulatfal & Reakciók (Emoji-eső)
- A diákok egyetlen kattintással élő reakciókat küldhetnek be (🔥, 🎉, 😴, 🤯, ☕, ❤️).
- A reakciók valós időben úsznak fel az oldalon és a folyosói TV-kijelzőkön, a statisztika pedig mutatja a suli aktuális hangulatát.

### ⚡ Szüneti Mini-Aréna & Napi Ranglista
- **⚡ Neon Reflex**: Reakcióidő-fejlesztő pörgős játék bónuszokkal és kerülendő bombákkal.
- **🧠 Napi Villám-Kvíz**: 60+ kérdéses tudásbázis, naponta determinisztikusan generált egyedi kérdéssor (történelem, földrajz, irodalom, reál tárgyak, logika és fejszámolás) napi iskolai toplistával.
- Tanítási óra közben automatikusan összezárul, hogy ne vonja el a figyelmet a tanulásról.

### 🎮 Pihenő Mód & Szezonális Mini-játékok
- Hétvégén, ünnepnapokon és tanítási szünetekben a visszaszámláló Pihenő módra vált.
- **4 nehézségi fokozatú Snake**: Könnyű, Normál, Nehéz és Extrém sebességbeállítás a Snake játékban.
- **Szezonális játékok**: Ősszel Halloween édességfogó, télen Karácsonyi ajándékfogó, tavasszal Húsvéti tojásvadászat.

### 🌧️ Valós Idejű Időjárás & Fizikai Csapadékeffektek
- Helyi meteorológiai adatok az **Open-Meteo** szolgáltatásból (hőmérséklet, csapadékvalószínűség, időjárási ikonok).
- Valódi csapadék szimuláció: esőcseppek becsapódása, sűrű havazás megmaradó, a kártyák tetején lebegő hórétegekkel, vihar villámlással.

### 💬 Hivatalos Discord Integráció
- Kétirányú adatkapcsolat a SuliBell és a hivatalos Discord szerver között Supabase Edge Function segítségével.
- Automatikus közlemény-, étlap- és órarendváltozás-posztolás Discord csatornákra.
- Teljes szerver-struktúra kialakítva:
  - `📌 INFORMÁCIÓK` (üdvözlő, szabályzat, hírek, belépési napló)
  - `💬 DIÁK KÖZÖSSÉG` (csevegő, zenekérés, ötletek, hibajelentés, hangtársalgó)
  - `🧑‍🏫 TANÁRI SZOBA & VEZETŐSÉG` (privát oktatói megbeszélő és órarend-egyeztetés)
  - `🛡️ MODERÁTORI ZÓNA` (privát moderátori szobák és szankció-napló)
  - `🔒 FEJLESZTŐI ZÓNA (DEV)` (belső fejlesztői chat, git és szervernapló)

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
- **Adatbázis & Backend:** Supabase (PostgreSQL, Realtime WebSocket csatornák, Row-Level Security, Edge Functions, Storage)
- **Stílus és Megjelenés:** Tiszta, optimalizált CSS3 (Glassmorphism, Neon glow, Tabular numbers, Responsive Bento Grid)
- **Fizikai Effektek:** Kétrétegű HTML5 Canvas részecskemotor DOM-elemekhez rögzített ütközésvizsgálattal
- **Időjárás:** Open-Meteo Geocoding & Forecast API

---

## 🔒 Szerzői Jogi és Licenc Nyilatkozat

**Ez a projekt zárt forráskódú, saját tulajdonú szoftver (Proprietary / All Rights Reserved).**

A SuliBell teljes forráskódja, felhasználói felülete, designja, egyedi grafikái és adatbázis-struktúrája szerzői jogi védelem alatt áll.

- **SZIGORÚAN TILOS** a forráskód vagy annak részeinek másolása, sokszorosítása, forkolása, újrahasznosítása vagy újrahostolása a szerző előzetes írásos engedélye nélkül.
- A GitHub repository megtekinthetősége kizárólag a kód áttekintésére szolgál, **nem jelent nyílt forráskódú licencet (Open Source)**, és nem jogosít fel a projekt használatára vagy terjesztésére.
- Részletes jogi nyilatkozat a [LICENSE](LICENSE) fájlban olvasható.
