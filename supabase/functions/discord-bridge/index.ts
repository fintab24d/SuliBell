// SuliBell <-> Discord Kétirányú Szinkronizációs Híd (Supabase Edge Function)
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

const reply = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })

const API = 'https://discord.com/api/v10'
const DEFAULT_GUILD = '1569090182802575571'

const getToken = () => (Deno.env.get('DISCORD_BOT_TOKEN') || '').trim()
const getGuild = () => (Deno.env.get('DISCORD_GUILD_ID') || DEFAULT_GUILD).trim()

interface ChannelMap {
  announcements?: string
  updates?: string
  music?: string
  ideas?: string
  bugs?: string
  logs?: string
  fetchedAt: number
}

let cachedChannels: ChannelMap | null = null
let intentChecked = false
const ytTitleCache = new Map<string, string>()
const ytSearchCache = new Map<string, { ytId: string; title: string } | null>()

async function discordApi(path: string, method = 'GET', body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bot ${getToken()}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Discord API (${res.status} ${path}): ${errText}`)
  }
  if (res.status === 204) return null
  return res.json()
}

async function ensureIntentAndChannels(): Promise<ChannelMap> {
  if (!intentChecked) {
    intentChecked = true
    try {
      const app = await discordApi('/applications/@me')
      const FLAG_MESSAGE_CONTENT_LIMITED = 1 << 19
      if (app && typeof app.flags === 'number' && !(app.flags & FLAG_MESSAGE_CONTENT_LIMITED)) {
        await discordApi('/applications/@me', 'PATCH', {
          flags: app.flags | FLAG_MESSAGE_CONTENT_LIMITED,
        })
      }
    } catch {
      // ignore
    }
  }

  if (cachedChannels && Date.now() - cachedChannels.fetchedAt < 5 * 60_000) {
    return cachedChannels
  }

  const chs: any[] = await discordApi(`/guilds/${getGuild()}/channels`)
  const map: ChannelMap = { fetchedAt: Date.now() }

  for (const c of chs) {
    if (c.type !== 0) continue
    const n = String(c.name || '').toLowerCase()
    if (n.includes('közlemény') || n.includes('kozlemeny')) map.announcements = c.id
    else if (n.includes('frissítés') || n.includes('frissites')) map.updates = c.id
    else if (n.includes('zenekérés') || n.includes('zenekeres') || n.includes('zene')) map.music = c.id
    else if (n.includes('ötlet') || n.includes('otlet')) map.ideas = c.id
    else if (n.includes('hiba')) map.bugs = c.id
    else if (n.includes('napló') || n.includes('naplo')) map.logs = c.id
  }

  cachedChannels = map
  return map
}

function extractYtId(text: string): string | undefined {
  const m = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{11})/.exec(text)
  return m ? m[1] : undefined
}

async function fetchYtTitle(ytId: string): Promise<string | undefined> {
  if (ytTitleCache.has(ytId)) return ytTitleCache.get(ytId)
  try {
    const r = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${ytId}&format=json`)
    if (!r.ok) return undefined
    const j = await r.json()
    if (j?.title) {
      const t = String(j.title).trim().slice(0, 60)
      ytTitleCache.set(ytId, t)
      return t
    }
  } catch {
    // ignore
  }
  return undefined
}

