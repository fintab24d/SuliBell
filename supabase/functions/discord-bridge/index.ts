// SuliBell <-> Discord Kétirányú Szinkronizációs Híd + Belépés/Kilépés Figyelő (Supabase Edge Function)
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
const SNAPSHOT_PREFIX = '__SULIBELL_MEMBERS_V1__:'

const getToken = () => (Deno.env.get('DISCORD_BOT_TOKEN') || '').trim()
const getGuild = () => (Deno.env.get('DISCORD_GUILD_ID') || DEFAULT_GUILD).trim()

interface ChannelMap {
  infoCat?: string
  welcome?: string
  rules?: string
  joins?: string
  announcements?: string
  updates?: string
  music?: string
  musicName?: string
  videos?: string
  videosName?: string
  ideas?: string
  bugs?: string
  logs?: string
  deployGit?: string
  studentRoleId?: string
  vipCat?: string
  vipInfo?: string
  vipChat?: string
  vipMusic?: string
  vipVoice?: string
  vipRoleId?: string
  staffRoleIds?: string[]
  fetchedAt: number
}

let cachedChannels: ChannelMap | null = null
let intentChecked = false
let welcomeSetupDone = false
let vipSetupDone = false
let visibilitySetupDone = false

const KOFI_PREFIX = '__KOFI__:'
const PERM = {
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  ADD_REACTIONS: 1n << 6n,
  CONNECT: 1n << 20n,
  SPEAK: 1n << 21n,
}
const pStr = (...bits: bigint[]) => bits.reduce((a, b) => a | b, 0n).toString()

interface KofiDonorEntry {
  id: string
  name: string
  amount: number
  currency: string
  discord?: string
  discord_user_id?: string
  vip_granted?: boolean
  message?: string
  date: string
}

interface KofiConfigPayload {
  url: string
  donors: KofiDonorEntry[]
}

async function getKofiConfigFromSupabase(): Promise<{ rowId?: string; schoolId?: string; config: KofiConfigPayload }> {
  const sbUrl = Deno.env.get('SUPABASE_URL')
  const sbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const defaultCfg: KofiConfigPayload = { url: 'https://ko-fi.com/sulibell', donors: [] }
  if (!sbUrl || !sbKey) return { config: defaultCfg }
  try {
    const res = await fetch(`${sbUrl}/rest/v1/announcements?select=id,school_id,text&order=id.asc`, {
      headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` }
    })
    if (!res.ok) return { config: defaultCfg }
    const rows = await res.json()
    let schoolId: string | undefined = rows[0]?.school_id
    if (!schoolId) {
      const sRes = await fetch(`${sbUrl}/rest/v1/schools?select=id&limit=1`, {
        headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` }
      })
      if (sRes.ok) {
        const sRows = await sRes.json()
        schoolId = sRows[0]?.id
      }
    }
    const kofiRow = rows.find((r: any) => typeof r.text === 'string' && r.text.startsWith(KOFI_PREFIX))
    if (!kofiRow) return { schoolId, config: defaultCfg }
    const raw = JSON.parse(kofiRow.text.slice(KOFI_PREFIX.length))
    return {
      rowId: kofiRow.id,
      schoolId: kofiRow.school_id || schoolId,
      config: {
        url: typeof raw?.url === 'string' && raw.url.trim() ? raw.url.trim() : defaultCfg.url,
        donors: Array.isArray(raw?.donors) ? raw.donors : []
      }
    }
  } catch {
    return { config: defaultCfg }
  }
}

async function saveKofiConfigToSupabase(config: KofiConfigPayload, existingRowId?: string, schoolId?: string): Promise<boolean> {
  const sbUrl = Deno.env.get('SUPABASE_URL')
  const sbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!sbUrl || !sbKey) return false
  const textPayload = `${KOFI_PREFIX}${JSON.stringify(config)}`
  try {
    if (existingRowId) {
      const res = await fetch(`${sbUrl}/rest/v1/announcements?id=eq.${existingRowId}`, {
        method: 'PATCH',
        headers: {
          apikey: sbKey,
          Authorization: `Bearer ${sbKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal'
        },
        body: JSON.stringify({ text: textPayload })
      })
      return res.ok
    } else if (schoolId) {
      const res = await fetch(`${sbUrl}/rest/v1/announcements`, {
        method: 'POST',
        headers: {
          apikey: sbKey,
          Authorization: `Bearer ${sbKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal'
        },
        body: JSON.stringify({ school_id: schoolId, text: textPayload, active_until: null })
      })
      return res.ok
    }
  } catch {
    // ignore
  }
  return false
}

