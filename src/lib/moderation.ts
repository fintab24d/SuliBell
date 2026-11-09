// SuliBell NSFW & Káromkodás Szűrő (Iskolabaráttá tétel)
// Kiszűri a trágár szavakat, 18+ / felnőtt tartalmakat, és tiltja a névtelen beküldést.

/**
 * Szöveg normalizálása (kisbetű, ékezetek feloldása, elmaszkolt leet-speak karakterek cseréje)
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // ékezetek leválasztása (á->a, é->e, stb.)
    .replace(/[@4]/g, 'a')
    .replace(/[3]/g, 'e')
    .replace(/[1!|]/g, 'i')
    .replace(/[0]/g, 'o')
    .replace(/[$5]/g, 's')
    .replace(/[7]/g, 't')
    .replace(/[\s._\-+*#,!?/\\()[\]{}~"']+/g, ' ') // írásjelek szóközzé
    .replace(/(.)\1{2,}/g, '$1$1') // 3+ egymást követő betű rövidítése (pl. kuuurva -> kuurva)
    .trim()
}

// Kifejezett tiltott szavak és szótövek
const EXACT_BLOCKED_WORDS = new Set([
  // Magyar trágár alapszavak
  'fasz', 'faszt', 'faszok', 'faszfej', 'faszfejek', 'faszkalap', 'balfasz', 'faszos', 'faszomat',
  'geci', 'gecit', 'gecik', 'gecis', 'gecilada',
  'kurva', 'kurvat', 'kurvak', 'kurvara', 'kurvaelet', 'kurvaanyad',
  'picsa', 'picsat', 'picsaba', 'pina', 'pinat', 'pinak', 'pocik', 'pocs', 'pocsom',
  'szar', 'szart', 'szarok', 'szaros', 'szard', 'szartal',
  'ribanc', 'ribancot', 'ribancok',
  'kocsog', 'kocsogot', 'kocsogok',
  'seggfej', 'seggfejek',
  'anyad', 'anyadat', 'buzi', 'buzik', 'buzit',
  'szopas', 'szopd', 'szopjad', 'leszopod',

  // Angol káromkodások
  'fuck', 'fucking', 'fucker', 'motherfucker', 'fucked',
  'shit', 'shitty', 'bullshit',
  'bitch', 'bitches',
  'cunt', 'dick', 'dicks', 'pussy', 'pussies',
  'asshole', 'assholes', 'bastard',
  'faggot', 'nigger', 'nigga', 'whore', 'slut',

  // NSFW / 18+ / Pornográfia
  'porn', 'porno', 'xxx', 'nsfw', 'hentai', 'ecchi',
  'nude', 'nudes', 'naked', 'meztelen',
  'dildo', 'blowjob', 'anal', 'brazzers', 'onlyfans', 'xvideos', 'pornhub', 'rule34',
  'semen', 'penis', 'vagina', 'gangbang', 'striptease',
])

// Káromkodás regex minták (figyelembe véve a toldalékokat és szándékos elfedéseket)
const PROFANITY_PATTERNS = [
  /\bf+a+s+z+[a-z]*/i,
  /\bg+e+c+i+[a-z]*/i,
  /\bk+u+r+v+[a-z]*/i,
  /\bp+i+c+s+[a-z]*/i,
  /\bp+i+n+a+[a-z]*/i,
  /\br+i+b+a+n+c+[a-z]*/i,
  /\bk+o+c+s+o+g+[a-z]*/i,
  /\bb+u+z+i+[a-z]*/i,
  /\bs+e+g+g+f+e+j+[a-z]*/i,
  /\ba+n+y+a+d+a+t+[a-z]*/i,
  // Basz tövű szavak, de NEM 'basszus', 'bass', 'passz'
  /\b(meg)?b+a+s+z+(d|a|o|u|e|i|n|t)+[a-z]*/i,
  // Szar tövű szavak, de NEM 'szarvas', 'szarmata'
  /\bs+z+a+r+(t|o|u|a|i)+[a-z]*/i,
  // Angol kulcsszavak
  /\bf+u+c+k+[a-z]*/i,
  /\bb+i+t+c+h+[a-z]*/i,
  /\ba+s+s+h+o+l+e+[a-z]*/i,
  /\bp+o+r+n+[a-z]*/i,
  /\bh+e+n+t+a+i+[a-z]*/i,
]

// Biztonságos, kivételt képező szavak (Scunthorpe problem megelőzése)
const SAFE_WHITELIST = new Set([
  'bass', 'basszus', 'basszusgitar', 'bassline',
  'szarvas', 'szarvasi', 'szarv',
  'passz', 'passzol', 'klassz',
  'szerkeszt', 'szerkesztes',
  'asszisztens', 'asszociacio',
])

