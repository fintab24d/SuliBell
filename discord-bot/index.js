import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ffmpegStatic from 'ffmpeg-static'
import {
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from 'discord.js'
import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  getVoiceConnection,
  joinVoiceChannel,
} from '@discordjs/voice'
import play from 'play-dl'

if (ffmpegStatic && !process.env.FFMPEG_PATH) {
  process.env.FFMPEG_PATH = ffmpegStatic
}

const TOKEN = process.env.DISCORD_BOT_TOKEN?.trim()
const GUILD_ID = process.env.DISCORD_GUILD_ID?.trim() || ''
const PREFIX = process.env.BOT_PREFIX?.trim() || '!'

if (!TOKEN) {
  console.error('❌ Hiányzik a DISCORD_BOT_TOKEN a discord-bot/.env fájlból!')
  process.exit(1)
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PLAYLISTS_FILE = path.join(__dirname, 'playlists.json')

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
})

/**
 * @typedef {{
 *   title: string,
 *   url?: string,
 *   searchQuery?: string,
 *   duration: string,
 *   requestedBy: string,
 *   thumbnail?: string,
 *   source: 'youtube' | 'spotify' | 'soundcloud' | 'apple'
 * }} Track
 */

/**
 * @type {Map<string, {
 *   guildId: string,
 *   textChannel: any,
 *   voiceChannelId: string,
 *   connection: any,
 *   player: any,
 *   queue: Track[],
 *   current: Track | null,
 *   loop: 'off' | 'track' | 'queue',
 *   idleTimer: any
 * }>}
 */
const queues = new Map()

const COLORS = {
  brand: 0x6366f1,
  ok: 0x22c55e,
  warn: 0xf59e0b,
  err: 0xef4444,
}

