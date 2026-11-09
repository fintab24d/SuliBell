/**
 * Ötletek csatorna átalakítása Fórum (Forms/Forum) típusúvá a Discord szerveren
 */
const TOKEN = 'MTU2OTA5MDUyNzI5MzYxMjE0Ng.GOgkEk.Di0D2DEruDlHFsraTHUaMwHZfbXJvlMLlqZTs0'
const GUILD_ID = '1569090182802575571'
const OLD_CHANNEL_ID = '1569093885664166018'
const COMM_CAT_ID = '1569093882342539385'
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

async function run() {
  console.log('🚀 Ötletek csatorna átalakítása Fórum (GUILD_FORUM) típusúvá...')

  // 1. Régi szöveges csatorna törlése
  console.log(`🗑️ Régi szöveges csatorna (${OLD_CHANNEL_ID}) törlése...`)
  try {
    await api(`/channels/${OLD_CHANNEL_ID}`, 'DELETE')
    console.log('✅ Régi csatorna törölve.')
  } catch (err: any) {
    console.log('⚠️ Régi csatorna törlése nem sikerült (talán már törölve):', err.message)
  }

  // 2. Új Fórum csatorna létrehozása a DIÁK KÖZÖSSÉG kategóriában
  console.log('✨ Új Fórum csatorna létrehozása...')
  const forum = await api(`/guilds/${GUILD_ID}/channels`, 'POST', {
    name: '💡-ötletek-javaslatok',
    type: 15, // GUILD_FORUM
    parent_id: COMM_CAT_ID,
    topic: 'Oszd meg az ötleteidet a Számláló oldalhoz! Nyiss egy új bejegyzést a megfelelő címkével, szavazzatok és vitassátok meg!',
    available_tags: [
      { name: '✨ Új funkció', emoji_name: '✨' },
      { name: '🎵 Zenegép & Videó', emoji_name: '🎵' },
      { name: '🎮 Játék & Ranglista', emoji_name: '🎮' },
      { name: '🎨 Kinézet & Design', emoji_name: '🎨' },
      { name: '📱 Mobil & PWA', emoji_name: '📱' },
      { name: '💡 Egyéb ötlet', emoji_name: '💡' },
    ],
    default_reaction_emoji: { emoji_name: '👍' },
    default_sort_order: 0, // Legutóbbi aktivitás
    default_forum_layout: 1, // Lista nézet
  })

  console.log(`✅ Fórum csatorna sikeresen létrehozva! (ID: ${forum.id}, Név: ${forum.name})`)

  // Címke azonosító megkeresése
  const tags: any[] = forum.available_tags || []
  const guideTag = tags.find(t => t.name.includes('Egyéb')) || tags[0]

  // 3. Bevezető útmutató bejegyzés (thread) létrehozása a fórum csatornában
  console.log('📝 Bevezető tájékoztató poszt létrehozása...')
  const guideContent = `👋 **Üdvözlünk a Számláló Ötletbörzéjén!**

Ez a csatorna egy **Fórum**, ahol minden ötlet külön bejegyzésként jelenik meg, így könnyen áttekinthető, megszavazható és megbeszélhető!

### 💡 Hogyan küldhetsz be új ötletet?
1. Kattints az **Új bejegyzés** gombra a tetején.
2. Adj egy rövid, kifejező **címet** az ötletednek (pl. *„Sötét/Világos téma kapcsoló”* vagy *„Új kvízkérdések”*).
3. Válaszd ki a megfelelő **címkét** (✨ *Új funkció*, 🎵 *Zenegép & Videó*, 🎮 *Játék*, 🎨 *Design*, 📱 *Mobil*).
4. Fejtsd ki részletesen az elképzelésedet!

### 👍 Szavazás és támogatás:
- Ha tetszik egy diáktársad ötlete, reagálj a bejegyzésre 👍 vagy 🔥 emojival!
- A legtöbb szavazatot kapott ötleteket a fejlesztői csapat (**Lead Dev** & **Fejlesztők**) átnézi, és beépíti a következő weboldal-frissítésbe a [sulibell.vercel.app](https://sulibell.vercel.app) oldalon!

*Köszönjük, hogy segítesz jobbá tenni a sulit! 🚀*`

  try {
    const thread = await api(`/channels/${forum.id}/threads`, 'POST', {
      name: '📌 Útmutató az ötletek beküldéséhez (Kérjük olvasd el!)',
      message: {
        content: guideContent,
      },
      applied_tags: guideTag ? [guideTag.id] : [],
    })
    console.log(`✅ Tájékoztató bejegyzés sikeresen közzétéve! (Thread ID: ${thread.id})`)

    // Rögzítés (Pin)
    try {
      await api(`/channels/${thread.id}`, 'PATCH', {
        flags: 1 << 1, // PINNED thread in forum
      })
      console.log('📌 Bejegyzés kitűzve a fórum tetejére!')
    } catch {
      // Nem baj ha nem tudja pinelni a flag-gel
    }
  } catch (err: any) {
    console.error('⚠️ Hiba a tájékoztató thread létrehozásakor:', err.message)
  }

  console.log('\n🎉 Kész! A Discord ötletek csatorna sikeresen átalakítva Fórum típusúvá.')
}

run().catch(console.error)