/**
 * Szöveg vizsgálata káromkodás és felnőtt (NSFW) tartalom szempontjából
 */
export function checkProfanity(input: string): { clean: boolean; matchedWord?: string } {
  if (!input || typeof input !== 'string') return { clean: true }
  const normalized = normalizeText(input)
  if (!normalized) return { clean: true }

  const words = normalized.split(/\s+/)

  for (const w of words) {
    if (SAFE_WHITELIST.has(w)) continue
    if (EXACT_BLOCKED_WORDS.has(w)) {
      return { clean: false, matchedWord: w }
    }
  }

  for (const pattern of PROFANITY_PATTERNS) {
    const match = normalized.match(pattern)
    if (match) {
      const matchedStr = match[0]
      if (!SAFE_WHITELIST.has(matchedStr)) {
        return { clean: false, matchedWord: matchedStr }
      }
    }
  }

  return { clean: true }
}

/**
 * YouTube videó ellenőrzése (korhatár, 18+, privát, nem beágyazható)
 */
export async function verifyYouTubeSafe(ytId: string): Promise<{ ok: boolean; title?: string; error?: string }> {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${ytId}&format=json`)
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        error: 'Ez a videó korhatáros (18+) vagy a tulajdonosa letiltotta a beágyazását. Kérjük, válassz másik videót!'
      }
    }
    if (!res.ok) {
      return {
        ok: false,
        error: 'A megadott videó nem található, privát vagy nem elérhető.'
      }
    }

    const data = await res.json()
    const title = String(data?.title || '')

    // A YouTube által visszaadott hivatalos címet is ellenőrizzük a szűrővel!
    const titleCheck = checkProfanity(title)
    if (!titleCheck.clean) {
      return {
        ok: false,
        title,
        error: `A videó címe („${title.slice(0, 40)}”) nem felel meg az iskolai szabályzatnak (nem megengedett kifejezés: ${titleCheck.matchedWord}).`
      }
    }

    return { ok: true, title }
  } catch {
    // Offline vagy hálózati hiba esetén engedékenyek vagyunk
    return { ok: true }
  }
}

/**
 * Teljes körű beküldés-ellenőrzés:
 * 1. Név kötelező (névtelen beküldés tiltott)
 * 2. Cím és név káromkodás/NSFW szűrése
 * 3. YouTube videó korhatár és cím ellenőrzése
 */
export async function validateMediaSubmission(params: {
  title: string
  by: string
  ytId?: string
}): Promise<{ valid: boolean; error?: string; cleanTitle?: string; cleanBy?: string }> {
  const cleanTitle = (params.title || '').trim().slice(0, 60)
  const cleanBy = (params.by || '').trim().slice(0, 24)

  // 1. Név ellenőrzése (kötelező név, névtelen tiltva)
  if (!cleanBy) {
    return {
      valid: false,
      error: 'A név megadása kötelező! Névtelenül nem lehet zenét vagy videót beküldeni.'
    }
  }
  if (cleanBy.length < 2) {
    return {
      valid: false,
      error: 'A neved legalább 2 karakter hosszú legyen (pl. Név vagy Osztály)!'
    }
  }
  if (cleanBy.toLowerCase() === 'nevtelen' || cleanBy.toLowerCase() === 'névtelen' || cleanBy.toLowerCase() === 'anonim' || cleanBy.toLowerCase() === 'anonymous') {
    return {
      valid: false,
      error: 'A „Névtelen” beküldés nem engedélyezett. Kérjük, add meg a valódi neved vagy az osztályodat!'
    }
  }

  // Név káromkodás ellenőrzése
  const byCheck = checkProfanity(cleanBy)
  if (!byCheck.clean) {
    return {
      valid: false,
      error: 'A megadott név nem felel meg az iskolai szabályzatnak.'
    }
  }

  // 2. Cím ellenőrzése
  if (!cleanTitle) {
    return {
      valid: false,
      error: 'Add meg a zene vagy videó címét!'
    }
  }

  const titleCheck = checkProfanity(cleanTitle)
  if (!titleCheck.clean) {
    return {
      valid: false,
      error: `A megadott cím nem felel meg az iskolai szabályzatnak (nem megfelelő kifejezés található benne). Kérjük, válassz iskolabarát számot!`
    }
  }

  // 3. YouTube videó ellenőrzése (ha van YouTube azonosító)
  if (params.ytId) {
    const ytCheck = await verifyYouTubeSafe(params.ytId)
    if (!ytCheck.ok) {
      return {
        valid: false,
        error: ytCheck.error || 'A videó nem felel meg az iskolai szabályzatnak.'
      }
    }
  }

  return { valid: true, cleanTitle, cleanBy }
}
