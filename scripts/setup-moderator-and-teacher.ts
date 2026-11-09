/**
 * Moderátori és Tanári zóna beállítása a SuliBell Discord szerveren
 * Használat: $env:DISCORD_TOKEN="bot_token"; node --experimental-strip-types scripts/setup-moderator-and-teacher.ts
 */
const TOKEN = (process.argv[2] || process.env.DISCORD_TOKEN)?.trim()
const GUILD_ID = (process.argv[3] || process.env.GUILD_ID || '1569090182802575571')?.trim()
if (!TOKEN) {
  console.error('❌ Hiányzó DISCORD_TOKEN környezeti változó!')
  process.exit(1)
}
const API = 'https://discord.com/api/v10'

const Perm = {
  VIEW_CHANNEL: (1n << 10n).toString(),
  SEND_MESSAGES: (1n << 11n).toString(),
  READ_MESSAGE_HISTORY: (1n << 16n).toString(),
  CONNECT: (1n << 20n).toString(),
  SPEAK: (1n << 21n).toString(),
  MANAGE_MESSAGES: (1n << 13n).toString(),
  ATTACH_FILES: (1n << 15n).toString(),
  EMBED_LINKS: (1n << 14n).toString(),
  USE_EXTERNAL_EMOJIS: (1n << 18n).toString(),
}

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

