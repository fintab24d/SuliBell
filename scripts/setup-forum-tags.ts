/**
 * Discord Fórum (Forms) csatornákhoz témához illő, kizárólag fejlesztők által kapcsolható
 * státusz-címkék (moderated: true) és MANAGE_THREADS jogosultságok beállítása.
 *
 * Használat:
 *   $env:DISCORD_TOKEN="bot_token"; node --experimental-strip-types scripts/setup-forum-tags.ts
 */

const TOKEN = (process.argv[2] || process.env.DISCORD_TOKEN)?.trim()
const GUILD_ID = (process.argv[3] || process.env.GUILD_ID || '1569090182802575571')?.trim()

if (!TOKEN) {
  console.error('❌ Hiányzó DISCORD_TOKEN környezeti változó!')
  process.exit(1)
}

const API = 'https://discord.com/api/v10'
const MANAGE_THREADS = 1n << 34n

async function api<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bot ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (res.status === 429) {
    const retry = await res.json().catch(() => ({ retry_after: 2 }))
    const waitMs = Math.ceil((retry.retry_after || 2) * 1000) + 250
    console.log(`⏳ Rate limit, várakozás ${waitMs}ms...`)
    await new Promise((r) => setTimeout(r, waitMs))
    return api(path, method, body)
  }
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Discord API hiba (${res.status} ${method} ${path}): ${txt}`)
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

interface StatusTagSpec {
  name: string
  emoji_name: string
  aliases?: string[]
}

const stripEmoji = (s: string) =>
  String(s || '')
    .replace(/^[\p{Extended_Pictographic}\p{Emoji_Presentation}\u200d\ufe0f\s]+/gu, '')
    .trim()

const normName = (s: string) =>
  stripEmoji(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

const FORUM_CONFIGS: Array<{
  key: 'ideas' | 'bugs' | 'roadmap'
  match: (ch: any) => boolean
  defaultReaction: { emoji_name: string }
  statusTags: StatusTagSpec[]
}> = [
  {
    key: 'ideas',
    match: (ch) => ch.id === '1569437160799609036' || /ötlet|otlet|javaslat/i.test(String(ch.name || '')),
    defaultReaction: { emoji_name: '👍' },
    statusTags: [
      { name: 'Megnézve', emoji_name: '👀' },
      { name: 'Tervben', emoji_name: '📋' },
      { name: 'Folyamatban', emoji_name: '🔨' },
      { name: 'Elkészült', emoji_name: '✅' },
      { name: 'Elutasítva', emoji_name: '❌' },
    ],
  },
  {
    key: 'bugs',
    match: (ch) => ch.id === '1573047517497786428' || /hiba|bug/i.test(String(ch.name || '')),
    defaultReaction: { emoji_name: '👀' },
    statusTags: [
      { name: 'Vizsgálat alatt', emoji_name: '🔍' },
      { name: 'Tervben', emoji_name: '📋' },
      { name: 'Javítás alatt', emoji_name: '🔧' },
      { name: 'Javítva', emoji_name: '✅', aliases: ['javitva'] },
      { name: 'Nem reprodukálható', emoji_name: '🚫' },
    ],
  },
  {
    key: 'roadmap',
    match: (ch) => ch.id === '1570134622891802677' || /roadmap|teendő|teendo/i.test(String(ch.name || '')),
    defaultReaction: { emoji_name: '🚀' },
    statusTags: [
      { name: 'Tervben', emoji_name: '📋', aliases: ['tervezett'] },
      { name: 'Folyamatban', emoji_name: '🔨' },
      { name: 'Tesztelés', emoji_name: '🧪' },
      { name: 'Elkészült', emoji_name: '✅', aliases: ['kesz', 'kész'] },
      { name: 'Halasztva', emoji_name: '⏸️' },
    ],
  },
]

const isDevRole = (name: string) =>
  /tulajdonos|főadmin|foadmin|lead\s*dev|fejlesztő|fejleszto|\bdev\b/i.test(name)

const isNonDevRole = (name: string) =>
  /diák|diak|tanár|tanar|vip|moderátor|moderator/i.test(name)

function matchSpec(tagName: string, specs: StatusTagSpec[]): StatusTagSpec | undefined {
  const n = normName(tagName)
  return specs.find((sp) => normName(sp.name) === n || (sp.aliases || []).some((a) => normName(a) === n))
}

async function run() {
  console.log('🛠️ Discord Fórum státusz-címkék és fejlesztői jogosultságok beállítása...')

  const [channels, roles]: [any[], any[]] = await Promise.all([
    api(`/guilds/${GUILD_ID}/channels`),
    api(`/guilds/${GUILD_ID}/roles`),
  ])

  const devRoles = roles.filter((r) => isDevRole(String(r.name || '')))
  const nonDevRoles = roles.filter(
    (r) => !isDevRole(String(r.name || '')) && (r.id === GUILD_ID || isNonDevRole(String(r.name || '')))
  )

  for (const ch of channels.filter((c) => c.type === 15)) {
    const cfg = FORUM_CONFIGS.find((c) => c.match(ch))
    if (!cfg) continue

    const existing: any[] = Array.isArray(ch.available_tags) ? ch.available_tags : []
    const topicTags = existing
      .filter((t) => !matchSpec(t.name, cfg.statusTags))
      .map((t) => ({
        id: t.id,
        name: ((t.emoji_name || t.emoji_id) ? stripEmoji(t.name) || String(t.name) : String(t.name)).slice(0, 20),
        ...(t.emoji_id ? { emoji_id: t.emoji_id } : t.emoji_name ? { emoji_name: t.emoji_name } : {}),
        moderated: false,
      }))

    const usedIds = new Set<string>()
    const statusTags = cfg.statusTags.map((sp) => {
      const prev = existing.find((t) => !usedIds.has(t.id) && matchSpec(t.name, [sp]))
      if (prev?.id) usedIds.add(prev.id)
      return {
        ...(prev?.id ? { id: prev.id } : {}),
        name: sp.name.slice(0, 20),
        emoji_name: sp.emoji_name,
        moderated: true,
      }
    })

    const owMap = new Map<string, { id: string; type: number; allow: bigint; deny: bigint }>()
    for (const ow of Array.isArray(ch.permission_overwrites) ? ch.permission_overwrites : []) {
      owMap.set(String(ow.id), {
        id: String(ow.id),
        type: Number(ow.type ?? 0),
        allow: BigInt(ow.allow || '0'),
        deny: BigInt(ow.deny || '0'),
      })
    }
    for (const r of devRoles) {
      const cur = owMap.get(r.id) || { id: r.id, type: 0, allow: 0n, deny: 0n }
      cur.allow = cur.allow | MANAGE_THREADS
      cur.deny = cur.deny & ~MANAGE_THREADS
      owMap.set(r.id, cur)
    }
    for (const r of nonDevRoles) {
      const cur = owMap.get(r.id) || { id: r.id, type: 0, allow: 0n, deny: 0n }
      cur.allow = cur.allow & ~MANAGE_THREADS
      cur.deny = cur.deny | MANAGE_THREADS
      owMap.set(r.id, cur)
    }

    const patched = await api(`/channels/${ch.id}`, 'PATCH', {
      available_tags: [...topicTags, ...statusTags].slice(0, 20),
      default_reaction_emoji: cfg.defaultReaction,
      permission_overwrites: Array.from(owMap.values()).map((ow) => ({
        id: ow.id,
        type: ow.type,
        allow: ow.allow.toString(),
        deny: ow.deny.toString(),
      })),
    })

    console.log(`✅ Frissítve: #${patched.name} (${patched.id}) — ${(patched.available_tags || []).length} címke`)
  }

  console.log('\n🎉 Kész! Csak a fejlesztői rangok kapcsolhatják a státusz-címkéket.')
}

run().catch((err) => {
  console.error('\n❌ Hiba:', err.message)
  process.exit(1)
})