async function runVipSetup(map: ChannelMap) {
  const guildId = getGuild()
  const me = await discordApi('/users/@me').catch(() => null)
  const botId = me?.id

  // 1. Ensure "💎 VIP Támogató" role exists
  if (!map.vipRoleId) {
    const createdRole = await discordApi(`/guilds/${guildId}/roles`, 'POST', {
      name: '💎 VIP Támogató',
      color: 0xfacc15,
      hoist: true,
      mentionable: true
    }).catch(() => null)
    if (createdRole?.id) {
      map.vipRoleId = createdRole.id
    }
  }

  const vipRoleId = map.vipRoleId
  const staffIds = map.staffRoleIds || []

  const vipPrivateOverwrites: any[] = [
    { id: guildId, type: 0, deny: pStr(PERM.VIEW_CHANNEL), allow: '0' }
  ]
  if (botId) {
    vipPrivateOverwrites.push({
      id: botId,
      type: 1,
      allow: pStr(PERM.VIEW_CHANNEL, PERM.SEND_MESSAGES, PERM.EMBED_LINKS, PERM.READ_MESSAGE_HISTORY, PERM.CONNECT, PERM.SPEAK),
      deny: '0'
    })
  }
  if (vipRoleId) {
    vipPrivateOverwrites.push({
      id: vipRoleId,
      type: 0,
      allow: pStr(PERM.VIEW_CHANNEL, PERM.SEND_MESSAGES, PERM.EMBED_LINKS, PERM.ATTACH_FILES, PERM.READ_MESSAGE_HISTORY, PERM.ADD_REACTIONS, PERM.CONNECT, PERM.SPEAK),
      deny: '0'
    })
  }
  for (const srId of staffIds) {
    vipPrivateOverwrites.push({
      id: srId,
      type: 0,
      allow: pStr(PERM.VIEW_CHANNEL, PERM.SEND_MESSAGES, PERM.EMBED_LINKS, PERM.ATTACH_FILES, PERM.READ_MESSAGE_HISTORY, PERM.ADD_REACTIONS, PERM.CONNECT, PERM.SPEAK),
      deny: '0'
    })
  }

  const vipCategoryOverwrites = vipPrivateOverwrites

  const vipInfoOverwrites: any[] = [
    { id: guildId, type: 0, deny: pStr(PERM.VIEW_CHANNEL, PERM.SEND_MESSAGES), allow: '0' }
  ]
  if (botId) {
    vipInfoOverwrites.push({
      id: botId,
      type: 1,
      allow: pStr(PERM.VIEW_CHANNEL, PERM.SEND_MESSAGES, PERM.EMBED_LINKS, PERM.READ_MESSAGE_HISTORY),
      deny: '0'
    })
  }
  if (vipRoleId) {
    vipInfoOverwrites.push({
      id: vipRoleId,
      type: 0,
      allow: pStr(PERM.VIEW_CHANNEL, PERM.READ_MESSAGE_HISTORY, PERM.ADD_REACTIONS),
      deny: pStr(PERM.SEND_MESSAGES)
    })
  }
  for (const srId of staffIds) {
    vipInfoOverwrites.push({
      id: srId,
      type: 0,
      allow: pStr(PERM.VIEW_CHANNEL, PERM.SEND_MESSAGES, PERM.EMBED_LINKS, PERM.READ_MESSAGE_HISTORY),
      deny: '0'
    })
  }

  const vipVoiceOverwrites: any[] = [
    { id: guildId, type: 0, deny: pStr(PERM.VIEW_CHANNEL, PERM.CONNECT, PERM.SPEAK), allow: '0' }
  ]
  if (botId) {
    vipVoiceOverwrites.push({
      id: botId,
      type: 1,
      allow: pStr(PERM.VIEW_CHANNEL, PERM.CONNECT, PERM.SPEAK),
      deny: '0'
    })
  }
  if (vipRoleId) {
    vipVoiceOverwrites.push({
      id: vipRoleId,
      type: 0,
      allow: pStr(PERM.VIEW_CHANNEL, PERM.CONNECT, PERM.SPEAK),
      deny: '0'
    })
  }
  for (const srId of staffIds) {
    vipVoiceOverwrites.push({
      id: srId,
      type: 0,
      allow: pStr(PERM.VIEW_CHANNEL, PERM.CONNECT, PERM.SPEAK),
      deny: '0'
    })
  }

  // 2. Ensure "💎 VIP ZÓNA" category exists with strictly private permissions
  if (!map.vipCat) {
    const cat = await discordApi(`/guilds/${guildId}/channels`, 'POST', {
      name: '💎 VIP ZÓNA',
      type: 4,
      position: 2,
      permission_overwrites: vipCategoryOverwrites
    }).catch(() => null)
    if (cat?.id) {
      map.vipCat = cat.id
    }
  } else {
    await discordApi(`/channels/${map.vipCat}`, 'PATCH', {
      permission_overwrites: vipCategoryOverwrites
    }).catch(() => {})
  }

  // 3. Ensure "#🎁-vip-infó-és-fal" exists and has strict VIP-only view permissions
  if (!map.vipInfo && map.vipCat) {
    const ch = await discordApi(`/guilds/${guildId}/channels`, 'POST', {
      name: '🎁-vip-infó-és-fal',
      type: 0,
      parent_id: map.vipCat,
      topic: '☕ SuliBell Ko-fi támogatók dicsőségfala és VIP rang információk! Támogasd az oldalt, írd be a Discord neved, és automatikusan megkapod a 💎 VIP Támogató rangot!',
      permission_overwrites: vipInfoOverwrites
    }).catch(() => null)
    if (ch?.id) {
      map.vipInfo = ch.id
      await discordApi(`/channels/${ch.id}/messages`, 'POST', {
        embeds: [{
          title: '💎 SuliBell VIP Zóna & Ko-fi Támogatás',
          description: 'Köszönjük mindenkinek, aki támogatja a **SuliBell** fejlesztését és fenntartását! ☕💖\n\nA támogatók felkerülnek a **weboldal Támogatói Toplistájára**, valamint itt a Discordon megkapják az exkluzív **💎 VIP Támogató** rangot!',
          color: 0xfacc15,
          fields: [
            {
              name: '🎁 Mit ad a 💎 VIP Támogató rang?',
              value: '• **Kiemelt arany név** és külön kategória a taglistában\n• Hozzáférés a privát **#💎-vip-társalgó** és **🔊 VIP Társalgó** szobákhoz\n• Hozzáférés a **#👑-vip-zenekérés** szobához, ahonnan a beküldött zenék **💎 VIP jelvénnyel és +2 bónusz szavazattal** kerülnek be a SuliBell zenegépébe!\n• Megjelenés a SuliBell főoldali **🏆 Támogatói Toplistáján**'
            },
            {
              name: '⚡ Hogyan kapod meg automatikusan a rangot?',
              value: '1. Kattints a weboldalon a **„☕ Támogatás Ko-fi-n”** gombra.\n2. A támogatási üzenetbe (**Message**) írd bele a Discord felhasználónevedet (pl. `@felhasznalonev` vagy `discord: felhasznalonev`).\n3. A SuliBell bot a támogatás pillanatában **automatikusan ráteszi a 💎 VIP Támogató rangot** a fiókodra és kiírja a nevedet ide a dicsőségfalra!'
            }
          ],
          footer: { text: 'SuliBell • Ko-fi & Discord VIP rendszer' },
          timestamp: new Date().toISOString()
        }]
      }).catch(() => {})
    }
  } else if (map.vipInfo) {
    await discordApi(`/channels/${map.vipInfo}`, 'PATCH', {
      parent_id: map.vipCat,
      permission_overwrites: vipInfoOverwrites
    }).catch(() => {})
  }

  // 4. Ensure "#💎-vip-társalgó" exists
  if (!map.vipChat && map.vipCat) {
    const ch = await discordApi(`/guilds/${guildId}/channels`, 'POST', {
      name: '💎-vip-társalgó',
      type: 0,
      parent_id: map.vipCat,
      topic: '💎 Exkluzív VIP társalgó a SuliBell Ko-fi támogatóinak és a csapatnak.',
      permission_overwrites: vipPrivateOverwrites
    }).catch(() => null)
    if (ch?.id) {
      map.vipChat = ch.id
      await discordApi(`/channels/${ch.id}/messages`, 'POST', {
        embeds: [{
          title: '🥂 Üdv a VIP Társalgóban!',
          description: 'Ez a szoba kizárólag a **💎 VIP Támogató** ranggal rendelkezőknek és a SuliBell csapatnak látható. Köszönjük, hogy támogatod a SuliBell-t!',
          color: 0xfacc15
        }]
      }).catch(() => {})
    }
  } else if (map.vipChat) {
    await discordApi(`/channels/${map.vipChat}`, 'PATCH', {
      parent_id: map.vipCat,
      permission_overwrites: vipPrivateOverwrites
    }).catch(() => {})
  }

  // 5. Ensure "#👑-vip-zenekérés" exists
  if (!map.vipMusic && map.vipCat) {
    const ch = await discordApi(`/guilds/${guildId}/channels`, 'POST', {
      name: '👑-vip-zenekérés',
      type: 0,
      parent_id: map.vipCat,
      topic: '👑 VIP Zenekérés — az ide beküldött zenék és videók 💎 VIP jelvénnyel és +2 bónusz szavazattal indulnak a weboldalon!',
      permission_overwrites: vipPrivateOverwrites
    }).catch(() => null)
    if (ch?.id) {
      map.vipMusic = ch.id
      await discordApi(`/channels/${ch.id}/messages`, 'POST', {
        embeds: [{
          title: '👑 VIP Zenekérés (+2 Bónusz Szavazat!)',
          description: 'Küldj be ide egy **YouTube**, **Spotify** vagy **SoundCloud** linket! A SuliBell automatikusan szinkronizálja a weboldalra **💎 VIP jelvénnyel** és **3 kezdő szavazattal (1 + 2 VIP bónusz)**, így a kérésed azonnal a kívánságlista élére ugrik!',
          color: 0xfacc15
        }]
      }).catch(() => {})
    }
  } else if (map.vipMusic) {
    await discordApi(`/channels/${map.vipMusic}`, 'PATCH', {
      parent_id: map.vipCat,
      permission_overwrites: vipPrivateOverwrites
    }).catch(() => {})
  }

  // 6. Ensure "🔊 VIP Társalgó" voice channel exists
  if (!map.vipVoice && map.vipCat) {
    const ch = await discordApi(`/guilds/${guildId}/channels`, 'POST', {
      name: '🔊 VIP Társalgó',
      type: 2,
      parent_id: map.vipCat,
      permission_overwrites: vipVoiceOverwrites
    }).catch(() => null)
    if (ch?.id) {
      map.vipVoice = ch.id
    }
  } else if (map.vipVoice) {
    await discordApi(`/channels/${map.vipVoice}`, 'PATCH', {
      parent_id: map.vipCat,
      permission_overwrites: vipVoiceOverwrites
    }).catch(() => {})
  }
}

/**
 * Minden szobát és kategóriát elrejt @everyone / Diák elől (csak a megadott staff rangoknak látható),
 * KIVÉVE a VIP Zónát (azt a runVipSetup kezeli), az alapokat (üdvözlő, szabályzat, közlemények, frissítések)
 * és a diák társalgókat.
 */
