/**
 * Roadmap csatorna (📋-teendők-roadmap) átalakítása Fórum (Forms/Forum) típusúvá a Discord szerveren
 * Használat: $env:DISCORD_TOKEN="bot_token"; node --experimental-strip-types scripts/convert-roadmap-to-forum.ts
 */
const TOKEN = (process.argv[2] || process.env.DISCORD_TOKEN)?.trim()
const GUILD_ID = (process.argv[3] || process.env.GUILD_ID || '1569090182802575571')?.trim()
if (!TOKEN) {
  console.error('❌ Hiányzó DISCORD_TOKEN környezeti változó!')
  process.exit(1)
}
const API = 'https://discord.com/api/v10'

async function api<T = any>(path: string, method = 'GET', body?: any): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bot ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (res.status === 429) {
    const retry = await res.json().catch(() => ({ retry_after: 2 }))
    const waitMs = Math.ceil((retry.retry_after || 2) * 1000) + 200
    console.log(`⏳ Rate limit, várakozás ${waitMs}ms...`)
    await new Promise(r => setTimeout(r, waitMs))
    return api(path, method, body)
  }
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Discord API hiba (${res.status} ${path}): ${txt}`)
  }
  if (res.status === 204) return undefined as any
  return res.json()
}

function formatArchivedMessage(m: any): { title: string; body: string } | null {
  const parts: string[] = []
  if (typeof m?.content === 'string' && m.content.trim()) {
    parts.push(m.content.trim())
  }
  if (Array.isArray(m?.embeds)) {
    for (const emb of m.embeds) {
      const embParts = [emb.title, emb.description].filter(Boolean).map((x: string) => x.trim())
      if (embParts.length) parts.push(embParts.join('\n'))
    }
  }
  const text = parts.join('\n\n').trim()
  if (!text) return null
  const firstLine = text.split(/\r?\n/)[0].replace(/[*_`#>]/g, '').trim()
  const title = (firstLine || 'Korábbi roadmap bejegyzés').slice(0, 95)
  const author = m?.author?.global_name || m?.author?.username || 'Fejlesztő'
  return {
    title,
    body: `${text}\n\n— *Korábbi csatornából átmozgatva (${author})*`,
  }
}