const SOURCE_BADGE = {
  youtube: '🔴 YouTube',
  spotify: '🟢 Spotify',
  soundcloud: '🟠 SoundCloud',
  apple: '🍎 Apple Music',
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

// --- Mentett szerver playlistek (playlists.json) ---
function loadPlaylists() {
  try {
    if (!fs.existsSync(PLAYLISTS_FILE)) return {}
    return JSON.parse(fs.readFileSync(PLAYLISTS_FILE, 'utf8')) || {}
  } catch {
    return {}
  }
}

function savePlaylists(data) {
  fs.writeFileSync(PLAYLISTS_FILE, JSON.stringify(data, null, 2), 'utf8')
}

function getGuildPlaylists(guildId) {
  const all = loadPlaylists()
  return all[guildId] || {}
}

function setGuildPlaylists(guildId, guildLists) {
  const all = loadPlaylists()
  all[guildId] = guildLists
  savePlaylists(all)
}

// --- Slash parancsok ---
const slashCommands = [
  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Zene vagy playlist lejátszása (YouTube, Spotify, SoundCloud, Apple Music, keresés)')
    .addStringOption((opt) =>
      opt.setName('kereses').setDescription('Link vagy dal/előadó címe').setRequired(true)
    ),
  new SlashCommandBuilder().setName('skip').setDescription('Jelenlegi dal átugrása'),
  new SlashCommandBuilder().setName('stop').setDescription('Lejátszás leállítása és várólista törlése'),
  new SlashCommandBuilder().setName('pause').setDescription('Zene szüneteltetése'),
  new SlashCommandBuilder().setName('resume').setDescription('Szüneteltetett zene folytatása'),
  new SlashCommandBuilder().setName('shuffle').setDescription('Várólista megkeverése'),
  new SlashCommandBuilder()
    .setName('loop')
    .setDescription('Ismétlés mód beállítása')
    .addStringOption((opt) =>
      opt
        .setName('mod')
        .setDescription('off / track / queue')
        .setRequired(true)
        .addChoices(
          { name: 'Kikapcsolva', value: 'off' },
          { name: 'Aktuális dal', value: 'track' },
          { name: 'Teljes várólista', value: 'queue' }
        )
    ),
  new SlashCommandBuilder().setName('queue').setDescription('Várólista megtekintése'),
  new SlashCommandBuilder().setName('np').setDescription('Mi szól most?'),
  new SlashCommandBuilder().setName('leave').setDescription('Bot kiléptetése a hangcsatornából'),
  new SlashCommandBuilder()
    .setName('playlist')
    .setDescription('Saját mentett playlistek kezelése')
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Új playlist létrehozása')
        .addStringOption((o) => o.setName('nev').setDescription('Playlist neve').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('add')
        .setDescription('Dal vagy külső playlist hozzáadása a mentett playlisthez')
        .addStringOption((o) => o.setName('nev').setDescription('Playlist neve').setRequired(true))
        .addStringOption((o) => o.setName('kereses').setDescription('YouTube/Spotify/SoundCloud/Apple link vagy cím').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('play')
        .setDescription('Mentett playlist lejátszása')
        .addStringOption((o) => o.setName('nev').setDescription('Playlist neve').setRequired(true))
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('Mentett playlistek listázása'))
    .addSubcommand((sub) =>
      sub
        .setName('show')
        .setDescription('Mentett playlist tartalma')
        .addStringOption((o) => o.setName('nev').setDescription('Playlist neve').setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName('delete')
        .setDescription('Mentett playlist törlése')
        .addStringOption((o) => o.setName('nev').setDescription('Playlist neve').setRequired(true))
    ),
  new SlashCommandBuilder().setName('help').setDescription('Zenelejátszó parancsok listája'),
].map((c) => c.toJSON())

function makeEmbed(title, description, color = COLORS.brand) {
  return new EmbedBuilder().setColor(color).setTitle(title).setDescription(description)
}

function clearIdleTimer(state) {
  if (state?.idleTimer) {
    clearTimeout(state.idleTimer)
    state.idleTimer = null
  }
}

function scheduleIdleDisconnect(guildId) {
  const state = queues.get(guildId)
  if (!state) return
  clearIdleTimer(state)
  state.idleTimer = setTimeout(() => {
    const currentState = queues.get(guildId)
    if (!currentState) return
    if (!currentState.current && currentState.queue.length === 0) {
      try {
        currentState.connection?.destroy()
      } catch {}
      queues.delete(guildId)
    }
  }, 3 * 60 * 1000)
}

function formatSec(sec) {
  if (!sec || !Number.isFinite(sec)) return '?:??'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function decodeHtml(str = '') {
  return String(str)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}

// --- Spotify link feloldás (API kulcs nélkül, nyilvános embed/oembed alapján) ---
async function resolveSpotify(url, requestedBy) {
  const cleanUrl = url.split('?')[0]
  const m = cleanUrl.match(/open\.spotify\.com\/(?:intl-[a-z]+\/)?(track|album|playlist)\/([a-zA-Z0-9]+)/)
  if (!m) return []
  const [, kind, id] = m

  if (kind === 'track') {
    // Először embed oldal (tartalmazza a pontos előadót és címet), fallbackként oEmbed
    try {
      const res = await fetch(`https://open.spotify.com/embed/track/${id}`, { headers: { 'User-Agent': UA } })
      if (res.ok) {
        const html = await res.text()
        const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
        if (nextMatch) {
          const data = JSON.parse(nextMatch[1])
          const entity = data?.props?.pageProps?.state?.data?.entity
          if (entity?.name) {
            const artists = (entity.artists || []).map((a) => a.name).filter(Boolean).join(', ')
            const fullTitle = artists ? `${artists} - ${entity.name}` : entity.name
            return [
              {
                title: fullTitle,
                searchQuery: fullTitle,
                duration: entity.duration ? formatSec(entity.duration / 1000) : '?:??',
                requestedBy,
                source: 'spotify',
              },
            ]
          }
        }
      }
    } catch {}

    const oe = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(cleanUrl)}`).then((r) =>
      r.ok ? r.json() : null
    )
    if (oe?.title) {
      return [
        {
          title: oe.title,
          searchQuery: oe.title,
          duration: '?:??',
          requestedBy,
          thumbnail: oe.thumbnail_url,
          source: 'spotify',
        },
      ]
    }
    return []
  }

  // Album vagy Playlist
  const res = await fetch(`https://open.spotify.com/embed/${kind}/${id}`, { headers: { 'User-Agent': UA } })
  if (!res.ok) return []
  const html = await res.text()
  const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
  if (!nextMatch) return []
  const data = JSON.parse(nextMatch[1])
  const entity = data?.props?.pageProps?.state?.data?.entity
  const trackList = entity?.trackList || []

  return trackList.slice(0, 60).map((t) => {
    const artist = t.subtitle || ''
    const title = artist ? `${artist} - ${t.title}` : t.title
    return {
      title,
      searchQuery: title,
      duration: t.duration ? formatSec(t.duration / 1000) : '?:??',
      requestedBy,
      source: 'spotify',
    }
  })
}

// --- Apple Music link feloldás (song, album, playlist) ---
async function resolveAppleMusic(url, requestedBy) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9,hu;q=0.8' } })
  if (!res.ok) return []
  const html = await res.text()

  const tracks = []
  const ldMatches = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
  for (const match of ldMatches) {
    try {
      const json = JSON.parse(match[1])
      const list = Array.isArray(json) ? json : [json]
      for (const item of list) {
        if (item?.track && Array.isArray(item.track)) {
          const albumArtist = item.byArtist?.[0]?.name || item.byArtist?.name || ''
          for (const tr of item.track.slice(0, 60)) {
            const artist = tr.byArtist?.[0]?.name || tr.byArtist?.name || albumArtist
            const name = decodeHtml(tr.name || '')
            if (!name) continue
            const title = artist ? `${decodeHtml(artist)} - ${name}` : name
            tracks.push({
              title,
              searchQuery: title,
              duration: '?:??',
              requestedBy,
              source: 'apple',
            })
          }
        } else if (item?.['@type'] === 'MusicRecording' && item?.name) {
          const artist = item.byArtist?.[0]?.name || item.byArtist?.name || ''
          const title = artist ? `${decodeHtml(artist)} - ${decodeHtml(item.name)}` : decodeHtml(item.name)
          tracks.push({
            title,
            searchQuery: title,
            duration: '?:??',
            requestedBy,
            source: 'apple',
          })
        }
      }
    } catch {}
  }

  if (tracks.length > 0) return tracks

  // Fallback: og:title / twitter:title
  const ogTitle =
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]
  if (ogTitle) {
    const clean = decodeHtml(ogTitle)
      .replace(/\s+on\s+Apple\s+Music$/i, '')
      .replace(/\s+az\s+Apple\s+Music-on$/i, '')
      .replace(/\s+by\s+/i, ' - ')
      .trim()
    if (clean) {
      return [
        {
          title: clean,
          searchQuery: clean,
          duration: '?:??',
          requestedBy,
          source: 'apple',
        },
      ]
    }
  }
  return []
}

// --- SoundCloud link feloldás (track vagy set/playlist) ---
async function resolveSoundCloud(url, requestedBy) {
  try {
    const so = await play.soundcloud(url)
    if (so?.type === 'track') {
      return [
        {
          title: so.name || 'SoundCloud dal',
          url: so.url || url,
          searchQuery: so.name,
          duration: so.durationInSec ? formatSec(so.durationInSec) : '?:??',
          requestedBy,
          thumbnail: so.thumbnail,
          source: 'soundcloud',
        },
      ]
    }
    if (so?.type === 'playlist') {
      const list = await so.all_tracks()
      return list.slice(0, 60).map((t) => ({
        title: t.name || 'SoundCloud dal',
        url: t.url,
        searchQuery: t.name,
        duration: t.durationInSec ? formatSec(t.durationInSec) : '?:??',
        requestedBy,
        thumbnail: t.thumbnail,
        source: 'soundcloud',
      }))
    }
  } catch (err) {
    console.warn('SoundCloud metaadat fallback:', err?.message || err)
  }

  // Fallback HTML oEmbedből YouTube keresésre
  try {
    const oe = await fetch(`https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url)}`).then((r) =>
      r.ok ? r.json() : null
    )
    if (oe?.title) {
      return [
        {
          title: oe.title,
          searchQuery: oe.title,
          duration: '?:??',
          requestedBy,
          thumbnail: oe.thumbnail_url,
          source: 'soundcloud',
        },
      ]
    }
  } catch {}
  return []
}

async function searchYoutubeSafe(query) {
  try {
    const results = await play.search(query, { limit: 1, source: { youtube: 'video' } })
    if (results.length) {
      const top = results[0]
      return {
        title: top.title || query,
        url: top.url,
        duration: top.durationRaw || '?:??',
        thumbnail: top.thumbnails?.[0]?.url,
      }
    }
  } catch (err) {
    console.warn('play.search fallback aktiválva:', err?.message || err)
  }

  // Fallback: natív fetch-alapú YouTube keresés (nem érinti a node:http header limit)
  try {
    const r = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, {
      headers: { 'User-Agent': UA, 'Accept-Language': 'hu-HU,hu;q=0.9,en-US;q=0.8,en;q=0.7' },
    })
    if (!r.ok) return null
    const html = await r.text()
    const m = /"videoId":"([a-zA-Z0-9_-]{11})"/.exec(html)
    if (!m) return null
    const ytId = m[1]
    const url = `https://www.youtube.com/watch?v=${ytId}`
    let title = query
    try {
      const oe = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`).then((x) =>
        x.ok ? x.json() : null
      )
      if (oe?.title) title = oe.title
    } catch {}
    return {
      title,
      url,
      duration: '?:??',
      thumbnail: `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`,
    }
  } catch {
    return null
  }
}

// --- Általános bemenet feloldó (YouTube, Spotify, SoundCloud, Apple Music, keresés) ---
async function resolveInput(query, requestedBy) {
  const trimmed = query.trim()

  // 1. Spotify
  if (/open\.spotify\.com\//i.test(trimmed)) {
    return resolveSpotify(trimmed, requestedBy)
  }

  // 2. Apple Music
  if (/music\.apple\.com\//i.test(trimmed)) {
    return resolveAppleMusic(trimmed, requestedBy)
  }

  // 3. SoundCloud
  if (/soundcloud\.com\//i.test(trimmed)) {
    return resolveSoundCloud(trimmed, requestedBy)
  }

  // 4. YouTube link / playlist
  const ytType = play.yt_validate(trimmed)
  if (ytType === 'video') {
    const info = await play.video_info(trimmed)
    const d = info.video_details
    return [
      {
        title: d.title || 'Ismeretlen dal',
        url: d.url,
        duration: d.durationRaw || '?:??',
        requestedBy,
        thumbnail: d.thumbnails?.[0]?.url,
        source: 'youtube',
      },
    ]
  }

  if (ytType === 'playlist') {
    const playlist = await play.playlist_info(trimmed, { incomplete: true })
    const videos = await playlist.all_videos()
    return videos.slice(0, 60).map((v) => ({
      title: v.title || 'Ismeretlen dal',
      url: v.url,
      duration: v.durationRaw || '?:??',
      requestedBy,
      thumbnail: v.thumbnails?.[0]?.url,
      source: 'youtube',
    }))
  }

  // 5. Szöveges keresés (YouTube)
  const top = await searchYoutubeSafe(trimmed)
  if (!top) return []
  return [
    {
      title: top.title,
      url: top.url,
      duration: top.duration,
      requestedBy,
      thumbnail: top.thumbnail,
      source: 'youtube',
    },
  ]
}

async function createStreamForTrack(track) {
  // Ha SoundCloud natív URL van, próbáljuk meg először közvetlenül streamelni
  if (track.source === 'soundcloud' && track.url) {
    try {
      return await play.stream(track.url, { discordPlayerCompatibility: true })
    } catch (e) {
      console.warn('SoundCloud stream hiba, váltás YouTube keresésre:', e?.message || e)
    }
  }

  // Ha nincs még YouTube URL (Spotify / Apple Music / fallback), keressük meg most (lazy)
  let targetUrl = track.url
  if (!targetUrl || track.source === 'spotify' || track.source === 'apple' || track.source === 'soundcloud') {
    const q = track.searchQuery || track.title
    const found = await searchYoutubeSafe(q)
    if (!found) throw new Error(`Nem található stream a dalhoz: ${track.title}`)
    targetUrl = found.url
    if (!track.thumbnail && found.thumbnail) track.thumbnail = found.thumbnail
    if (track.duration === '?:??' && found.duration) track.duration = found.duration
  }

  return play.stream(targetUrl, { discordPlayerCompatibility: true })
}

async function playNext(guildId, finishedTrack = null) {
  const state = queues.get(guildId)
  if (!state) return

  let next = null
  if (state.loop === 'track' && finishedTrack) {
    next = finishedTrack
  } else {
    if (state.loop === 'queue' && finishedTrack) {
      state.queue.push(finishedTrack)
    }
    next = state.queue.shift() || null
  }

  state.current = next

  if (!next) {
    scheduleIdleDisconnect(guildId)
    return
  }

  clearIdleTimer(state)

  try {
    const stream = await createStreamForTrack(next)
    const resource = createAudioResource(stream.stream, {
      inputType: stream.type,
    })
    state.player.play(resource)

    const badge = SOURCE_BADGE[next.source] || '🎵'
    const titleLine = next.url ? `**[${next.title}](${next.url})**` : `**${next.title}**`
    const embed = makeEmbed(
      '🎵 Most szól',
      `${titleLine}\n${badge} • ⏱️ Hossz: \`${next.duration}\` • 👤 Kérte: ${next.requestedBy}`,
      COLORS.ok
    )
    if (next.thumbnail) embed.setThumbnail(next.thumbnail)
    state.textChannel?.send({ embeds: [embed] }).catch(() => {})
  } catch (err) {
    console.error('Lejátszási hiba:', err)
    state.textChannel
      ?.send({
        embeds: [
          makeEmbed(
            '❌ Nem sikerült lejátszani',
            `Hiba történt a dal betöltésekor: **${next.title}**\nUgrás a következőre...`,
            COLORS.err
          ),
        ],
      })
      .catch(() => {})
    await playNext(guildId, null)
  }
}

async function ensureQueueState(guild, voiceChannel, textChannel) {
  let state = queues.get(guild.id)

  if (!state) {
    const player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
    })

    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
    })

    state = {
      guildId: guild.id,
      textChannel,
      voiceChannelId: voiceChannel.id,
      connection,
      player,
      queue: [],
      current: null,
      loop: 'off',
      idleTimer: null,
    }

    connection.subscribe(player)

    player.on(AudioPlayerStatus.Idle, () => {
      const done = state.current
      playNext(guild.id, done).catch((e) => console.error('playNext hiba:', e))
    })

    player.on('error', (err) => {
      console.error('AudioPlayer hiba:', err)
      playNext(guild.id, null).catch(() => {})
    })

    connection.on('error', (err) => {
      console.error('VoiceConnection hiba:', err)
    })

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ])
      } catch {
        clearIdleTimer(state)
        try {
          connection.destroy()
        } catch {}
        queues.delete(guild.id)
      }
    })

    queues.set(guild.id, state)
  } else {
    state.textChannel = textChannel
    if (state.voiceChannelId !== voiceChannel.id) {
      state.connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: true,
      })
      state.connection.subscribe(state.player)
      state.voiceChannelId = voiceChannel.id
    }
  }

  try {
    await entersState(state.connection, VoiceConnectionStatus.Ready, 25_000)
  } catch (err) {
    clearIdleTimer(state)
    try {
      state.connection?.destroy()
    } catch {}
    queues.delete(guild.id)
    throw new Error(
      `Nem sikerült csatlakozni a hangcsatornához (${voiceChannel.name}). Ellenőrizd, hogy a botnak van-e Connect/Speak joga ebben a szobában!`
    )
  }
  return state
}