async function runChannelVisibilitySetup(map: ChannelMap): Promise<{ locked: string[]; keptPublic: string[] }> {
  const guildId = getGuild()
  const [chs, me]: [any[], any] = await Promise.all([
    discordApi(`/guilds/${guildId}/channels`),
    discordApi('/users/@me').catch(() => null),
  ])
  const botId = me?.id
  const staffIds = map.staffRoleIds || []

  if (staffIds.length === 0) {
    return { locked: [], keptPublic: [] }
  }

  const privateOverwrites: any[] = [
    { id: guildId, type: 0, deny: pStr(PERM.VIEW_CHANNEL), allow: '0' },
  ]
  if (map.studentRoleId) {
    privateOverwrites.push({
      id: map.studentRoleId,
      type: 0,
      deny: pStr(PERM.VIEW_CHANNEL),
      allow: '0',
    })
  }
  if (botId) {
    privateOverwrites.push({
      id: botId,
      type: 1,
      allow: pStr(PERM.VIEW_CHANNEL, PERM.SEND_MESSAGES, PERM.EMBED_LINKS, PERM.READ_MESSAGE_HISTORY, PERM.CONNECT, PERM.SPEAK),
      deny: '0',
    })
  }
  for (const srId of staffIds) {
    privateOverwrites.push({
      id: srId,
      type: 0,
      allow: pStr(PERM.VIEW_CHANNEL, PERM.SEND_MESSAGES, PERM.EMBED_LINKS, PERM.ATTACH_FILES, PERM.READ_MESSAGE_HISTORY, PERM.ADD_REACTIONS, PERM.CONNECT, PERM.SPEAK),
      deny: '0',
    })
  }

  const isAlwaysPrivate = (n: string) =>
    n.includes('napló') || n.includes('naplo') || n.includes('deploy') || n.includes('git') ||
    n.includes('belépés') || n.includes('belepes') || n.includes('kilépés') || n.includes('kilepes') ||
    n.includes('admin') || n.includes('staff') || n.includes('mod') || n.includes('log')

  const isBasicOrStudent = (c: any): boolean => {
    const n = String(c.name || '').toLowerCase()
    if (isAlwaysPrivate(n)) return false
    if (c.type === 4) {
      // Kategóriák: alap információk / diák / társalgó / közösség / általános maradhat látható
      return n.includes('információ') || n.includes('informacio') || n.includes('alap') ||
        n.includes('diák') || n.includes('diak') || n.includes('társalgó') || n.includes('tarsalgo') ||
        n.includes('közösség') || n.includes('kozosseg') || n.includes('általános') || n.includes('altalanos')
    }
    // Alapok (üdvözlő, szabályzat, közlemények, frissítések)
    if (
      n.includes('üdvözlő') || n.includes('udvozlo') || n.includes('welcome') ||
      n.includes('szabályzat') || n.includes('szabalyzat') || n.includes('rules') ||
      n.includes('közlemény') || n.includes('kozlemeny') || n.includes('announcement') ||
      n.includes('frissítés') || n.includes('frissites') || n.includes('update')
    ) return true
    // Diák társalgók (szöveges és hang)
    if (
      n.includes('társalgó') || n.includes('tarsalgo') ||
      n.includes('általános') || n.includes('altalanos') || n.includes('general') ||
      n.includes('csevegő') || n.includes('csevego') || n.includes('chat') ||
      n.includes('beszélgető') || n.includes('beszelgeto') ||
      n.includes('diák') || n.includes('diak')
    ) return true
    return false
  }

  const locked: string[] = []
  const keptPublic: string[] = []

  for (const c of chs) {
    const n = String(c.name || '').toLowerCase()
    // A VIP Zónát a runVipSetup kezeli
    if (n.includes('vip') || (map.vipCat && (c.id === map.vipCat || c.parent_id === map.vipCat))) {
      continue
    }
    if (isBasicOrStudent(c)) {
      keptPublic.push(c.name)
      continue
    }
    await discordApi(`/channels/${c.id}`, 'PATCH', {
      permission_overwrites: privateOverwrites,
    }).catch(() => {})
    locked.push(c.name)
  }

  return { locked, keptPublic }
}

function extractDiscordHint(message?: string, directDiscord?: string, fromName?: string): string {
  if (directDiscord && directDiscord.trim()) return directDiscord.trim().replace(/^@/, '')
  const msg = String(message || '')
  const m1 = msg.match(/discord\s*[:=\-]?\s*@?([a-zA-Z0-9_.]{2,32})/i)
  if (m1) return m1[1]
  const m2 = msg.match(/@([a-zA-Z0-9_.]{2,32})/)
  if (m2) return m2[1]
  const m3 = msg.match(/\b(\d{17,20})\b/)
  if (m3) return m3[1]
  return String(fromName || '').trim().replace(/^@/, '')
}

async function findAndGrantVipRole(
  chMap: ChannelMap,
  discordCandidate?: string,
  fallbackName?: string
): Promise<{ granted: boolean; userId?: string; username?: string; displayName?: string }> {
  const guildId = getGuild()
  if (!chMap.vipRoleId) {
    await runVipSetup(chMap).catch(() => {})
  }
  const roleId = chMap.vipRoleId
  if (!roleId) return { granted: false }

  const candidates = [discordCandidate, fallbackName]
    .map(s => String(s || '').trim().replace(/^@/, ''))
    .filter(Boolean)

  if (candidates.length === 0) return { granted: false }

  const members: any[] = await discordApi(`/guilds/${guildId}/members?limit=1000`).catch(() => [])

  let matchedMember: any = null
  for (const cand of candidates) {
    const cl = cand.toLowerCase()
    matchedMember = members.find(m => {
      const u = m.user || {}
      return (
        u.id === cand ||
        String(u.username || '').toLowerCase() === cl ||
        String(u.global_name || '').toLowerCase() === cl ||
        String(m.nick || '').toLowerCase() === cl
      )
    })
    if (matchedMember) break
  }

  if (!matchedMember && candidates[0]) {
    const found: any[] = await discordApi(`/guilds/${guildId}/members/search?query=${encodeURIComponent(candidates[0])}&limit=5`).catch(() => [])
    if (Array.isArray(found) && found.length > 0) matchedMember = found[0]
  }

  if (!matchedMember?.user?.id) return { granted: false }

  const userId = matchedMember.user.id
  let granted = false
  try {
    await discordApi(`/guilds/${guildId}/members/${userId}/roles/${roleId}`, 'PUT')
    granted = true
  } catch {
    granted = false
  }
  return {
    granted,
    userId,
    username: matchedMember.user.username,
    displayName: matchedMember.nick || matchedMember.user.global_name || matchedMember.user.username
  }
}

