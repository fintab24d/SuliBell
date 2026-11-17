import 'dotenv/config'
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

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
})

/** @typedef {{ title: string, url: string, duration: string, requestedBy: string, thumbnail?: string }} Track */

/** @type {Map<string, { guildId: string, textChannel: any, voiceChannelId: string, connection: any, player: any, queue: Track[], current: Track | null, idleTimer: any }>} */
const queues = new Map()

const COLORS = {
  brand: 0x6366f1,
  ok: 0x22c55e,
  warn: 0xf59e0b,
  err: 0xef4444,
}

const slashCommands = [
  new SlashCommandBuilder()
    .setName('play')
    .setDescription('Zene lejátszása vagy hozzáadása a várólistához (YouTube link vagy keresés)')
    .addStringOption((opt) =>
      opt.setName('kereses').setDescription('YouTube URL vagy dal címe').setRequired(true)
    ),
  new SlashCommandBuilder().setName('skip').setDescription('Jelenlegi dal átugrása'),
  new SlashCommandBuilder().setName('stop').setDescription('Lejátszás leállítása és várólista törlése'),
  new SlashCommandBuilder().setName('pause').setDescription('Zene szüneteltetése'),
  new SlashCommandBuilder().setName('resume').setDescription('Szüneteltetett zene folytatása'),
  new SlashCommandBuilder().setName('queue').setDescription('Várólista megtekintése'),
  new SlashCommandBuilder().setName('np').setDescription('Mi szól most?'),
  new SlashCommandBuilder().setName('leave').setDescription('Bot kiléptetése a hangcsatornából'),
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

async function resolveTrack(query, requestedBy) {
  const trimmed = query.trim()
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
      },
    ]
  }

  if (ytType === 'playlist') {
    const playlist = await play.playlist_info(trimmed, { incomplete: true })
    const videos = await playlist.all_videos()
    return videos.slice(0, 25).map((v) => ({
      title: v.title || 'Ismeretlen dal',
      url: v.url,
      duration: v.durationRaw || '?:??',
      requestedBy,
      thumbnail: v.thumbnails?.[0]?.url,
    }))
  }

  const results = await play.search(trimmed, { limit: 1, source: { youtube: 'video' } })
  if (!results.length) return []
  const top = results[0]
  return [
    {
      title: top.title || trimmed,
      url: top.url,
      duration: top.durationRaw || '?:??',
      requestedBy,
      thumbnail: top.thumbnails?.[0]?.url,
    },
  ]
}