async function enqueueTracks({ guild, member, textChannel, tracks, respond, label }) {
  const voiceChannel = member?.voice?.channel
  if (!voiceChannel) {
    return respond({
      embeds: [makeEmbed('🔊 Hangcsatorna szükséges', 'Előbb lépj be egy hangcsatornába!', COLORS.warn)],
      ephemeral: true,
    })
  }

  const state = await ensureQueueState(guild, voiceChannel, textChannel)
  const wasIdle = !state.current && state.player.state.status === AudioPlayerStatus.Idle
  state.queue.push(...tracks)

  if (tracks.length === 1) {
    const t = tracks[0]
    const badge = SOURCE_BADGE[t.source] || '🎵'
    const titleLine = t.url ? `**[${t.title}](${t.url})**` : `**${t.title}**`
    await respond({
      embeds: [
        makeEmbed(
          wasIdle ? '▶️ Indítás...' : '➕ Hozzáadva a várólistához',
          `${titleLine} (\`${t.duration}\`) • ${badge}`,
          COLORS.brand
        ),
      ],
    })
  } else {
    const badge = SOURCE_BADGE[tracks[0].source] || '📃'
    await respond({
      embeds: [
        makeEmbed(
          '📃 Playlist hozzáadva a várólistához',
          `${label ? `**${label}** — ` : ''}**${tracks.length} dal** hozzáadva! (${badge})`,
          COLORS.brand
        ),
      ],
    })
  }

  if (wasIdle) {
    await playNext(guild.id, null)
  }
}