async function searchYoutube(query: string): Promise<{ ytId: string; title: string } | null> {
  const q = query.trim()
  if (!q || q.length < 2) return null
  if (ytSearchCache.has(q.toLowerCase())) return ytSearchCache.get(q.toLowerCase()) ?? null
  try {
    const r = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`, {
      headers: { 'Accept-Language': 'hu-HU,hu;q=0.9,en-US;q=0.8,en;q=0.7' },
    })
    if (!r.ok) return null
    const html = await r.text()
    const m = /"videoId":"([a-zA-Z0-9_-]{11})"/.exec(html)
    if (!m) {
      ytSearchCache.set(q.toLowerCase(), null)
      return null
    }
    const ytId = m[1]
    const realTitle = (await fetchYtTitle(ytId)) || q.slice(0, 60)
    const res = { ytId, title: realTitle }
    ytSearchCache.set(q.toLowerCase(), res)
    return res
  } catch {
    return null
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {}
    const action = body.action || 'sync'
    const chMap = await ensureIntentAndChannels()

    if (action === 'sync') {
      const songs: any[] = []
      const announcements: any[] = []

      if (chMap.music) {
        const msgs: any[] = await discordApi(`/channels/${chMap.music}/messages?limit=25`).catch(() => [])
        for (const m of msgs) {
          if (m.author?.bot) continue
          const rawContent = String(m.content || '').trim()
          if (!rawContent && (!m.embeds || !m.embeds.length)) continue
          if (rawContent.length < 2) continue

          let ytId = extractYtId(rawContent)
          let cleanTitle = rawContent.replace(/https?:\/\/\S+/g, '').replace(/^[-–—:\s]+|[-–—:\s]+$/g, '').trim()

          if (ytId && !cleanTitle) {
            cleanTitle = (await fetchYtTitle(ytId)) || `YouTube (${ytId})`
          } else if (!ytId && cleanTitle.length >= 3) {
            const found = await searchYoutube(cleanTitle)
            if (found) {
              ytId = found.ytId
              if (cleanTitle.length < 5) cleanTitle = found.title
            }
          }

          if (!cleanTitle) continue

          let extraVotes = 0
          let botReacted = false
          if (Array.isArray(m.reactions)) {
            for (const rc of m.reactions) {
              const cnt = Number(rc.count) || 0
              if (rc.me) {
                botReacted = true
                extraVotes += Math.max(0, cnt - 1)
              } else {
                extraVotes += cnt
              }
            }
          }

          if (!botReacted) {
            discordApi(`/channels/${chMap.music}/messages/${m.id}/reactions/${encodeURIComponent('🎵')}/@me`, 'PUT').catch(() => {})
          }

          const senderName = (m.member?.nick || m.author?.global_name || m.author?.username || 'Diák').slice(0, 20)
          const createdMs = Date.parse(m.timestamp) || Date.now()
          const msgDay = new Date(createdMs).toLocaleDateString('sv-SE', { timeZone: 'Europe/Budapest' })

          songs.push({
            id: `dc-${m.id}`,
            day: msgDay,
            title: cleanTitle.slice(0, 60),
            by: `${senderName} 💬`,
            ytId,
            votes: 1 + extraVotes,
            at: createdMs,
          })
        }
      }

      if (chMap.announcements) {
        const msgs: any[] = await discordApi(`/channels/${chMap.announcements}/messages?limit=10`).catch(() => [])
        for (const m of msgs) {
          if (m.author?.bot) continue
          const txt = String(m.content || '').trim()
          if (!txt) continue
          const createdMs = Date.parse(m.timestamp) || Date.now()
          if (Date.now() - createdMs > 7 * 86400_000) continue
          const author = m.member?.nick || m.author?.global_name || m.author?.username || 'Discord'
          announcements.push({
            id: `dc-ann-${m.id}`,
            text: `💬 ${txt}`,
            author,
            at: createdMs,
          })
        }
      }

      return reply({
        ok: true,
        invite: 'https://discord.gg/uHhbhFB5rC',
        songs,
        announcements,
      })
    }

    if (action === 'post') {
      const kind = String(body.kind || '')

      if (kind === 'jukebox' && chMap.music) {
        const title = String(body.title || '').trim()
        const by = String(body.by || 'Névtelen').trim() || 'Névtelen'
        const ytId = body.ytId ? String(body.ytId).trim() : undefined
        const mediaKind = body.mediaKind === 'video' ? '🎬 Videókérés' : '🎵 Zenekérés'
        const ytUrl = ytId ? `https://youtu.be/${ytId}` : undefined

        await discordApi(`/channels/${chMap.music}/messages`, 'POST', {
          embeds: [
            {
              title: `${mediaKind} a weboldalról!`,
              description: ytUrl ? `**[${title}](${ytUrl})**\n🔗 ${ytUrl}` : `**${title}**`,
              color: body.mediaKind === 'video' ? 0x2de2ff : 0xff4fc3,
              thumbnail: ytId ? { url: `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg` } : undefined,
              footer: { text: `Beküldte: ${by} • SuliBell Weboldal` },
              timestamp: new Date().toISOString(),
            },
          ],
        })
        return reply({ ok: true })
      }

      if (kind === 'announcement' && chMap.announcements) {
        const text = String(body.text || '').trim()
        const until = body.until ? String(body.until).trim() : ''
        await discordApi(`/channels/${chMap.announcements}/messages`, 'POST', {
          embeds: [
            {
              title: '📢 Új iskolai közlemény',
              description: text,
              color: 0x2de2ff,
              footer: { text: until ? `Érvényes eddig: ${until} • SuliBell` : 'SuliBell Közlemény' },
              timestamp: new Date().toISOString(),
            },
          ],
        })
        return reply({ ok: true })
      }

      if (kind === 'alert' && chMap.announcements) {
        const text = String(body.text || '').trim()
        await discordApi(`/channels/${chMap.announcements}/messages`, 'POST', {
          content: '@everyone',
          embeds: [
            {
              title: '🚨 KIEMELT FIGYELMEZTETÉS / RIADÓ',
              description: `**${text}**`,
              color: 0xff3b5c,
              footer: { text: 'SuliBell Kiemelt Rendszerüzenet' },
              timestamp: new Date().toISOString(),
            },
          ],
        })
        return reply({ ok: true })
      }

      if (kind === 'change' && chMap.announcements) {
        const day = String(body.day || '')
        const lesson = String(body.lesson_label || '')
        const typeLabel = String(body.typeLabel || 'Változás')
        const text = String(body.text || '')
        await discordApi(`/channels/${chMap.announcements}/messages`, 'POST', {
          embeds: [
            {
              title: `🔔 Órarend-változás (${day})`,
              description: `**${typeLabel}**${lesson ? ` — \`${lesson}\`` : ''}${text ? `\n📝 ${text}` : ''}`,
              color: 0xffb02e,
              footer: { text: 'SuliBell Órarend' },
              timestamp: new Date().toISOString(),
            },
          ],
        })
        return reply({ ok: true })
      }

      if (kind === 'menu' && chMap.announcements) {
        const day = String(body.day || '')
        const text = String(body.text || '')
        await discordApi(`/channels/${chMap.announcements}/messages`, 'POST', {
          embeds: [
            {
              title: `🍽️ Napi étlap (${day})`,
              description: text,
              color: 0x39ff7a,
              footer: { text: 'SuliBell Menza' },
              timestamp: new Date().toISOString(),
            },
          ],
        })
        return reply({ ok: true })
      }

      if (kind === 'poll' && chMap.announcements) {
        const question = String(body.question || '')
        const options: string[] = Array.isArray(body.options) ? body.options : []
        await discordApi(`/channels/${chMap.announcements}/messages`, 'POST', {
          embeds: [
            {
              title: '📊 Új szavazás indult a weboldalon!',
              description: `**${question}**\n\n` + options.map((o, i) => `${i + 1}️⃣ ${o}`).join('\n'),
              color: 0x8a5cff,
              footer: { text: 'Szavazz a SuliBell weboldalon!' },
              timestamp: new Date().toISOString(),
            },
          ],
        })
        return reply({ ok: true })
      }

      return reply({ ok: false, error: 'Ismeretlen cél vagy hiányzó csatorna' }, 400)
    }

    return reply({ ok: false, error: 'Ismeretlen művelet' }, 400)
  } catch (err: any) {
    return reply({ ok: false, error: err?.message || 'Szerverhiba' }, 500)
  }
})