async function run() {
  console.log('🔍 Szerepkörök és csatornák ellenőrzése...')
  const roles: any[] = await api(`/guilds/${GUILD_ID}/roles`)
  
  const leadDevRole = roles.find(r => r.name.includes('Lead Dev'))
  const devRole = roles.find(r => r.name.includes('Fejlesztő'))
  const modRole = roles.find(r => r.name.includes('Moderátor'))
  const studentRole = roles.find(r => r.name.includes('Diák'))
  let teacherRole = roles.find(r => r.name.includes('Tanár'))

  if (!leadDevRole || !devRole || !modRole) {
    throw new Error('Alapvető fejlesztői/moderátori rangok hiányoznak!')
  }

  // Ha a Tanár rang létezik, finomhangoljuk a színét és láthatóságát (külön listázás jobb oldalon)
  if (teacherRole) {
    console.log('✏️ Tanár rang finomhangolása...')
    teacherRole = await api(`/guilds/${GUILD_ID}/roles/${teacherRole.id}`, 'PATCH', {
      name: '🧑‍🏫 Tanár',
      color: 0x3498db, // Elegáns kék
      hoist: true,
      mentionable: true,
    })
  } else {
    console.log('➕ Új Tanár rang létrehozása...')
    teacherRole = await api(`/guilds/${GUILD_ID}/roles`, 'POST', {
      name: '🧑‍🏫 Tanár',
      color: 0x3498db,
      hoist: true,
      mentionable: true,
    })
  }

  console.log('✅ Rangok ellenőrizve:')
  console.log(`   👑 Lead Dev: ${leadDevRole.id}`)
  console.log(`   🛠️ Fejlesztő: ${devRole.id}`)
  console.log(`   🛡️ Moderátor: ${modRole.id}`)
  console.log(`   🧑‍🏫 Tanár: ${teacherRole.id}`)
  if (studentRole) console.log(`   🎓 Diák: ${studentRole.id}`)

  // 1. MODERÁTORI ZÓNA OVERWRITES
  // Csak: Moderátor, Fejlesztő, Lead Dev férhet hozzá!
  // @everyone és Diák, valamint Tanár elől rejtve (mert a kérés szerint ide moderátor és annál fentebbiek léphetnek be)
  const fullAllowBits = (
    BigInt(Perm.VIEW_CHANNEL) |
    BigInt(Perm.SEND_MESSAGES) |
    BigInt(Perm.READ_MESSAGE_HISTORY) |
    BigInt(Perm.CONNECT) |
    BigInt(Perm.SPEAK) |
    BigInt(Perm.ATTACH_FILES) |
    BigInt(Perm.EMBED_LINKS) |
    BigInt(Perm.USE_EXTERNAL_EMOJIS)
  ).toString()

  const modAllowBits = (
    BigInt(Perm.VIEW_CHANNEL) |
    BigInt(Perm.SEND_MESSAGES) |
    BigInt(Perm.READ_MESSAGE_HISTORY) |
    BigInt(Perm.CONNECT) |
    BigInt(Perm.SPEAK) |
    BigInt(Perm.MANAGE_MESSAGES) |
    BigInt(Perm.ATTACH_FILES) |
    BigInt(Perm.EMBED_LINKS)
  ).toString()

  const denyAllBits = (BigInt(Perm.VIEW_CHANNEL) | BigInt(Perm.CONNECT)).toString()

  const modOnlyOverwrites = [
    {
      id: GUILD_ID, // @everyone
      type: 0,
      allow: '0',
      deny: denyAllBits,
    },
    {
      id: modRole.id,
      type: 0,
      allow: modAllowBits,
      deny: '0',
    },
    {
      id: devRole.id,
      type: 0,
      allow: fullAllowBits,
      deny: '0',
    },
    {
      id: leadDevRole.id,
      type: 0,
      allow: fullAllowBits,
      deny: '0',
    },
  ]

  // 2. TANÁRI ZÓNA OVERWRITES
  // Beléphet: Tanárok, Moderátorok, és annál fentebbi rangok (Fejlesztő, Lead Dev)
  // Diákok és @everyone elől rejtve
  const teacherOverwrites = [
    {
      id: GUILD_ID, // @everyone
      type: 0,
      allow: '0',
      deny: denyAllBits,
    },
    {
      id: teacherRole.id,
      type: 0,
      allow: fullAllowBits,
      deny: '0',
    },
    {
      id: modRole.id,
      type: 0,
      allow: modAllowBits,
      deny: '0',
    },
    {
      id: devRole.id,
      type: 0,
      allow: fullAllowBits,
      deny: '0',
    },
    {
      id: leadDevRole.id,
      type: 0,
      allow: fullAllowBits,
      deny: '0',
    },
  ]

  const existingChannels: any[] = await api(`/guilds/${GUILD_ID}/channels`)

  // --- A) MODERÁTORI ZÓNA LÉTREHOZÁSA ---
  let modCat = existingChannels.find(c => c.type === 4 && c.name.includes('MODERÁTOR'))
  if (!modCat) {
    console.log('🛡️ Moderátori Kategória létrehozása...')
    modCat = await api(`/guilds/${GUILD_ID}/channels`, 'POST', {
      name: '🛡️ MODERÁTORI ZÓNA',
      type: 4,
      permission_overwrites: modOnlyOverwrites,
    })
  } else {
    console.log('🛡️ Moderátori Kategória engedélyeinek frissítése...')
    await api(`/channels/${modCat.id}`, 'PATCH', {
      permission_overwrites: modOnlyOverwrites,
    })
  }

  const modChannels = [
    { name: '💬-mod-chat', type: 0, topic: 'Belső moderátori megbeszélések és koordináció.' },
    { name: '🔨-szankciók-napló', type: 0, topic: 'Kiosztott figyelmeztetések, némítások és szabálysértések feljegyzése.' },
    { name: '📢-mod-bejelentések', type: 0, topic: 'Vezetőségi és moderátori belső közlemények.' },
    { name: '🔊 Moderátori Szoba', type: 2 },
  ]

  for (const ch of modChannels) {
    const exists = existingChannels.find(c => c.parent_id === modCat.id && c.name === ch.name)
    if (!exists) {
      console.log(`  ➕ Moderátori szoba létrehozása: ${ch.name}`)
      await api(`/guilds/${GUILD_ID}/channels`, 'POST', {
        name: ch.name,
        type: ch.type,
        parent_id: modCat.id,
        topic: ch.topic,
        permission_overwrites: modOnlyOverwrites,
      })
    } else {
      console.log(`  ✔ Moderátori szoba már létezik: ${ch.name}`)
      await api(`/channels/${exists.id}`, 'PATCH', {
        permission_overwrites: modOnlyOverwrites,
      })
    }
  }

  // --- B) TANÁRI ZÓNA LÉTREHOZÁSA ---
  let teacherCat = existingChannels.find(c => c.type === 4 && (c.name.includes('TANÁR') || c.name.includes('OKTATÓ')))
  if (!teacherCat) {
    console.log('🧑‍🏫 Tanári Kategória létrehozása...')
    teacherCat = await api(`/guilds/${GUILD_ID}/channels`, 'POST', {
      name: '🧑‍🏫 TANÁRI SZOBA & VEZETŐSÉG',
      type: 4,
      permission_overwrites: teacherOverwrites,
    })
  } else {
    console.log('🧑‍🏫 Tanári Kategória engedélyeinek frissítése...')
    await api(`/channels/${teacherCat.id}`, 'PATCH', {
      permission_overwrites: teacherOverwrites,
    })
  }

  const teacherChannels = [
    { name: '💬-tanári-társalgó', type: 0, topic: 'Privát megbeszélő tanároknak és moderátoroknak.' },
    { name: '📌-tanári-hirdető', type: 0, topic: 'Iskolai hirdetmények, tanári közlemények és körlevelek.' },
    { name: '📋-órarend-és-helyettesítés', type: 0, topic: 'Órarendi változások, elmaradó órák és helyettesítések egyeztetése.' },
    { name: '🔊 Tanári Szoba (Hang)', type: 2 },
  ]

  for (const ch of teacherChannels) {
    const exists = existingChannels.find(c => c.parent_id === teacherCat.id && c.name === ch.name)
    if (!exists) {
      console.log(`  ➕ Tanári szoba létrehozása: ${ch.name}`)
      await api(`/guilds/${GUILD_ID}/channels`, 'POST', {
        name: ch.name,
        type: ch.type,
        parent_id: teacherCat.id,
        topic: ch.topic,
        permission_overwrites: teacherOverwrites,
      })
    } else {
      console.log(`  ✔ Tanári szoba már létezik: ${ch.name}`)
      await api(`/channels/${exists.id}`, 'PATCH', {
        permission_overwrites: teacherOverwrites,
      })
    }
  }

  // Töröljük a teljesen üres default "Szöveg csatornák" kategóriát, ha üres
  const emptyCat = existingChannels.find(c => c.id === '1569090183557685401' && c.type === 4)
  if (emptyCat) {
    const hasChildren = existingChannels.some(c => c.parent_id === emptyCat.id)
    if (!hasChildren) {
      console.log('🧹 Üres alapértelmezett kategória törlése...')
      await api(`/channels/${emptyCat.id}`, 'DELETE').catch(() => {})
    }
  }

  console.log('🎉 KÉSZ! A Moderátori és Tanári zónák sikeresen beállítva a pontos jogosultságokkal!')
}

run().catch(err => {
  console.error('❌ Hiba történt:', err)
  process.exit(1)
})