async function handlePlaylistCommand(sub, args, ctx) {
  const { guild, member, textChannel, respond } = ctx
  const lists = getGuildPlaylists(guild.id)

  if (sub === 'list') {
    const names = Object.keys(lists)
    if (!names.length) {
      return respond({
        embeds: [
          makeEmbed(
            '📂 Mentett playlistek',
            `Még nincs egyetlen mentett playlist sem.\nHozz létre egyet: \`/playlist create <név>\` vagy \`${PREFIX}pl create <név>\``,
            COLORS.brand
          ),
        ],
      })
    }
    const lines = names.map((n) => `• **${n}** — ${lists[n].length} dal`)
    return respond({ embeds: [makeEmbed('📂 Mentett playlistek', lines.join('\n'), COLORS.brand)] })
  }

  const name = (args[0] || '').trim().toLowerCase()
  if (!name) {
    return respond({
      embeds: [makeEmbed('ℹ️ Hiányzó név', 'Add meg a playlist nevét!', COLORS.warn)],
      ephemeral: true,
    })
  }

  if (sub === 'create') {
    if (lists[name]) {
      return respond({
        embeds: [makeEmbed('⚠️ Már létezik', `A(z) **${name}** playlist már létezik!`, COLORS.warn)],
        ephemeral: true,
      })
    }
    lists[name] = []
    setGuildPlaylists(guild.id, lists)
    return respond({
      embeds: [
        makeEmbed(
          '✅ Playlist létrehozva',
          `Létrehozva: **${name}**\nAdj hozzá zenéket: \`/playlist add ${name} <link vagy cím>\``,
          COLORS.ok
        ),
      ],
    })
  }

  if (sub === 'delete') {
    if (!lists[name]) {
      return respond({ embeds: [makeEmbed('❌ Nem található', `Nincs **${name}** nevű playlist.`, COLORS.err)], ephemeral: true })
    }
    delete lists[name]
    setGuildPlaylists(guild.id, lists)
    return respond({ embeds: [makeEmbed('🗑️ Törölve', `A(z) **${name}** playlist törölve.`, COLORS.warn)] })
  }

  if (sub === 'show') {
    const items = lists[name]
    if (!items) {
      return respond({ embeds: [makeEmbed('❌ Nem található', `Nincs **${name}** nevű playlist.`, COLORS.err)], ephemeral: true })
    }
    if (!items.length) {
      return respond({ embeds: [makeEmbed(`📂 ${name}`, 'Ez a playlist még üres.', COLORS.brand)] })
    }
    const lines = items.slice(0, 15).map((t, i) => `\`${i + 1}.\` **${t.title}** (\`${t.duration}\`)`)
    if (items.length > 15) lines.push(`... és még **${items.length - 15}** dal`)
    return respond({ embeds: [makeEmbed(`📂 Playlist: ${name} (${items.length} dal)`, lines.join('\n'), COLORS.brand)] })
  }

  if (sub === 'add') {
    if (!lists[name]) lists[name] = []
    const query = args.slice(1).join(' ').trim()
    if (!query) {
      return respond({
        embeds: [makeEmbed('ℹ️ Hiányzó dal/link', 'Add meg a hozzáadandó dal címét vagy linkjét!', COLORS.warn)],
        ephemeral: true,
      })
    }
    const resolved = await resolveInput(query, `<@${member.id}>`)
    if (!resolved.length) {
      return respond({ embeds: [makeEmbed('🔎 Nincs találat', `Nem találtam zenét erre: \`${query}\``, COLORS.warn)], ephemeral: true })
    }
    for (const t of resolved) {
      lists[name].push({
        title: t.title,
        url: t.url,
        searchQuery: t.searchQuery,
        duration: t.duration,
        thumbnail: t.thumbnail,
        source: t.source,
      })
    }
    setGuildPlaylists(guild.id, lists)
    return respond({
      embeds: [
        makeEmbed(
          '➕ Hozzáadva a playlisthez',
          `**${resolved.length} dal** hozzáadva a(z) **${name}** playlisthez! (Összesen: ${lists[name].length} dal)`,
          COLORS.ok
        ),
      ],
    })
  }

  if (sub === 'play') {
    const items = lists[name]
    if (!items || !items.length) {
      return respond({
        embeds: [makeEmbed('⚠️ Üres vagy nem létező playlist', `A(z) **${name}** playlist üres vagy nem létezik.`, COLORS.warn)],
        ephemeral: true,
      })
    }
    const tracks = items.map((t) => ({ ...t, requestedBy: `<@${member.id}>` }))
    return enqueueTracks({ guild, member, textChannel, tracks, respond, label: name })
  }

  return respond({
    embeds: [
      makeEmbed(
        'ℹ️ Playlist parancs használata',
        `\`${PREFIX}pl create <név>\` | \`add <név> <link/cím>\` | \`play <név>\` | \`show <név>\` | \`list\` | \`delete <név>\``,
        COLORS.warn
      ),
    ],
    ephemeral: true,
  })
}