async function handleKofiDonation(
  chMap: ChannelMap,
  payload: {
    id?: string
    name: string
    amount: number
    currency?: string
    discord?: string
    message?: string
    date?: string
  }
) {
  const donorName = String(payload.name || 'Névtelen támogató').trim() || 'Névtelen támogató'
  const amount = Math.max(0, Number(payload.amount) || 0)
  const currency = String(payload.currency || 'HUF').trim().toUpperCase() || 'HUF'
  const message = payload.message ? String(payload.message).trim().slice(0, 220) : undefined
  const date = payload.date || new Date().toISOString().slice(0, 10)
  const discordHint = extractDiscordHint(message, payload.discord, donorName)

  const vipRes = await findAndGrantVipRole(chMap, discordHint, donorName)

  const { rowId, schoolId, config } = await getKofiConfigFromSupabase()
  const existingIdx = config.donors.findIndex(d =>
    (vipRes.userId && d.discord_user_id === vipRes.userId) ||
    (discordHint && d.discord && d.discord.toLowerCase() === discordHint.toLowerCase()) ||
    d.name.toLowerCase() === donorName.toLowerCase()
  )

  if (existingIdx >= 0) {
    const prev = config.donors[existingIdx]
    const sameCurr = (prev.currency || 'HUF').toUpperCase() === currency
    config.donors[existingIdx] = {
      ...prev,
      amount: sameCurr ? Number(prev.amount || 0) + amount : amount,
      currency: sameCurr ? prev.currency : currency,
      discord: vipRes.username || discordHint || prev.discord,
      discord_user_id: vipRes.userId || prev.discord_user_id,
      vip_granted: vipRes.granted || prev.vip_granted,
      message: message || prev.message,
      date
    }
  } else {
    config.donors.push({
      id: payload.id || `kofi_${Date.now().toString(36)}`,
      name: donorName,
      amount,
      currency,
      discord: vipRes.username || discordHint || undefined,
      discord_user_id: vipRes.userId,
      vip_granted: vipRes.granted,
      message,
      date
    })
  }

  const savedToDb = await saveKofiConfigToSupabase(config, rowId, schoolId)

  const amountText = currency === 'HUF' || currency === 'FT'
    ? `${Math.round(amount).toLocaleString('hu-HU')} Ft`
    : currency === 'EUR'
      ? `${amount} €`
      : currency === 'USD'
        ? `$${amount}`
        : `${amount} ${currency}`

  const vipMention = vipRes.userId ? `<@${vipRes.userId}>` : `**${donorName}**`
  const embed = {
    title: '☕ Új Ko-fi Támogatás érkezett! 💎',
    description: `Hatalmas köszönet ${vipMention} támogatónknak a SuliBell támogatásáért! 💖`,
    color: 0xfacc15,
    fields: [
      { name: '🏆 Támogató', value: donorName, inline: true },
      { name: '💰 Összeg', value: amountText, inline: true },
      {
        name: '💎 Discord VIP Rang',
        value: vipRes.granted && vipRes.userId
          ? `✅ Kiosztva: <@${vipRes.userId}>`
          : discordHint
            ? `⏳ Belépéskor automatikusan megkapja (${discordHint})`
            : '💎 VIP Toplista tag',
        inline: true
      },
      ...(message ? [{ name: '💬 Üzenet', value: `„${message}”` }] : [])
    ],
    footer: { text: 'SuliBell • Ko-fi Támogatói Rendszer' },
    timestamp: new Date().toISOString()
  }

  if (chMap.vipInfo) {
    await discordApi(`/channels/${chMap.vipInfo}/messages`, 'POST', {
      content: vipRes.userId ? `🎉 Köszönjük a támogatást, <@${vipRes.userId}>! Megkaptad a **💎 VIP Támogató** rangot!` : undefined,
      embeds: [embed]
    }).catch(() => {})
  }
  if (chMap.vipChat) {
    await discordApi(`/channels/${chMap.vipChat}/messages`, 'POST', {
      content: vipRes.userId ? `🥂 Üdvözöljük <@${vipRes.userId}>-t a VIP Társalgóban!` : `🥂 Új Ko-fi támogatónk érkezett: **${donorName}**!`,
      embeds: [embed]
    }).catch(() => {})
  }

  return {
    ok: true,
    donor: donorName,
    amount,
    currency,
    vipGranted: vipRes.granted,
    discordUserId: vipRes.userId,
    discordUsername: vipRes.username,
    savedToDb
  }
}
let memoryMembers: Record<string, { name: string; avatar?: string }> | null = null
let lastMemberCheckAt = 0
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
  if (res.status === 429) {
    const retry = await res.json().catch(() => ({ retry_after: 1.5 }))
    await new Promise(r => setTimeout(r, Math.ceil((retry.retry_after || 1.5) * 1000) + 150))
    return discordApi(path, method, body)
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Discord API (${res.status} ${path}): ${errText}`)
  }
  if (res.status === 204) return null
  return res.json()
}

async function runWelcomeAndJoinSetup(map: ChannelMap) {
  const guildId = getGuild()

  if (!map.joins) {
    const created = await discordApi(`/guilds/${guildId}/channels`, 'POST', {
      name: '🚪-belépések-kilépések',
      type: 0,
      parent_id: map.infoCat,
      position: 1,
      topic: 'SuliBell belépési és kilépési napló — itt látod, ki csatlakozott vagy lépett ki a szerverről.',
    })
    map.joins = created.id
  }

  if (map.joins) {
    await discordApi(`/guilds/${guildId}`, 'PATCH', {
      system_channel_id: map.joins,
      system_channel_flags: 0,
    }).catch(() => {})
  }

  if (map.welcome) {
    await discordApi(`/channels/${map.welcome}`, 'PATCH', {
      topic: '🔔 Üdvözlünk a SuliBell hivatalos Discord szerverén! A te iskolád, a te ritmusod.',
    }).catch(() => {})

    const oldMsgs: any[] = await discordApi(`/channels/${map.welcome}/messages?limit=10`).catch(() => [])
    const alreadySuliBell = oldMsgs.some(
      m => m.author?.bot && m.embeds?.[0]?.title?.includes('SuliBell')
    )

    if (!alreadySuliBell) {
      for (const om of oldMsgs) {
        if (om.author?.bot) {
          await discordApi(`/channels/${map.welcome}/messages/${om.id}`, 'DELETE').catch(() => {})
        }
      }

      await discordApi(`/channels/${map.welcome}/messages`, 'POST', {
        embeds: [
          {
            title: '🔔 Üdvözlünk a SuliBell hivatalos Discord szerverén!',
            description:
              'Üdv a **SuliBell** közösségében! 🚀\nEz a Discord szerver **élőben össze van kötve a SuliBell weboldallal** — az iskolai csengővel, visszaszámlálóval és szüneti zenegéppel!',
            color: 0x2de2ff,
            fields: [
              {
                name: '⏱️ Mi az a SuliBell?',
                value:
                  'Másodperc-pontos csengetési visszaszámláló, saját órarend-szűrő, szüneti zene- és videólejátszó, közhangulat-mérő és AI-asszisztens a sulidhoz.',
              },
              {
                name: '🎵 Élő Zenekérés a Szünetekre',
                value: `Írj be egy zenecímet vagy YouTube-linket a <#${map.music || ''}> szobába, és a **SuliBell Bot** automatikusan felteszi a weboldal szüneti kívánságlistájára! Ha reakciót nyomtok rá itt Discordon, azzal **szavazatot (🔥)** adtok neki az oldalon is!`,
              },
              {
                name: '📢 Órarend-változások, Menza & Közlemények',
                value: `A <#${map.announcements || ''}> csatornában azonnal megjelenik minden új iskolai közlemény, elmaradó óra, helyettesítés, napi étlap és szavazás.`,
              },
              {
                name: '💡 Ötletek & 🐛 Hibajelentés',
                value: `Van egy jó ötleted a SuliBellhez, vagy hibát találtál? Írd meg az <#${map.ideas || ''}> vagy <#${map.bugs || ''}> csatornába közvetlenül a fejlesztőknek!`,
              },
              {
                name: '🚪 Belépések és Kilépések',
                value: `A <#${map.joins || ''}> szobában követheted, ki csatlakozott a SuliBell közösséghez vagy ki lépett ki.`,
              },
            ],
            footer: { text: 'SuliBell • A te iskolád, a te ritmusod! 🔔' },
            timestamp: new Date().toISOString(),
          },
        ],
      })
    }
  }

  if (map.joins) {
    const joinMsgs: any[] = await discordApi(`/channels/${map.joins}/messages?limit=5`).catch(() => [])
    if (joinMsgs.length === 0) {
      await discordApi(`/channels/${map.joins}/messages`, 'POST', {
        embeds: [
          {
            title: '🚪 SuliBell Belépések és Kilépések',
            description:
              'Ebben a csatornában a **SuliBell Bot** automatikusan jelzi, ha egy új diák **belép (🔔 Becsengettek!)** a szerverre, vagy ha valaki **kilép (🔕 Kicsengettek!)**.',
            color: 0x39ff7a,
            footer: { text: 'SuliBell Automatikus Tagfigyelő' },
          },
        ],
      }).catch(() => {})
    }
  }
}