async function run() {
  console.log('🚀 Roadmap csatorna átalakítása Fórum (GUILD_FORUM) típusúvá...')

  const channels: any[] = await api(`/guilds/${GUILD_ID}/channels`)
  const oldChannel = channels.find(c => {
    const n = String(c.name || '').toLowerCase()
    return c.type !== 4 && (n.includes('roadmap') || n.includes('teendő') || n.includes('teendo'))
  })

  if (oldChannel?.type === 15) {
    console.log(`✅ A(z) ${oldChannel.name} (${oldChannel.id}) már Fórum típusú!`)
    return
  }

  const devCat = channels.find(c => {
    const n = String(c.name || '').toLowerCase()
    return c.type === 4 && (n.includes('fejlesztő') || n.includes('fejleszto') || n.includes('dev'))
  })

  const parentId = oldChannel?.parent_id ?? devCat?.id
  const permissionOverwrites = Array.isArray(oldChannel?.permission_overwrites)
    ? oldChannel.permission_overwrites
    : undefined
  const position = typeof oldChannel?.position === 'number' ? oldChannel.position : undefined

  // Régi üzenetek mentése törlés előtt, hogy egyetlen terv se vesszen el
  const archivedPosts: { title: string; body: string }[] = []
  if (oldChannel) {
    console.log(`📥 Régi üzenetek mentése (${oldChannel.name}, ${oldChannel.id})...`)
    try {
      const msgs: any[] = await api(`/channels/${oldChannel.id}/messages?limit=50`)
      for (const m of [...msgs].reverse()) {
        const formatted = formatArchivedMessage(m)
        if (formatted) archivedPosts.push(formatted)
      }
      console.log(`📦 ${archivedPosts.length} meglévő üzenet elmentve átmigráláshoz.`)
    } catch (err: any) {
      console.log('⚠️ Régi üzenetek lekérése sikertelen:', err.message)
    }

    console.log(`🗑️ Régi szöveges csatorna (${oldChannel.id}) törlése...`)
    await api(`/channels/${oldChannel.id}`, 'DELETE')
    console.log('✅ Régi csatorna törölve.')
  } else {
    console.log('ℹ️ Nem található meglévő szöveges roadmap csatorna, új fórumot hozok létre.')
  }

  // Új Fórum csatorna létrehozása a Fejlesztői zónában
  console.log('✨ Új Roadmap Fórum csatorna létrehozása...')
  const forum = await api(`/guilds/${GUILD_ID}/channels`, 'POST', {
    name: '📋-teendők-roadmap',
    type: 15, // GUILD_FORUM
    ...(parentId ? { parent_id: parentId } : {}),
    ...(position !== undefined ? { position } : {}),
    ...(permissionOverwrites?.length ? { permission_overwrites: permissionOverwrites } : {}),
    topic: 'Fejlesztési tervek, következő funkciók, folyamatban lévő feladatok és kiadás előtti teendők fóruma.',
    available_tags: [
      { name: '📋 Tervezett', emoji_name: '📋' },
      { name: '🔨 Folyamatban', emoji_name: '🔨' },
      { name: '🧪 Tesztelés', emoji_name: '🧪' },
      { name: '✅ Kész', emoji_name: '✅' },
      { name: '🐛 Bugfix', emoji_name: '🐛' },
      { name: '✨ Új funkció', emoji_name: '✨' },
    ],
    default_reaction_emoji: { emoji_name: '🚀' },
    default_sort_order: 0, // Legutóbbi aktivitás
    default_forum_layout: 1, // Lista nézet
  })

  console.log(`✅ Fórum csatorna létrehozva! (ID: ${forum.id}, Név: ${forum.name})`)

  const tags: any[] = forum.available_tags || []
  const plannedTag = tags.find(t => t.name.includes('Tervezett')) || tags[0]

  // Útmutató thread létrehozása és kitűzése
  console.log('📝 Roadmap útmutató poszt létrehozása...')
  const guideContent = `📋 **Üdvözlünk a SuliBell Fejlesztői Roadmap Fórumán!**

Itt követjük és szervezzük átlátható kártyákon a weboldal és a Discord rendszer fejlesztési feladatait.

### ✍️ Új feladat felvétele:
1. Kattints az **Új bejegyzés** gombra.
2. Adj rövid, egyértelmű címet a fejlesztésnek vagy hibának.
3. Válaszd ki az állapotot és típust jelző **címkéket**:
   - 📋 **Tervezett** — ötletből elfogadott feladat
   - 🔨 **Folyamatban** — épp készülő fejlesztés
   - 🧪 **Tesztelés** — kiadás előtti ellenőrzés
   - ✅ **Kész** — élesítve a \`sulibell.vercel.app\`-on
   - 🐛 **Bugfix** / ✨ **Új funkció**
4. A feladat állapota szerint frissítsd a címkét és írd le alatta a részleteket!`

  try {
    const thread = await api(`/channels/${forum.id}/threads`, 'POST', {
      name: '📌 Roadmap használati útmutató és címkék',
      message: { content: guideContent },
      applied_tags: plannedTag ? [plannedTag.id] : [],
    })
    console.log(`✅ Útmutató thread létrehozva! (Thread ID: ${thread.id})`)
    try {
      await api(`/channels/${thread.id}`, 'PATCH', { flags: 1 << 1 })
      console.log('📌 Útmutató bejegyzés kitűzve a fórum tetejére!')
    } catch {
      // Nem baj ha a pin flag nem sikerül
    }
  } catch (err: any) {
    console.error('⚠️ Hiba az útmutató thread létrehozásakor:', err.message)
  }

  for (const post of archivedPosts) {
    try {
      await api(`/channels/${forum.id}/threads`, 'POST', {
        name: post.title,
        message: { content: post.body.slice(0, 1950) },
        applied_tags: plannedTag ? [plannedTag.id] : [],
      })
    } catch (err: any) {
      console.error(`⚠️ Átmigrálási hiba (${post.title}):`, err.message)
    }
  }

  console.log('\n🎉 Kész! A Discord Roadmap csatorna sikeresen Fórum (GUILD_FORUM) típusúra lett alakítva.')
}

run().catch(err => {
  console.error('\n❌ Hiba történt:', err.message)
  process.exit(1)
})