async function handleCommand(cmd, args, ctx) {
  const { guild, member, textChannel, respond } = ctx
  const state = queues.get(guild.id)

  switch (cmd) {
    case 'play':
    case 'p': {
      const query = args.join(' ').trim()
      if (!query) {
        return respond({
          embeds: [
            makeEmbed(
              'ℹ️ Használat',
              `Adj meg YouTube / Spotify / SoundCloud / Apple Music linket vagy dalcímet!\nPl. \`${PREFIX}play https://open.spotify.com/...\``,
              COLORS.warn
            ),
          ],
          ephemeral: true,
        })
      }
      const tracks = await resolveInput(query, `<@${member.id}>`)
      if (!tracks.length) {
        return respond({
          embeds: [makeEmbed('🔎 Nincs találat', `Nem sikerült zenét betölteni erről: \`${query}\``, COLORS.warn)],
          ephemeral: true,
        })
      }
      return enqueueTracks({ guild, member, textChannel, tracks, respond })
    }

    case 'skip':
    case 's': {
      if (!state?.current) {
        return respond({ embeds: [makeEmbed('ℹ️ Nincs aktív dal', 'Jelenleg nem szól semmi.', COLORS.warn)], ephemeral: true })
      }
      const skipped = state.current.title
      if (state.loop === 'track') state.loop = 'off'
      state.player.stop(true)
      return respond({ embeds: [makeEmbed('⏭️ Átugorva', `Átugrottam: **${skipped}**`, COLORS.brand)] })
    }

    case 'stop': {
      if (!state) {
        return respond({ embeds: [makeEmbed('ℹ️ Nem szól zene', 'Nincs aktív lejátszás.', COLORS.warn)], ephemeral: true })
      }
      state.queue = []
      state.current = null
      state.loop = 'off'
      state.player.stop(true)
      scheduleIdleDisconnect(guild.id)
      return respond({ embeds: [makeEmbed('⏹️ Leállítva', 'A zene leállt és a várólista kiürült.', COLORS.warn)] })
    }

    case 'pause': {
      if (!state?.current) {
        return respond({ embeds: [makeEmbed('ℹ️ Nincs aktív dal', 'Jelenleg nem szól semmi.', COLORS.warn)], ephemeral: true })
      }
      state.player.pause()
      return respond({ embeds: [makeEmbed('⏸️ Szüneteltetve', `Szünet: **${state.current.title}**`, COLORS.brand)] })
    }

    case 'resume': {
      if (!state?.current) {
        return respond({ embeds: [makeEmbed('ℹ️ Nincs szüneteltetett dal', 'Nincs mit folytatni.', COLORS.warn)], ephemeral: true })
      }
      state.player.unpause()
      return respond({ embeds: [makeEmbed('▶️ Folytatva', `Újra szól: **${state.current.title}**`, COLORS.ok)] })
    }

    case 'shuffle': {
      if (!state || state.queue.length < 2) {
        return respond({ embeds: [makeEmbed('ℹ️ Kevés dal', 'Legalább 2 dal kell a várólistában a keveréshez.', COLORS.warn)], ephemeral: true })
      }
      for (let i = state.queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[state.queue[i], state.queue[j]] = [state.queue[j], state.queue[i]]
      }
      return respond({ embeds: [makeEmbed('🔀 Megkeverve', `A várólista (**${state.queue.length} dal**) megkeverve!`, COLORS.brand)] })
    }

    case 'loop': {
      if (!state) {
        return respond({ embeds: [makeEmbed('ℹ️ Nem szól zene', 'Nincs aktív lejátszás.', COLORS.warn)], ephemeral: true })
      }
      const mode = (args[0] || '').toLowerCase()
      if (!['off', 'track', 'queue'].includes(mode)) {
        return respond({ embeds: [makeEmbed('ℹ️ Ismétlés módok', `Használat: \`${PREFIX}loop off | track | queue\``, COLORS.warn)], ephemeral: true })
      }
      state.loop = mode
      const label = mode === 'off' ? 'Kikapcsolva' : mode === 'track' ? 'Aktuális dal ismétlése 🔂' : 'Teljes várólista ismétlése 🔁'
      return respond({ embeds: [makeEmbed('🔁 Ismétlés', label, COLORS.brand)] })
    }

    case 'np':
    case 'nowplaying': {
      if (!state?.current) {
        return respond({ embeds: [makeEmbed('ℹ️ Csend van', 'Jelenleg nem szól zene.', COLORS.warn)], ephemeral: true })
      }
      const t = state.current
      const badge = SOURCE_BADGE[t.source] || '🎵'
      const titleLine = t.url ? `**[${t.title}](${t.url})**` : `**${t.title}**`
      return respond({
        embeds: [
          makeEmbed(
            '🎵 Most szól',
            `${titleLine}\n${badge} • ⏱️ \`${t.duration}\` • 👤 ${t.requestedBy}`,
            COLORS.brand
          ),
        ],
      })
    }

    case 'queue':
    case 'q': {
      if (!state || (!state.current && state.queue.length === 0)) {
        return respond({ embeds: [makeEmbed('📃 Várólista', 'A várólista jelenleg üres.', COLORS.brand)] })
      }
      const lines = []
      if (state.current) {
        lines.push(`**Most szól:** ${state.current.title} (\`${state.current.duration}\`)`)
      }
      if (state.queue.length) {
        lines.push('')
        state.queue.slice(0, 12).forEach((t, i) => {
          lines.push(`\`${i + 1}.\` ${t.title} (\`${t.duration}\`) — ${t.requestedBy}`)
        })
        if (state.queue.length > 12) {
          lines.push(`... és még **${state.queue.length - 12}** dal`)
        }
      }
      return respond({ embeds: [makeEmbed('📃 Várólista', lines.join('\n'), COLORS.brand)] })
    }

    case 'playlist':
    case 'pl': {
      const sub = (args[0] || 'list').toLowerCase()
      return handlePlaylistCommand(sub, args.slice(1), ctx)
    }

    case 'leave':
    case 'disconnect':
    case 'dc': {
      const conn = state?.connection || getVoiceConnection(guild.id)
      if (!conn) {
        return respond({ embeds: [makeEmbed('ℹ️ Nem vagyok hangcsatornában', 'Nincs aktív hangkapcsolat.', COLORS.warn)], ephemeral: true })
      }
      if (state) {
        clearIdleTimer(state)
        state.queue = []
        state.current = null
      }
      try {
        conn.destroy()
      } catch {}
      queues.delete(guild.id)
      return respond({ embeds: [makeEmbed('👋 Viszlát!', 'Kiléptem a hangcsatornából.', COLORS.brand)] })
    }

    case 'help': {
      return respond({
        embeds: [
          makeEmbed(
            '🎶 SuliBell Zenelejátszó Parancsok',
            [
              `**Támogatott források:** YouTube (dal & playlist), Spotify (dal, album, playlist), SoundCloud (dal & set), Apple Music (dal, album, playlist)`,
              '',
              `\`/play <link vagy keresés>\` vagy \`${PREFIX}play ...\` — Zene / playlist indítása`,
              `\`/playlist create|add|play|show|list|delete\` (vagy \`${PREFIX}pl ...\`) — Saját mentett playlistek`,
              `\`/skip\` — Dal átugrása • \`/pause\` / \`/resume\` — Szünet / folytatás`,
              `\`/shuffle\` — Várólista keverése • \`/loop off|track|queue\` — Ismétlés`,
              `\`/queue\` — Várólista • \`/np\` — Most szól • \`/stop\` — Leállítás • \`/leave\` — Kilépés`,
            ].join('\n'),
            COLORS.brand
          ),
        ],
      })
    }

    default:
      return null
  }
}