async function ensureIntentAndChannels(forceRefresh = false): Promise<ChannelMap> {
  if (!intentChecked) {
    intentChecked = true
    try {
      const app = await discordApi('/applications/@me')
      const wantedFlags = (1 << 15) | (1 << 19)
      if (app && typeof app.flags === 'number' && (app.flags & wantedFlags) !== wantedFlags) {
        await discordApi('/applications/@me', 'PATCH', {
          flags: app.flags | wantedFlags,
        })
      }
    } catch {
      // ignore
    }
  }

  if (!forceRefresh && cachedChannels && Date.now() - cachedChannels.fetchedAt < 5 * 60_000) {
    return cachedChannels
  }

  const guildId = getGuild()
  const [chs, roles]: [any[], any[]] = await Promise.all([
    discordApi(`/guilds/${guildId}/channels`),
    discordApi(`/guilds/${guildId}/roles`).catch(() => []),
  ])

  const map: ChannelMap = { fetchedAt: Date.now() }

  const staffRoleIds: string[] = []
  for (const r of roles) {
    const rn = String(r.name || '').toLowerCase()
    if (rn.includes('diák') || rn.includes('diak')) {
      map.studentRoleId = r.id
    }
    if (rn.includes('vip') || rn.includes('támogató') || rn.includes('tamogato')) {
      map.vipRoleId = r.id
    }
    if (rn.includes('dev') || rn.includes('fejleszt') || rn.includes('moderátor') || rn.includes('moderator') || rn.includes('admin') || rn.includes('főadmin') || rn.includes('foadmin') || rn.includes('tulajdonos') || rn.includes('owner') || rn.includes('staff')) {
      staffRoleIds.push(r.id)
    }
  }
  map.staffRoleIds = staffRoleIds

  for (const c of chs) {
    const n = String(c.name || '').toLowerCase()
    if (c.type === 4 && (n.includes('információ') || n.includes('informacio'))) {
      map.infoCat = c.id
    }
    if (c.type === 4 && n.includes('vip')) {
      map.vipCat = c.id
    }
    if (c.type === 2 && n.includes('vip')) {
      map.vipVoice = c.id
      continue
    }
    if (c.type === 15 && (n.includes('ötlet') || n.includes('otlet'))) {
      map.ideas = c.id
      continue
    }
    if (c.type !== 0) continue
    if (n.includes('vip') && (n.includes('infó') || n.includes('info') || n.includes('fal'))) map.vipInfo = c.id
    else if (n.includes('vip') && (n.includes('társalgó') || n.includes('tarsalgo') || n.includes('chat'))) map.vipChat = c.id
    else if (n.includes('vip') && (n.includes('zene') || n.includes('zenekérés') || n.includes('zenekeres'))) map.vipMusic = c.id
    else if (n.includes('üdvözlő') || n.includes('udvozlo')) map.welcome = c.id
    else if (n.includes('szabályzat') || n.includes('szabalyzat')) map.rules = c.id
    else if (n.includes('belépés') || n.includes('belepes') || n.includes('kilépés')) map.joins = c.id
    else if (n.includes('közlemény') || n.includes('kozlemeny')) map.announcements = c.id
    else if (n.includes('frissítés') || n.includes('frissites')) map.updates = c.id
    else if (n.includes('zenekérés') || n.includes('zenekeres') || n.includes('zene')) {
      map.music = c.id
      map.musicName = `#${c.name}`
    }
    else if (n.includes('videó') || n.includes('video')) {
      map.videos = c.id
      map.videosName = `#${c.name}`
    }
    else if (n.includes('ötlet') || n.includes('otlet')) map.ideas = c.id
    else if (n.includes('hiba')) map.bugs = c.id
    else if (n.includes('napló') || n.includes('naplo')) map.logs = c.id
    else if (n.includes('deploy') || n.includes('git')) map.deployGit = c.id
  }

  if (!welcomeSetupDone || !map.joins) {
    welcomeSetupDone = true
    await runWelcomeAndJoinSetup(map).catch(() => {})
  }
  if (!vipSetupDone || !map.vipRoleId || !map.vipCat || !map.vipChat || !map.vipInfo || !map.vipMusic || !map.vipVoice) {
    vipSetupDone = true
    await runVipSetup(map).catch(() => {})
  }
  if (!visibilitySetupDone) {
    visibilitySetupDone = true
    await runChannelVisibilitySetup(map).catch(() => {})
  }

  cachedChannels = map
  return map
}

async function checkMemberJoinsAndLeaves(chMap: ChannelMap) {
  if (!chMap.joins || Date.now() - lastMemberCheckAt < 12_000) return
  lastMemberCheckAt = Date.now()

  const guildId = getGuild()
  let members: any[] = []
  try {
    members = await discordApi(`/guilds/${guildId}/members?limit=1000`)
  } catch {
    return
  }
  if (!Array.isArray(members) || members.length === 0) return

  const currentMap: Record<string, { name: string; avatar?: string }> = {}
  let humanCount = 0

  for (const m of members) {
    const u = m.user
    if (!u) continue
    if (!u.bot) humanCount++
    const displayName = m.nick || u.global_name || u.username || 'Tag'
    const avatarUrl = u.avatar
      ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128`
      : undefined
    currentMap[u.id] = { name: displayName, avatar: avatarUrl }
  }

  let prevMap = memoryMembers
  let snapshotMsgId: string | undefined

  if (chMap.logs) {
    const logMsgs: any[] = await discordApi(`/channels/${chMap.logs}/messages?limit=15`).catch(() => [])
    for (const lm of logMsgs) {
      if (lm.author?.bot && typeof lm.content === 'string' && lm.content.startsWith(SNAPSHOT_PREFIX)) {
        snapshotMsgId = lm.id
        if (!prevMap) {
          try {
            prevMap = JSON.parse(lm.content.slice(SNAPSHOT_PREFIX.length))
          } catch {
            prevMap = null
          }
        }
        break
      }
    }
  }

  let changed = false

  if (prevMap) {
    for (const [uid, info] of Object.entries(currentMap)) {
      if (!prevMap[uid]) {
        changed = true
        if (chMap.studentRoleId) {
          discordApi(`/guilds/${guildId}/members/${uid}/roles/${chMap.studentRoleId}`, 'PUT').catch(() => {})
        }
        if (chMap.vipRoleId) {
          const memberObj = members.find((x: any) => x.user?.id === uid)
          const uName = String(memberObj?.user?.username || '').toLowerCase()
          const gName = String(memberObj?.user?.global_name || '').toLowerCase()
          const dName = String(info.name || '').toLowerCase()
          getKofiConfigFromSupabase().then(({ rowId, schoolId, config }) => {
            const matchIdx = config.donors.findIndex(d => {
              const dh = String(d.discord || '').toLowerCase().replace(/^@/, '')
              const dn = String(d.name || '').toLowerCase()
              return d.discord_user_id === uid || (dh && (dh === uName || dh === gName || dh === dName)) || dn === uName || dn === dName
            })
            if (matchIdx >= 0) {
              discordApi(`/guilds/${guildId}/members/${uid}/roles/${chMap.vipRoleId}`, 'PUT').then(() => {
                config.donors[matchIdx].discord_user_id = uid
                config.donors[matchIdx].vip_granted = true
                saveKofiConfigToSupabase(config, rowId, schoolId).catch(() => {})
              }).catch(() => {})
            }
          }).catch(() => {})
        }
        await discordApi(`/channels/${chMap.joins}/messages`, 'POST', {
          embeds: [
            {
              title: '🔔 Becsengettek! Új tag csatlakozott!',
              description: `Üdvözlünk a **SuliBell** hivatalos Discord szerverén, <@${uid}> (**${info.name}**)! 🎓\nNézz körül a csatornákban, kérj zenét a szünetekre a <#${chMap.music || ''}> szobában, és érezd jól magad!`,
              color: 0x39ff7a,
              thumbnail: info.avatar ? { url: info.avatar } : undefined,
              footer: { text: `SuliBell Közösség • Diákok és tagok száma: ${humanCount} fő` },
              timestamp: new Date().toISOString(),
            },
          ],
        }).catch(() => {})
      }
    }

    for (const [uid, info] of Object.entries(prevMap)) {
      if (!currentMap[uid]) {
        changed = true
        await discordApi(`/channels/${chMap.joins}/messages`, 'POST', {
          embeds: [
            {
              title: '🔕 Kicsengettek! Egy tag kilépett',
              description: `**${info.name}** elhagyta a **SuliBell** Discord szervert. 👋`,
              color: 0xff4fc3,
              footer: { text: `SuliBell Közösség • Maradtunk: ${humanCount} fő` },
              timestamp: new Date().toISOString(),
            },
          ],
        }).catch(() => {})
      }
    }
  } else {
    changed = true
  }

  memoryMembers = currentMap

  if (changed && chMap.logs) {
    const payload = SNAPSHOT_PREFIX + JSON.stringify(currentMap)
    if (payload.length < 1950) {
      if (snapshotMsgId) {
        discordApi(`/channels/${chMap.logs}/messages/${snapshotMsgId}`, 'PATCH', { content: payload }).catch(() => {})
      } else {
        discordApi(`/channels/${chMap.logs}/messages`, 'POST', { content: payload }).catch(() => {})
      }
    }
  }
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