async function playNext(guildId) {
  const state = queues.get(guildId)
  if (!state) return

  const next = state.queue.shift() || null
  state.current = next

  if (!next) {
    scheduleIdleDisconnect(guildId)
    return
  }

  clearIdleTimer(state)

  try {
    const stream = await play.stream(next.url, { discordPlayerCompatibility: true })
    const resource = createAudioResource(stream.stream, {
      inputType: stream.type,
    })
    state.player.play(resource)

    const embed = makeEmbed(
      '🎵 Most szól',
      `**[${next.title}](${next.url})**\n⏱️ Hossz: \`${next.duration}\` • 👤 Kérte: ${next.requestedBy}`,
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
    await playNext(guildId)
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
      idleTimer: null,
    }

    connection.subscribe(player)

    player.on(AudioPlayerStatus.Idle, () => {
      playNext(guild.id).catch((e) => console.error('playNext hiba:', e))
    })

    player.on('error', (err) => {
      console.error('AudioPlayer hiba:', err)
      playNext(guild.id).catch(() => {})
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

  await entersState(state.connection, VoiceConnectionStatus.Ready, 15_000)
  return state
}

async function handlePlay({ guild, member, textChannel, query, respond }) {
  const voiceChannel = member?.voice?.channel
  if (!voiceChannel) {
    return respond({
      embeds: [makeEmbed('🔊 Hangcsatorna szükséges', 'Előbb lépj be egy hangcsatornába!', COLORS.warn)],
      ephemeral: true,
    })
  }

  const tracks = await resolveTrack(query, `<@${member.id}>`)
  if (!tracks.length) {
    return respond({
      embeds: [makeEmbed('🔎 Nincs találat', `Nem találtam zenét erre: \`${query}\``, COLORS.warn)],
      ephemeral: true,
    })
  }

  const state = await ensureQueueState(guild, voiceChannel, textChannel)
  const wasIdle = !state.current && state.player.state.status === AudioPlayerStatus.Idle
  state.queue.push(...tracks)

  if (tracks.length === 1) {
    const t = tracks[0]
    await respond({
      embeds: [
        makeEmbed(
          wasIdle ? '▶️ Indítás...' : '➕ Hozzáadva a várólistához',
          `**[${t.title}](${t.url})** (\`${t.duration}\`)`,
          COLORS.brand
        ),
      ],
    })
  } else {
    await respond({
      embeds: [
        makeEmbed(
          '📃 Lejátszási lista hozzáadva',
          `**${tracks.length} dal** hozzáadva a várólistához!`,
          COLORS.brand
        ),
      ],
    })
  }

  if (wasIdle) {
    await playNext(guild.id)
  }
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
          embeds: [makeEmbed('ℹ️ Használat', `Add meg a dal nevét vagy YouTube linkjét! Pl. \`${PREFIX}play Rick Astley\``, COLORS.warn)],
          ephemeral: true,
        })
      }
      return handlePlay({ guild, member, textChannel, query, respond })
    }

    case 'skip':
    case 's': {
      if (!state?.current) {
        return respond({ embeds: [makeEmbed('ℹ️ Nincs aktív dal', 'Jelenleg nem szól semmi.', COLORS.warn)], ephemeral: true })
      }
      const skipped = state.current.title
      state.player.stop(true)
      return respond({ embeds: [makeEmbed('⏭️ Átugorva', `Átugrottam: **${skipped}**`, COLORS.brand)] })
    }

    case 'stop': {
      if (!state) {
        return respond({ embeds: [makeEmbed('ℹ️ Nem szól zene', 'Nincs aktív lejátszás.', COLORS.warn)], ephemeral: true })
      }
      state.queue = []
      state.current = null
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

    case 'np':
    case 'nowplaying': {
      if (!state?.current) {
        return respond({ embeds: [makeEmbed('ℹ️ Csend van', 'Jelenleg nem szól zene.', COLORS.warn)], ephemeral: true })
      }
      const t = state.current
      return respond({
        embeds: [
          makeEmbed(
            '🎵 Most szól',
            `**[${t.title}](${t.url})**\n⏱️ \`${t.duration}\` • 👤 ${t.requestedBy}`,
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
        lines.push(`**Most szól:** [${state.current.title}](${state.current.url}) (\`${state.current.duration}\`)`)
      }
      if (state.queue.length) {
        lines.push('')
        state.queue.slice(0, 10).forEach((t, i) => {
          lines.push(`\`${i + 1}.\` [${t.title}](${t.url}) (\`${t.duration}\`) — ${t.requestedBy}`)
        })
        if (state.queue.length > 10) {
          lines.push(`... és még **${state.queue.length - 10}** dal`)
        }
      }
      return respond({ embeds: [makeEmbed('📃 Várólista', lines.join('\n'), COLORS.brand)] })
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
              `\`/play <dal vagy link>\` vagy \`${PREFIX}play <dal vagy link>\` — Zene indítása / hozzáadása`,
              `\`/skip\` vagy \`${PREFIX}skip\` — Dal átugrása`,
              `\`/pause\` / \`/resume\` — Szüneteltetés / folytatás`,
              `\`/stop\` — Leállítás és várólista törlése`,
              `\`/queue\` — Várólista megtekintése`,
              `\`/np\` — Jelenleg szóló dal`,
              `\`/leave\` — Kilépés a hangcsatornából`,
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
  const args = cmd === 'play' ? [interaction.options.getString('kereses', true)] : []

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
