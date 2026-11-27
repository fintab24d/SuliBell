export interface Countdown { id: string; title: string; kind: string; target_date: string; target_time: string }
/** A visszaszámlálók fajtái: ikon + szín + név (a kártyák ezzel kapnak saját hangulatot). */
export const KIND: Record<string, { icon: string; label: string; color: string }> = {
  summer: { icon: '☀️', label: 'Nyári szünet', color: '#d4ff3a' },
  autumn: { icon: '🍂', label: 'Őszi szünet', color: '#ffb347' },
  winter: { icon: '❄️', label: 'Téli szünet', color: '#5cf0ff' },
  spring: { icon: '🌷', label: 'Tavaszi szünet', color: '#39ff7a' },
  holiday: { icon: '✨', label: 'Ünnep', color: '#ffd166' },
  other: { icon: '🎒', label: 'Egyéb', color: '#9dffbd' },
}

export interface EventStyle {
  icon: string
  color: string
  color2: string
  isHoliday: boolean
  themeClass: string
  badge?: string
}

const stripAccents = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

interface HolidayRule {
  re: RegExp
  icon: string
  color: string
  color2: string
  themeClass: string
  badge: string
}

const HOLIDAY_RULES: HolidayRule[] = [
  {
    re: /\b(marcius\s*15|oktober\s*23|augusztus\s*20|szent\s*istvan|allamalapitas|nemzeti\s*unnep|forradalom)\b/,
    icon: '🇭🇺',
    color: '#ff5c5c',
    color2: '#39ff7a',
    themeClass: 'ev-h-national',
    badge: 'Nemzeti ünnep',
  },
  {
    re: /\b(mikulas|telapo)\b/,
    icon: '🎅',
    color: '#ff5c6c',
    color2: '#ffd166',
    themeClass: 'ev-h-christmas',
    badge: 'Ünnep',
  },
  {
    re: /\b(karacsony|szenteste)\b/,
    icon: '🎄',
    color: '#ff5c6c',
    color2: '#ffd166',
    themeClass: 'ev-h-christmas',
    badge: 'Ünnep',
  },
  {
    re: /\badvent\b/,
    icon: '🕯️',
    color: '#ff7a59',
    color2: '#ffd166',
    themeClass: 'ev-h-christmas',
    badge: 'Ünnep',
  },
  {
    re: /\b(szilveszter|ujev|buek)\b/,
    icon: '🎆',
    color: '#ffd166',
    color2: '#a78bfa',
    themeClass: 'ev-h-newyear',
    badge: 'Ünnep',
  },
  {
    re: /\b(husvet|nagypentek|punkosd)\b/,
    icon: '🐣',
    color: '#ff85c0',
    color2: '#ffd166',
    themeClass: 'ev-h-easter',
    badge: 'Ünnep',
  },
  {
    re: /\bhalloween\b/,
    icon: '🎃',
    color: '#ff8b3d',
    color2: '#a855f7',
    themeClass: 'ev-h-halloween',
    badge: 'Ünnep',
  },
  {
    re: /\b(mindenszentek|halottak\s*napja)\b/,
    icon: '🕯️',
    color: '#ffb347',
    color2: '#ffd166',
    themeClass: 'ev-h-candle',
    badge: 'Ünnep',
  },
  {
    re: /\b(valentin|nonap|anyak\s*napja)\b/,
    icon: '💐',
    color: '#ff70a6',
    color2: '#ffd166',
    themeClass: 'ev-h-warm',
    badge: 'Ünnep',
  },
  {
    re: /\bfarsang\b/,
    icon: '🎭',
    color: '#c084fc',
    color2: '#ffd166',
    themeClass: 'ev-h-festive',
    badge: 'Ünnep',
  },
  {
    re: /\b(ballagas|szalagavato)\b/,
    icon: '🎓',
    color: '#ffd166',
    color2: '#7dd3fc',
    themeClass: 'ev-h-festive',
    badge: 'Ünnep',
  },
  {
    re: /\b(tanevzaro|tanevnyito|diaknap|gyereknap)\b/,
    icon: '🎉',
    color: '#ffd166',
    color2: '#ff7eb6',
    themeClass: 'ev-h-festive',
    badge: 'Ünnep',
  },
]

const BREAK_KINDS = new Set(['summer', 'autumn', 'winter', 'spring'])

/**
 * Eldönti egy esemény / tanítás nélküli nap vizuális stílusát.
 * A kifejezett 'holiday' fajtájú elemek, illetve az ünnepi nevek ünnepi kártyát kapnak;
 * a normál szünetek ('szünet' szóval, nem 'holiday' fajtával) megtartják a szünet stílusukat.
 */
export function resolveEventStyle(title: string, kind = 'other'): EventStyle {
  const k = KIND[kind] ?? KIND.other
  const norm = stripAccents(title || '')
  const matched = HOLIDAY_RULES.find(r => r.re.test(norm))
  const isBreakTitle = /\bszunet\b/.test(norm)

  if (kind === 'holiday') {
    if (matched) {
      return {
        icon: matched.icon,
        color: matched.color,
        color2: matched.color2,
        isHoliday: true,
        themeClass: matched.themeClass,
        badge: matched.badge,
      }
    }
    return {
      icon: k.icon,
      color: '#ffd166',
      color2: '#ff9e5e',
      isHoliday: true,
      themeClass: 'ev-h-festive',
      badge: 'Ünnep',
    }
  }

  if (matched && !(BREAK_KINDS.has(kind) && isBreakTitle) && !isBreakTitle) {
    return {
      icon: matched.icon,
      color: matched.color,
      color2: matched.color2,
      isHoliday: true,
      themeClass: matched.themeClass,
      badge: matched.badge,
    }
  }

  return {
    icon: k.icon,
    color: k.color,
    color2: k.color,
    isHoliday: false,
    themeClass: '',
  }
}