client.once('ready', async () => {
  console.log(`✅ Zenelejátszó bot belépett: ${client.user.tag}`)
  try {
    const scClientId = await play.getFreeClientID()
    if (scClientId) {
      await play.setToken({ soundcloud: { client_id: scClientId } })
      console.log('✅ SoundCloud kliens inicializálva')
    }
  } catch (e) {
    console.warn('⚠️ SoundCloud client_id lekérés sikertelen (YouTube fallback aktív):', e?.message || e)
  }

  const rest = new REST({ version: '10' }).setToken(TOKEN)
  try {
    if (GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: slashCommands })
      console.log(`✅ Slash parancsok regisztrálva a szerverre (${GUILD_ID})`)
    } else {
      await rest.put(Routes.applicationCommands(client.user.id), { body: slashCommands })
      console.log('✅ Globális slash parancsok regisztrálva')
    }
  } catch (err) {
    console.error('⚠️ Slash parancs regisztrációs hiba:', err)
  }
})

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand() || !interaction.guild) return

  const cmd = interaction.commandName
  let args = []
  if (cmd === 'play') {
    args = [interaction.options.getString('kereses', true)]
  } else if (cmd === 'loop') {
    args = [interaction.options.getString('mod', true)]
  } else if (cmd === 'playlist') {
    const sub = interaction.options.getSubcommand()
    const nev = interaction.options.getString('nev')
    const kereses = interaction.options.getString('kereses')
    args = [sub, ...(nev ? [nev] : []), ...(kereses ? [kereses] : [])]
  }

  await interaction.deferReply()
  const respond = async (payload) => {
    const clean = { ...payload }
    delete clean.ephemeral
    return interaction.editReply(clean)
  }

  try {
    await handleCommand(cmd, args, {
      guild: interaction.guild,
      member: interaction.member,
      textChannel: interaction.channel,
      respond,
    })
  } catch (err) {
    console.error('Slash parancs hiba:', err)
    await interaction.editReply({
      embeds: [makeEmbed('❌ Hiba történt', err?.message || 'Ismeretlen hiba', COLORS.err)],
    }).catch(() => {})
  }
})

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return
  if (!message.content.startsWith(PREFIX)) return

  const parts = message.content.slice(PREFIX.length).trim().split(/\s+/)
  const cmd = parts.shift()?.toLowerCase()
  if (!cmd) return

  const respond = async (payload) => {
    const clean = { ...payload }
    delete clean.ephemeral
    return message.reply(clean)
  }

  try {
    await handleCommand(cmd, parts, {
      guild: message.guild,
      member: message.member,
      textChannel: message.channel,
      respond,
    })
  } catch (err) {
    console.error('Prefix parancs hiba:', err)
    await message.reply({
      embeds: [makeEmbed('❌ Hiba történt', err?.message || 'Ismeretlen hiba', COLORS.err)],
    }).catch(() => {})
  }
})

client.login(TOKEN)
