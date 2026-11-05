import { useState } from 'react'

const QUOTES: [string, string][] = [
  ['Nem az a fontos, hogy milyen lassan haladsz, hanem hogy ne állj meg.', 'Konfuciusz'],
  ['A tudás hatalom.', 'Francis Bacon'],
  ['Aki kérdez, az egy percig buta, aki nem kérdez, az egész életében.', 'kínai közmondás'],
  ['A siker nem végleges, a kudarc nem halálos: a folytatás bátorsága számít.', 'Winston Churchill'],
  ['A képzelet fontosabb, mint a tudás.', 'Albert Einstein'],
  ['Minden nagy út egyetlen lépéssel kezdődik.', 'Lao-ce'],
  ['Tanulni olyan, mint szembeúszni az árral: ha abbahagyod, visszasodródsz.', 'kínai közmondás'],
  ['Ne azt nézd, honnan jöttél, hanem hogy hová tartasz.', 'Ella Fitzgerald'],
  ['Az ember annyit ér, amennyit használ a hazának.', 'Széchenyi István'],
  ['A legjobb módja annak, hogy megjósold a jövőt, ha megteremted.', 'Peter Drucker'],
  ['Hibázni emberi dolog, de a hibából tanulni okos dolog.', 'magyar közmondás'],
  ['Ha nem tudsz repülni, fuss. Ha nem tudsz futni, járj. De haladj előre.', 'Martin Luther King'],
  ['Lassan járj, tovább érsz.', 'magyar közmondás'],
  ['A matematika a tudományok királynője.', 'Carl Friedrich Gauss'],
  ['Az olvasás az elmének az, ami a testnek a mozgás.', 'Joseph Addison'],
  ['Ki korán kel, aranyat lel.', 'magyar közmondás'],
  ['Csak az nem hibázik, aki nem csinál semmit.', 'Theodore Roosevelt'],
  ['A türelem keserű, de a gyümölcse édes.', 'Jean-Jacques Rousseau'],
]

const FACTS: string[] = [
  'A Rubik-kockát Rubik Ernő találta fel 1974-ben, több mint 43 trillió állása lehet.',
  'A golyóstollat Bíró László József szabadalmaztatta 1938-ban – angolul ma is „biro” a neve.',
  'A polip három szívvel és kék vérrel rendelkezik.',
  'A Holdon egy nap (napfelkeltétől napfelkeltéig) kb. 29,5 földi napig tart.',
  'A méz nem romlik meg: egyiptomi sírokban több ezer éves, ehető mézet is találtak.',
  'A Balaton Közép-Európa legnagyobb tava, átlagos mélysége csak kb. 3,2 méter.',
  'Az emberi agy kb. 86 milliárd idegsejtből áll.',
  'A villám hőmérséklete elérheti a 30 000 °C-ot – ötször melegebb a Nap felszínénél.',
  'A gyufát Irinyi János tette zajtalanná és biztonságossá 1836-ban.',
  'A Föld egy teljes kört kb. 23 óra 56 perc alatt tesz meg a tengelye körül.',
  'A C-vitamint Szent-Györgyi Albert izolálta, ezért 1937-ben Nobel-díjat kapott.',
  'A fény kb. 8 perc 20 másodperc alatt ér el a Naptól a Földig.',
  'A zsiráfnak ugyanannyi nyakcsigolyája van, mint az embernek: 7.',
  'A holografikus képet Gábor Dénes találta fel, amiért 1971-ben Nobel-díjat kapott.',
  'A Mount Everest minden évben néhány millimétert nő a kőzetlemezek mozgása miatt.',
  'Egy átlagos felhő tömege több száz tonna is lehet.',
  'A dinamót Jedlik Ányos írta le elsőként, évekkel Siemens előtt.',
  'A cápák már a dinoszauruszok előtt is léteztek, több mint 400 millió éve.',
  'A Duna 10 országon folyik át vagy érinti azokat – ez világrekord.',
  'Az első számítógép-programot Ada Lovelace írta a 19. században.',
]

/** Egyszerű, determinisztikus "véletlen" index a dátumból, hogy ugyanazon a napon mindenkinek ugyanaz jelenjen meg. */
function dayIndex(day: string, salt: number, len: number) {
  let h = salt
  for (const c of day) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h % len
}

/** Napi idézet és érdekesség – minden nap más, és a "Következő" gombbal lapozható. */
export default function Daily({ day }: { day: string }) {
  const [offset, setOffset] = useState(0)
  const q = QUOTES[(dayIndex(day, 7, QUOTES.length) + offset) % QUOTES.length]
  const f = FACTS[(dayIndex(day, 13, FACTS.length) + offset) % FACTS.length]
  return (
    <section className="panel daily">
      <div className="daily-head">
        <div className="tag">A nap gondolata</div>
        <button type="button" className="daily-next" onClick={() => setOffset(o => o + 1)} title="Másikat kérek">↻</button>
      </div>
      <blockquote className="daily-quote">
        <p>„{q[0]}”</p>
        <cite>— {q[1]}</cite>
      </blockquote>
      <div className="daily-fact">
        <span className="daily-ico" aria-hidden="true">💡</span>
        <div>
          <b>Tudtad?</b>
          <p>{f}</p>
        </div>
      </div>
    </section>
  )
}