function isProfane(text: string): boolean {
  if (!text) return false
  const norm = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[@4]/g, 'a').replace(/[3]/g, 'e').replace(/[1!|]/g, 'i').replace(/[0]/g, 'o').replace(/[$5]/g, 's')
  const bad = ['fasz', 'geci', 'kurva', 'picsa', 'pina', 'ribanc', 'kocsog', 'seggfej', 'anyadat', 'fuck', 'bitch', 'cunt', 'dick', 'pussy', 'porn', 'xxx', 'hentai', 'nude', 'explicit', 'uncensored']
  return bad.some(w => norm.includes(w))
}

function hasExplicitTextMarker(text: string): boolean {
  if (!text) return false
  if (/\[\s*E\s*\]|\(\s*E\s*\)/.test(text)) return true
  if (/(?:^|[^\d])(?:18\s*\+|\+\s*18)(?:[^\d]|$)|🔞|\b(?:explicit|uncensored|unrated|korhat[aá]ros)\b|parental[\s_-]+advisory|age[\s_-]*restricted/i.test(text)) {
    return true
  }
  return isProfane(text)
}

function hasCleanVersionMarker(text: string): boolean {
  return /\b(clean|edited|radio\s+edit|clean\s+version|instrumental|karaoke|no\s+swear|tv\s+edit|family\s+friendly)\b/i.test(text || '')
}

