/**
 * Automatikus Discord Szerver Felépítő Script a Számláló oldalhoz.
 *
 * Használat:
 *   $env:DISCORD_TOKEN="bot_token_ide"; $env:GUILD_ID="szerver_id_ide"; node --experimental-strip-types scripts/setup-discord.ts
 */

const TOKEN = (process.argv[2] || process.env.DISCORD_TOKEN)?.trim()
const GUILD_ID = (process.argv[3] || process.env.GUILD_ID)?.trim()

if (!TOKEN || !GUILD_ID) {
  console.error('\n❌ Hiányzó adatok! Így futtasd PowerShellben:\n')
  console.error('  $env:DISCORD_TOKEN="IDE_A_BOT_TOKEN"; $env:GUILD_ID="IDE_A_SZERVER_ID"; node --experimental-strip-types scripts/setup-discord.ts\n')
  process.exit(1)
}

const API = 'https://discord.com/api/v10'

// Discord jogosultság bitmaszkok (BigInt -> String)
const Perm = {
  VIEW_CHANNEL: (1n << 10n).toString(),
  SEND_MESSAGES: (1n << 11n).toString(),
  CONNECT: (1n << 20n).toString(),
  SPEAK: (1n << 21n).toString(),
  MANAGE_MESSAGES: (1n << 13n).toString(),
  MANAGE_CHANNELS: (1n << 4n).toString(),
  MANAGE_WEBHOOKS: (1n << 29n).toString(),
  KICK_MEMBERS: (1n << 1n).toString(),
  BAN_MEMBERS: (1n << 2n).toString(),
  ADMINISTRATOR: (1n << 3n).toString(),
  READ_MESSAGE_HISTORY: (1n << 16n).toString(),
  ADD_REACTIONS: (1n << 6n).toString(),
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

async function main() {
  console.log('🚀 Discord szerver felépítése indul...')

  const me = await api('/users/@me')
  console.log(`🤖 Bot: ${me.username}#${me.discriminator ?? '0'} (ID: ${me.id})`)

  let guild: any
  try {
    guild = await api(`/guilds/${GUILD_ID}`)
  } catch (e: any) {
    const guilds = await api<any[]>('/users/@me/guilds').catch(() => [])
    console.error(`\n⚠️ A bot még nincs bent a megadott szerveren (${GUILD_ID})!`)
    if (guilds.length > 0) {
      console.error(`Jelenleg ezeken a szervereken van bent: ${guilds.map(g => `${g.name} (${g.id})`).join(', ')}`)
    }
    console.error(`\n👉 Kattints erre a linkre a bot behívásához a szerveredre:\nhttps://discord.com/oauth2/authorize?client_id=${me.id}&permissions=8&scope=bot&guild_id=${GUILD_ID}\n`)
    process.exit(1)
  }
  console.log(`✅ Csatlakozva a szerverhez: ${guild.name} (${guild.id})`)

  // 1. Rangok létrehozása
  console.log('🎨 Rangok létrehozása...')
  const ownerRole = await api(`/guilds/${GUILD_ID}/roles`, 'POST', {
    name: '👑 Tulajdonos',
    color: 0xff1744, // Élénk vörös-neon
    hoist: true,
    mentionable: true,
    permissions: Perm.ADMINISTRATOR,
  })

  const headAdminRole = await api(`/guilds/${GUILD_ID}/roles`, 'POST', {
    name: '⭐ Főadmin',
    color: 0xff9100, // Kiemelt arany-borostyán
    hoist: true,
    mentionable: true,
    permissions: '1256210296791', // Magas szintű kezelési jogok, de NEM Rendszergazda (nem írhatja felül a Tulajdonost)
  })

  const leadDevRole = await api(`/guilds/${GUILD_ID}/roles`, 'POST', {
    name: '👑 Lead Dev',
    color: 0xff4fc3, // Neon pink
    hoist: true,
    mentionable: true,
    permissions: Perm.ADMINISTRATOR,
  })

  const devRole = await api(`/guilds/${GUILD_ID}/roles`, 'POST', {
    name: '🛠️ Fejlesztő (Dev)',
    color: 0x2de2ff, // Neon cyan
    hoist: true,
    mentionable: true,
    permissions: (
      BigInt(Perm.VIEW_CHANNEL) |
      BigInt(Perm.SEND_MESSAGES) |
      BigInt(Perm.MANAGE_MESSAGES) |
      BigInt(Perm.MANAGE_CHANNELS) |
      BigInt(Perm.MANAGE_WEBHOOKS)
    ).toString(),
  })

  const modRole = await api(`/guilds/${GUILD_ID}/roles`, 'POST', {
    name: '🛡️ Moderátor',
    color: 0xffb02e, // Neon amber
    hoist: true,
    mentionable: true,
    permissions: (
      BigInt(Perm.VIEW_CHANNEL) |
      BigInt(Perm.SEND_MESSAGES) |
      BigInt(Perm.MANAGE_MESSAGES) |
      BigInt(Perm.KICK_MEMBERS) |
      BigInt(Perm.BAN_MEMBERS)
    ).toString(),
  })

  const teacherRole = await api(`/guilds/${GUILD_ID}/roles`, 'POST', {
    name: '🧑‍🏫 Tanár',
    color: 0x3498db, // Elegáns kék
    hoist: true,
    mentionable: true,
  })

  const studentRole = await api(`/guilds/${GUILD_ID}/roles`, 'POST', {
    name: '🎓 Diák',
    color: 0x39ff7a, // Neon green
    hoist: true,
    mentionable: false,
  })

  console.log('  ✔ Rangok kész: 👑 Tulajdonos, ⭐ Főadmin, 👑 Lead Dev, 🛠️ Fejlesztő (Dev), 🛡️ Moderátor, 🧑‍🏫 Tanár, 🎓 Diák')

  // Jogosultság-sablonok:
  // A) Csak olvasható (Információs szobák: @everyone látja, de nem írhat; Dev írhat)
  const readOnlyOverwrites = [
    {
      id: GUILD_ID, // @everyone
      type: 0,
      allow: (BigInt(Perm.VIEW_CHANNEL) | BigInt(Perm.READ_MESSAGE_HISTORY) | BigInt(Perm.ADD_REACTIONS)).toString(),
      deny: Perm.SEND_MESSAGES,
    },
    {
      id: devRole.id,
      type: 0,
      allow: (BigInt(Perm.VIEW_CHANNEL) | BigInt(Perm.SEND_MESSAGES) | BigInt(Perm.MANAGE_MESSAGES)).toString(),
      deny: '0',
    },
    {
      id: leadDevRole.id,
      type: 0,
      allow: (BigInt(Perm.VIEW_CHANNEL) | BigInt(Perm.SEND_MESSAGES) | BigInt(Perm.MANAGE_MESSAGES)).toString(),
      deny: '0',
    },
  ]

  // B) Privát Dev Zóna (@everyone egyáltalán nem látja, csak a Dev és Lead Dev!)
  const devOnlyOverwrites = [
    {
      id: GUILD_ID, // @everyone
      type: 0,
      allow: '0',
      deny: (BigInt(Perm.VIEW_CHANNEL) | BigInt(Perm.CONNECT)).toString(),
    },
    {
      id: devRole.id,
      type: 0,
      allow: (
        BigInt(Perm.VIEW_CHANNEL) |
        BigInt(Perm.SEND_MESSAGES) |
        BigInt(Perm.READ_MESSAGE_HISTORY) |
        BigInt(Perm.CONNECT) |
        BigInt(Perm.SPEAK)
      ).toString(),
      deny: '0',
    },
    {
      id: leadDevRole.id,
      type: 0,
      allow: (
        BigInt(Perm.VIEW_CHANNEL) |
        BigInt(Perm.SEND_MESSAGES) |
        BigInt(Perm.READ_MESSAGE_HISTORY) |
        BigInt(Perm.CONNECT) |
        BigInt(Perm.SPEAK)
      ).toString(),
      deny: '0',
    },
  ]

  // 2. Kategóriák és csatornák létrehozása
  // --- I. INFORMÁCIÓK ---
  console.log('📌 Információs kategória létrehozása...')
  const infoCat = await api(`/guilds/${GUILD_ID}/channels`, 'POST', {
    name: '📌 INFORMÁCIÓK',
    type: 4,
    permission_overwrites: readOnlyOverwrites,
  })

  const welcomeCh = await api(`/guilds/${GUILD_ID}/channels`, 'POST', {
    name: '👋-üdvözlő',
    type: 0,
    parent_id: infoCat.id,
    topic: 'Üdvözlünk a Számláló hivatalos Discord szerverén!',
  })

  const rulesCh = await api(`/guilds/${GUILD_ID}/channels`, 'POST', {
    name: '📜-szabályzat',
    type: 0,
    parent_id: infoCat.id,
    topic: 'A szerver szabályzata — kérjük tartsd be!',
  })

  await api(`/guilds/${GUILD_ID}/channels`, 'POST', {
    name: '📢-közlemények',
    type: 0,
    parent_id: infoCat.id,
    topic: 'Hivatalos bejelentések, újdonságok és órarend-információk.',
  })

  await api(`/guilds/${GUILD_ID}/channels`, 'POST', {
    name: '🆕-frissítések',
    type: 0,
    parent_id: infoCat.id,
    topic: 'A Számláló weboldal legújabb fejlesztései és változásai.',
  })

  // --- II. DIÁK KÖZÖSSÉG ---
  console.log('💬 Diák közösségi kategória létrehozása...')
  const commCat = await api(`/guilds/${GUILD_ID}/channels`, 'POST', {
    name: '💬 DIÁK KÖZÖSSÉG',
    type: 4,
  })

  await api(`/guilds/${GUILD_ID}/channels`, 'POST', {
    name: '💬-általános',
    type: 0,
    parent_id: commCat.id,
    topic: 'Kötetlen beszélgetés a diákoknak.',
  })

  await api(`/guilds/${GUILD_ID}/channels`, 'POST', {
    name: '🎵-zenekérés-ötletek',
    type: 0,
    parent_id: commCat.id,
    topic: 'Milyen zenék szóljanak a szünetekben? Írd meg itt!',
  })

  await api(`/guilds/${GUILD_ID}/channels`, 'POST', {
    name: '💡-ötletek-javaslatok',
    type: 0,
    parent_id: commCat.id,
    topic: 'Van egy jó ötleted a Számláló oldalhoz? Oszd meg a fejlesztőkkel!',
  })

  await api(`/guilds/${GUILD_ID}/channels`, 'POST', {
    name: '🐛-hibajelentés',
    type: 0,
    parent_id: commCat.id,
    topic: 'Ha valami nem jól működik az oldalon, itt jelezheted a dev csapatnak.',
  })

  await api(`/guilds/${GUILD_ID}/channels`, 'POST', {
    name: '🔊 Szüneti Társalgó',
    type: 2,
    parent_id: commCat.id,
  })

  // --- III. PRIVÁT FEJLESZTŐI ZÓNA (DEV ONLY) ---
  console.log('🔒 Privát Fejlesztői Zóna (Dev) létrehozása...')
  const devCat = await api(`/guilds/${GUILD_ID}/channels`, 'POST', {
    name: '🔒 FEJLESZTŐI ZÓNA (DEV)',
    type: 4,
    permission_overwrites: devOnlyOverwrites,
  })

  const devChatCh = await api(`/guilds/${GUILD_ID}/channels`, 'POST', {
    name: '💻-dev-chat',
    type: 0,
    parent_id: devCat.id,
    topic: 'Privát megbeszélés kizárólag a fejlesztőknek.',
  })

  await api(`/guilds/${GUILD_ID}/channels`, 'POST', {
    name: '🚀-deploy-és-git',
    type: 0,
    parent_id: devCat.id,
    topic: 'GitHub commitok, Vercel deployok és adatbázis állapot.',
  })

  await api(`/guilds/${GUILD_ID}/channels`, 'POST', {
    name: '📋-teendők-roadmap',
    type: 0,
    parent_id: devCat.id,
    topic: 'Fejlesztési tervek, következő funkciók és feladatok.',
  })

  await api(`/guilds/${GUILD_ID}/channels`, 'POST', {
    name: '🔑-szerver-napló',
    type: 0,
    parent_id: devCat.id,
    topic: 'Belső adminisztrációs és rendszer-napló.',
  })

  await api(`/guilds/${GUILD_ID}/channels`, 'POST', {
    name: '🔊 Dev Meeting',
    type: 2,
    parent_id: devCat.id,
  })

  // 3. Beköszönő és szabályzat Embedek beküldése
  console.log('📨 Üdvözlő és szabályzat üzenetek beküldése...')
  await api(`/channels/${welcomeCh.id}/messages`, 'POST', {
    embeds: [
      {
        title: '🔔 Üdvözlünk a Számláló hivatalos Discord szerverén!',
        description:
          'Ez a közösségi tér az iskolai **Csengetési Számláló** oldalhoz készült, ahol a diákok beszélgethetnek, zenéket javasolhatnak, ötleteket küldhetnek be, és elsőként értesülhetnek az újdonságokról!',
        color: 0x2de2ff,
        fields: [
          {
            name: '📢 Hírek és Frissítések',
            value: 'A `📢-közlemények` és `🆕-frissítések` csatornákban látod a legújabb funkciókat és bejelentéseket.',
          },
          {
            name: '💡 Ötletek & 🐛 Hibajelentés',
            value: 'Ha van ötleted, mit tegyünk még az oldalra, írd meg az `💡-ötletek-javaslatok` szobába!',
          },
          {
            name: '🎵 Szüneti Zenekérés',
            value: 'Dobd be a kedvenc számaidat a `🎵-zenekérés-ötletek` csatornába!',
          },
        ],
        footer: { text: 'Számláló Közösség • Érezd jól magad!' },
      },
    ],
  })

  await api(`/channels/${rulesCh.id}/messages`, 'POST', {
    embeds: [
      {
        title: '📜 Szerver Szabályzat',
        description: 'Kérünk mindenkit, hogy a jó hangulat érdekében tartsa be az alábbi alapvető szabályokat:',
        color: 0xff4fc3,
        fields: [
          { name: '1. Tisztelet', value: 'Legyél tisztelettudó a diáktársaiddal, tanárokkal és a fejlesztőkkel szemben. Tilos a zaklatás és a személyeskedés.' },
          { name: '2. Nincs Spam / Flood', value: 'Ne spammeld tele a csatornákat értelmetlen üzenetekkel, emojikkal vagy kéretlen hirdetésekkel.' },
          { name: '3. Megfelelő csatornahasználat', value: 'Az ötleteket az ötletek szobába, a hibákat a hibajelentésbe, a zenéket a zenekérésbe írd.' },
          { name: '4. NSFW és káros tartalom tilalma', value: 'Szigorúan tilos bármilyen 18+ tartalom, vírusos link vagy adathalász oldal megosztása.' },
        ],
        footer: { text: 'A szabályok megszegése némítással vagy kitiltással járhat.' },
      },
    ],
  })

  await api(`/channels/${devChatCh.id}/messages`, 'POST', {
    embeds: [
      {
        title: '🛠️ Fejlesztői Zóna (Privát)',
        description:
          'Ez a kategória **teljesen rejtett** a diákok (`@everyone`) elől. Csak azok látják, akiknek megvan a **👑 Lead Dev** vagy **🛠️ Fejlesztő (Dev)** rangja.',
        color: 0x39ff7a,
      },
    ],
  })

  // 4. Örökérvényű meghívó link generálása a weboldalhoz
  const invite = await api(`/channels/${welcomeCh.id}/invites`, 'POST', {
    max_age: 0, // Soha nem jár le
    max_uses: 0, // Korlátlan használat
    unique: true,
  })

  const inviteUrl = `https://discord.gg/${invite.code}`
  console.log('\n============================================================')
  console.log('🎉 A DISCORD SZERVER SIKERESEN FELÉPÜLT!')
  console.log(`🔗 Örökérvényű meghívó link a weboldalra: ${inviteUrl}`)
  console.log(`🆔 Diák rang ID: ${studentRole.id} | Dev rang ID: ${devRole.id}`)
  console.log('============================================================\n')
}

main().catch(err => {
  console.error('\n❌ Hiba történt:', err.message)
  process.exit(1)
})