function stripTitleNoise(raw: string): string {
  return (raw || '')
    .replace(/[–—]/g, '-')
    .replace(/[\(\[]\s*(?:(?:feat\.?|ft\.?|with|prod\.?)\b[^\)\]]*|official\s*(?:music\s*)?(?:video|audio|lyric(?:s)?|visualizer)?|lyrics?|audio|music\s*video|visualizer|hd|4k|ncs\s*release)\s*[\)\]]/gi, '')
    .replace(/\s*\|\s*[^|]*$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const META_STOP_WORDS = new Set(['official', 'video', 'music', 'audio', 'lyrics', 'lyric', 'hd', '4k', 'ncs', 'release', 'visualizer', 'feat', 'ft', 'topic', 'vevo', 'the'])

function normMetaStr(raw: string): string {
  return (raw || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’!]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(w => w && !META_STOP_WORDS.has(w))
    .join(' ')
    .trim()
}

function cleanAuthorName(author: string): string {
  return (author || '')
    .replace(/\s*-\s*topic$/i, '')
    .replace(/\s*(?:vevo|official)$/i, '')
    .trim()
}

function parseArtistTrack(rawTitle: string, fallbackAuthor?: string): { artist: string; track: string; query: string } {
  const cleaned = stripTitleNoise(rawTitle)
  const sepIdx = cleaned.indexOf(' - ')
  let artist = ''
  let track = cleaned
  if (sepIdx > 0) {
    artist = cleaned.slice(0, sepIdx).trim()
    track = cleaned.slice(sepIdx + 3).trim()
  } else if (fallbackAuthor) {
    const auth = cleanAuthorName(fallbackAuthor)
    if (auth && !normMetaStr(cleaned).includes(normMetaStr(auth))) {
      artist = auth
    }
  }
  const query = artist ? `${artist} ${track}` : track
  return { artist, track, query: query.trim() }
}

function trackCandidateMatches(params: {
  candArtist: string
  candTrack: string
  targetArtistNorm: string
  targetTrackNorm: string
  fullQueryNorm: string
  isTopHit: boolean
}): boolean {
  const candTrackNorm = normMetaStr(stripTitleNoise(params.candTrack))
  const candArtistNorm = normMetaStr(cleanAuthorName(params.candArtist))
  if (!candTrackNorm || !params.targetTrackNorm) return false

  const artistOk = params.targetArtistNorm
    ? candArtistNorm.length >= 2 && (
        candArtistNorm.split(' ').some(w => w.length >= 2 && params.targetArtistNorm.split(' ').includes(w)) ||
        params.targetArtistNorm.includes(candArtistNorm) ||
        candArtistNorm.includes(params.targetArtistNorm)
      )
    : params.isTopHit

  if (candTrackNorm === params.targetTrackNorm && artistOk) return true
  if (params.fullQueryNorm && `${candArtistNorm} ${candTrackNorm}`.trim() === params.fullQueryNorm) return true
  return false
}

const explicitCheckCache = new Map<string, { ok: boolean; error?: string }>()

async function fetchYtDetails(ytId: string): Promise<{ blocked?: string; title?: string; author?: string }> {
  let oembedTitle: string | undefined
  let oembedAuthor: string | undefined

  try {
    const oeRes = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${ytId}&format=json`)
    if (oeRes.status === 401 || oeRes.status === 403) {
      return { blocked: 'Ez a videó korhatáros (18+) vagy beágyazása letiltott. Kérjük, válassz másik videót!' }
    }
    if (oeRes.ok) {
      const oe = await oeRes.json()
      oembedTitle = String(oe?.title || '').trim()
      oembedAuthor = String(oe?.author_name || '').trim()
      if (oembedTitle) ytTitleCache.set(ytId, oembedTitle.slice(0, 60))
      if (hasExplicitTextMarker(oembedTitle) || hasExplicitTextMarker(oembedAuthor)) {
        return { blocked: `A YouTube videó explicit vagy korhatáros jelölésű („${oembedTitle.slice(0, 42)}”).` }
      }
    }
  } catch {
    // ignore oembed error
  }

  try {
    const pRes = await fetch('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      body: JSON.stringify({
        context: { client: { clientName: 'WEB', clientVersion: '2.20240101.00.00' } },
        videoId: ytId,
      }),
    })
    if (pRes.ok) {
      const pj = await pRes.json()
      const status = pj?.playabilityStatus?.status
      const reason = String(pj?.playabilityStatus?.reason || '')
      if (status === 'LOGIN_REQUIRED' || /age|confirm your age/i.test(reason)) {
        return { blocked: 'Ez a YouTube videó 18+ korhatáros, ezért nem küldhető be!' }
      }
      if (pj?.microformat?.playerMicroformatRenderer?.isFamilySafe === false) {
        return { blocked: 'Ez a YouTube videó korhatáros / nem családbarát besorolású.' }
      }
      const vdTitle = String(pj?.videoDetails?.title || oembedTitle || '').trim()
      const vdAuthor = String(pj?.videoDetails?.author || oembedAuthor || '').trim()
      if (hasExplicitTextMarker(vdTitle) || hasExplicitTextMarker(vdAuthor)) {
        return { blocked: `A YouTube videó explicit jelölésű („${vdTitle.slice(0, 42)}”).` }
      }
      return { title: vdTitle || oembedTitle, author: vdAuthor || oembedAuthor }
    }
  } catch {
    // ignore player probe error
  }

  return { title: oembedTitle, author: oembedAuthor }
}

function collectYtmItems(node: unknown, out: Array<{ vid?: string; title: string; sub: string; explicit: boolean }>) {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const item of node) collectYtmItems(item, out)
    return
  }
  const obj = node as Record<string, any>
  if (obj.musicResponsiveListItemRenderer) {
    const r = obj.musicResponsiveListItemRenderer
    const vid = r?.playlistItemData?.videoId
    const cols = Array.isArray(r?.flexColumns) ? r.flexColumns : []
    const getColText = (idx: number) =>
      (cols[idx]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [])
        .map((x: any) => x?.text || '')
        .join('')
        .trim()
    const explicit = JSON.stringify(r?.badges || []).includes('MUSIC_EXPLICIT_BADGE')
    out.push({ vid, title: getColText(0), sub: getColText(1), explicit })
    return
  }
  for (const val of Object.values(obj)) {
    collectYtmItems(val, out)
  }
}

async function checkMusicCatalogExplicit(params: {
  ytId?: string
  rawTitle: string
  ytAuthor?: string
}): Promise<{ explicit: boolean; error?: string }> {
  const parsed = parseArtistTrack(params.rawTitle, params.ytAuthor)
  const targetTrackNorm = normMetaStr(parsed.track)
  const targetArtistNorm = normMetaStr(parsed.artist)
  const fullQueryNorm = normMetaStr(parsed.query)
  if (!parsed.query || parsed.query.length < 2) return { explicit: false }

  const [ytmItems, dzTracks, itTracks] = await Promise.all([
    fetch('https://music.youtube.com/youtubei/v1/search?prettyPrint=false', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      body: JSON.stringify({
        context: { client: { clientName: 'WEB_REMIX', clientVersion: '1.20240101.00.00' } },
        query: parsed.query,
        params: 'EgWKAQIIAWoMEAMQBBAJEAoQBRAV',
      }),
    })
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        const list: Array<{ vid?: string; title: string; sub: string; explicit: boolean }> = []
        if (j) collectYtmItems(j, list)
        return list.slice(0, 6)
      })
      .catch(() => [] as Array<{ vid?: string; title: string; sub: string; explicit: boolean }>),

    fetch(`https://api.deezer.com/search?q=${encodeURIComponent(parsed.query)}&limit=5`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => (Array.isArray(j?.data) ? j.data : []))
      .catch(() => []),

    fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(parsed.query)}&entity=song&limit=5`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => (Array.isArray(j?.results) ? j.results : []))
      .catch(() => []),
  ])

  if (params.ytId) {
    const exactVid = ytmItems.find(it => it.vid === params.ytId)
    if (exactVid) {
      if (exactVid.explicit) {
        return {
          explicit: true,
          error: `A „${exactVid.title}” Explicit [E] jelöléssel szerepel a YouTube Music kínálatában, így nem küldhető be!`,
        }
      }
      if (hasCleanVersionMarker(exactVid.title)) {
        return { explicit: false }
      }
    }
  }

  for (let i = 0; i < ytmItems.length; i++) {
    const it = ytmItems[i]
    if (!it.explicit || hasCleanVersionMarker(it.title)) continue
    if (
      trackCandidateMatches({
        candArtist: it.sub,
        candTrack: it.title,
        targetArtistNorm,
        targetTrackNorm,
        fullQueryNorm,
        isTopHit: i === 0,
      })
    ) {
      return {
        explicit: true,
        error: `A „${it.title}” Explicit [E] jelölésű zeneszám (YouTube Music), ezért nem küldhető be az iskolai lejátszólistába!`,
      }
    }
  }

  for (let i = 0; i < dzTracks.length; i++) {
    const d = dzTracks[i]
    const isExp = d?.explicit_lyrics === true || Number(d?.explicit_content_lyrics) === 1
    const dTitle = String(d?.title || d?.title_short || '')
    const dArtist = String(d?.artist?.name || '')
    if (!isExp || hasCleanVersionMarker(dTitle)) continue
    if (
      trackCandidateMatches({
        candArtist: dArtist,
        candTrack: dTitle,
        targetArtistNorm,
        targetTrackNorm,
        fullQueryNorm,
        isTopHit: i === 0,
      })
    ) {
      return {
        explicit: true,
        error: `A „${dArtist} – ${dTitle}” Explicit jelölésű zeneszám (Deezer), ezért nem küldhető be az iskolai lejátszólistába!`,
      }
    }
  }

  for (let i = 0; i < itTracks.length; i++) {
    const t = itTracks[i]
    const isExp = String(t?.trackExplicitness || '').toLowerCase() === 'explicit'
    const tTitle = String(t?.trackName || '')
    const tArtist = String(t?.artistName || '')
    if (!isExp || hasCleanVersionMarker(tTitle)) continue
    if (
      trackCandidateMatches({
        candArtist: tArtist,
        candTrack: tTitle,
        targetArtistNorm,
        targetTrackNorm,
        fullQueryNorm,
        isTopHit: i === 0,
      })
    ) {
      return {
        explicit: true,
        error: `A „${tArtist} – ${tTitle}” Explicit jelölésű zeneszám (Apple Music / iTunes), ezért nem küldhető be!`,
      }
    }
  }

  return { explicit: false }
}

async function checkMediaExplicit(params: {
  ytId?: string
  title?: string
  url?: string
}): Promise<{ ok: boolean; error?: string }> {
  const rawTitle = String(params.title || '').trim()
  const rawUrl = String(params.url || '').trim()
  const ytId = params.ytId ? String(params.ytId).trim() : undefined

  if (hasExplicitTextMarker(rawTitle)) {
    return { ok: false, error: 'Explicit vagy 18+ jelölésű zene/videó nem küldhető be az iskolai szabályzat miatt!' }
  }
  if (rawUrl) {
    const cleanUrlWords = rawUrl.replace(/[_-]+/g, ' ')
    if (/\[\s*E\s*\]|\(\s*E\s*\)|18\+|🔞/i.test(rawUrl) || /\b(explicit|uncensored|unrated|nsfw|porn|hentai|korhataros)\b/i.test(cleanUrlWords)) {
      return { ok: false, error: 'A megadott link explicit vagy nem iskolabarát tartalomra utal.' }
    }
  }

  const cacheKey = `${ytId || ''}::${rawTitle.toLowerCase()}`
  const cached = explicitCheckCache.get(cacheKey)
  if (cached) return cached

  let resolvedTitle = rawTitle
  let resolvedAuthor: string | undefined

  if (ytId) {
    const yt = await fetchYtDetails(ytId)
    if (yt.blocked) {
      const res = { ok: false, error: yt.blocked }
      explicitCheckCache.set(cacheKey, res)
      return res
    }
    if (yt.title) resolvedTitle = yt.title
    resolvedAuthor = yt.author
  }

  if (!hasCleanVersionMarker(rawTitle) && !hasCleanVersionMarker(resolvedTitle)) {
    const cat = await checkMusicCatalogExplicit({
      ytId,
      rawTitle: resolvedTitle || rawTitle,
      ytAuthor: resolvedAuthor,
    })
    if (cat.explicit) {
      const res = { ok: false, error: cat.error }
      explicitCheckCache.set(cacheKey, res)
      return res
    }
  }

  const okRes = { ok: true }
  explicitCheckCache.set(cacheKey, okRes)
  return okRes
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    let body: any = {}
    if (req.method === 'POST') {
      const rawText = await req.text().catch(() => '')
      if (rawText) {
        const trimmed = rawText.trim()
        if (trimmed.startsWith('{')) {
          try { body = JSON.parse(trimmed) } catch { body = {} }
        } else {
          const params = new URLSearchParams(rawText)
          const dataStr = params.get('data')
          if (dataStr) {
            try { body = { action: 'kofi_webhook', kofi: JSON.parse(dataStr) } } catch { body = {} }
          }
        }
      }
    }
    if (body && typeof body.data === 'string' && body.data.trim().startsWith('{')) {
      try { body = { action: 'kofi_webhook', kofi: JSON.parse(body.data) } } catch {}
    } else if (body && (body.kofi_transaction_id || (body.from_name && body.amount !== undefined && !body.action))) {
      body = { action: 'kofi_webhook', kofi: body }
    }
    const action = body.action || 'sync'

    if (action === 'check_media') {
      const result = await checkMediaExplicit({
        ytId: typeof body.ytId === 'string' ? body.ytId : undefined,
        title: typeof body.title === 'string' ? body.title : undefined,
        url: typeof body.url === 'string' ? body.url : undefined,
      })
      return reply(result)
    }

    let chMap = await ensureIntentAndChannels()

    if (action === 'setup_welcome') {
      await runWelcomeAndJoinSetup(chMap)
      chMap = await ensureIntentAndChannels(true)
      await checkMemberJoinsAndLeaves(chMap)
      return reply({ ok: true, chMap })
    }

    if (action === 'inspect_guild') {
      const guildId = getGuild()
      const [chs, roles]: [any[], any[]] = await Promise.all([
        discordApi(`/guilds/${guildId}/channels`),
        discordApi(`/guilds/${guildId}/roles`),
      ])
      return reply({
        ok: true,
        channels: chs.map((c: any) => ({ id: c.id, name: c.name, type: c.type, parent_id: c.parent_id })),
        roles: roles.map((r: any) => ({ id: r.id, name: r.name, position: r.position })),
      })
    }

    if (action === 'setup_vip') {
      await runVipSetup(chMap)
      chMap = await ensureIntentAndChannels(true)
      return reply({ ok: true, chMap })
    }

    if (action === 'lock_channels') {
      const res = await runChannelVisibilitySetup(chMap)
      chMap = await ensureIntentAndChannels(true)
      return reply({ ok: true, ...res })
    }

    if (action === 'grant_vip') {
      const discordHint = extractDiscordHint(body.message, body.discord, body.name)
      const vipRes = await findAndGrantVipRole(chMap, discordHint, body.name)
      if (body.announce && (chMap.vipInfo || chMap.vipChat)) {
        const res = await handleKofiDonation(chMap, {
          id: body.id,
          name: body.name || body.discord || 'Támogató',
          amount: Number(body.amount) || 0,
          currency: body.currency || 'HUF',
          discord: body.discord,
          message: body.message,
          date: body.date
        })
        return reply(res)
      }
      return reply({
        ok: true,
        vipGranted: vipRes.granted,
        discordUserId: vipRes.userId,
        discordUsername: vipRes.username,
        displayName: vipRes.displayName
      })
    }

    if (action === 'kofi_webhook') {
      const k = body.kofi || body
      const res = await handleKofiDonation(chMap, {
        id: k.kofi_transaction_id || k.message_id || k.id,
        name: k.from_name || k.name || 'Névtelen támogató',
        amount: parseFloat(String(k.amount ?? 0)) || 0,
        currency: k.currency || 'HUF',
        discord: k.discord_username || k.discord_userid || k.discord,
        message: k.message || '',
        date: k.timestamp ? String(k.timestamp).slice(0, 10) : new Date().toISOString().slice(0, 10)
      })
      return reply(res)
    }

    if (action === 'sync') {
      await checkMemberJoinsAndLeaves(chMap)

      const songs: any[] = []
      const announcements: any[] = []

      const musicSources = [
        ...(chMap.vipMusic ? [{ id: chMap.vipMusic, isVip: true }] : []),
        ...(chMap.music ? [{ id: chMap.music, isVip: false }] : [])
      ]

      for (const src of musicSources) {
        const msgs: any[] = await discordApi(`/channels/${src.id}/messages?limit=25`).catch(() => [])
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

          if (!cleanTitle || hasExplicitTextMarker(cleanTitle)) continue
          const senderName = (m.member?.nick || m.author?.global_name || m.author?.username || 'Diák').slice(0, 20)
          if (isProfane(senderName)) continue
          const expCheck = await checkMediaExplicit({ ytId, title: cleanTitle, url: rawContent })
          if (!expCheck.ok) continue

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

          const reactEmoji = src.isVip ? '💎' : '🎵'
          if (!botReacted) {
            discordApi(`/channels/${src.id}/messages/${m.id}/reactions/${encodeURIComponent(reactEmoji)}/@me`, 'PUT').catch(() => {})
          }

          const createdMs = Date.parse(m.timestamp) || Date.now()
          const msgDay = new Date(createdMs).toLocaleDateString('sv-SE', { timeZone: 'Europe/Budapest' })

          songs.push({
            id: `dc-${m.id}`,
            day: msgDay,
            kind: 'music',
            title: cleanTitle.slice(0, 60),
            by: src.isVip ? `${senderName} 💎` : `${senderName} 💬`,
            ytId,
            votes: (src.isVip ? 3 : 1) + extraVotes,
            at: createdMs,
          })
        }
      }

      if (chMap.videos) {
        const msgs: any[] = await discordApi(`/channels/${chMap.videos}/messages?limit=25`).catch(() => [])
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

          if (!cleanTitle || hasExplicitTextMarker(cleanTitle)) continue
          const senderName = (m.member?.nick || m.author?.global_name || m.author?.username || 'Diák').slice(0, 20)
          if (isProfane(senderName)) continue
          const expCheck = await checkMediaExplicit({ ytId, title: cleanTitle, url: rawContent })
          if (!expCheck.ok) continue

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
            discordApi(`/channels/${chMap.videos}/messages/${m.id}/reactions/${encodeURIComponent('🎬')}/@me`, 'PUT').catch(() => {})
          }

          const createdMs = Date.parse(m.timestamp) || Date.now()
          const msgDay = new Date(createdMs).toLocaleDateString('sv-SE', { timeZone: 'Europe/Budapest' })

          songs.push({
            id: `dc-vid-${m.id}`,
            day: msgDay,
            kind: 'video',
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
        channels: {
          music: chMap.musicName,
          videos: chMap.videosName,
        },
        songs,
        announcements,
      })
    }

    if (action === 'post') {
      const kind = String(body.kind || '')

      if (kind === 'jukebox') {
        const title = String(body.title || '').trim()
        const by = String(body.by || '').trim() || 'Diák'
        const ytId = body.ytId ? String(body.ytId).trim() : undefined
        const isVideo = body.mediaKind === 'video'
        const mediaKind = isVideo ? '🎬 Videókérés' : '🎵 Zenekérés'
        const ytUrl = ytId ? `https://youtu.be/${ytId}` : undefined
        const targetCh = isVideo && chMap.videos ? chMap.videos : chMap.music

        if (targetCh) {
          await discordApi(`/channels/${targetCh}/messages`, 'POST', {
            embeds: [
              {
                title: `${mediaKind} a SuliBell weboldalról!`,
                description: ytUrl ? `**[${title}](${ytUrl})**\n🔗 ${ytUrl}` : `**${title}**`,
                color: isVideo ? 0x2de2ff : 0xff4fc3,
                thumbnail: ytId ? { url: `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg` } : undefined,
                footer: { text: `Beküldte: ${by} • SuliBell Weboldal` },
                timestamp: new Date().toISOString(),
              },
            ],
          })
          return reply({ ok: true })
        }
      }

      if (kind === 'announcement' && chMap.announcements) {
        const text = String(body.text || '').trim()
        const until = body.until ? String(body.until).trim() : ''
        await discordApi(`/channels/${chMap.announcements}/messages`, 'POST', {
          embeds: [
            {
              title: '📢 Új SuliBell közlemény',
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
              title: '🚨 KIEMELT SULIBELL FIGYELMEZTETÉS / RIADÓ',
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
              title: '📊 Új SuliBell szavazás indult!',
              description: `**${question}**\n\n` + options.map((o, i) => `${i + 1}️⃣ ${o}`).join('\n'),
              color: 0x8a5cff,
              footer: { text: 'Szavazz a SuliBell weboldalon!' },
              timestamp: new Date().toISOString(),
            },
          ],
        })
        return reply({ ok: true })
      }

      if (kind === 'version' && chMap.updates) {
        const version = String(body.version || '').trim()
        const note = String(body.note || body.text || '').trim()
        await discordApi(`/channels/${chMap.updates}/messages`, 'POST', {
          embeds: [
            {
              title: `🆕 Új SuliBell verzió jelent meg: v${version.replace(/^v/, '')}`,
              description: note ? `**Mi változott az oldalon?**\n${note}` : 'Új frissítés vált elérhetővé a SuliBell weboldalon!',
              color: 0x2de2ff,
              fields: [
                {
                  name: '🔖 Verziószám',
                  value: `\`v${version.replace(/^v/, '')}\``,
                  inline: true,
                },
                {
                  name: '🌐 Weboldal',
                  value: '[sulibell.vercel.app](https://sulibell.vercel.app)',
                  inline: true,
                },
              ],
              footer: { text: 'SuliBell Rendszerfrissítés • A te iskolád, a te ritmusod!' },
              timestamp: new Date().toISOString(),
            },
          ],
        })
        return reply({ ok: true })
      }

      if (kind === 'git' && chMap.deployGit) {
        const author = String(body.author || 'Fejlesztő')
        const message = String(body.message || 'Új kódmódosítás')
        const branch = String(body.branch || 'main')
        const url = body.url ? String(body.url) : 'https://github.com/fintab24d/SuliBell'
        const hash = body.hash ? String(body.hash).substring(0, 7) : ''
        const files = body.files ? String(body.files) : ''

        await discordApi(`/channels/${chMap.deployGit}/messages`, 'POST', {
          embeds: [
            {
              title: `🚀 Új commit érkezett a SuliBell repóba! [${branch}]`,
              url,
              description: `**${message}**`,
              color: 0x5865f2,
              fields: [
                { name: '👤 Szerző', value: author, inline: true },
                { name: '🌿 Ág (Branch)', value: `\`${branch}\``, inline: true },
                ...(hash ? [{ name: '🔖 Commit', value: `[\`${hash}\`](${url})`, inline: true }] : []),
                ...(files ? [{ name: '📁 Módosítások', value: files }] : []),
              ],
              footer: { text: 'SuliBell GitHub Repository • fintab24d/SuliBell' },
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
