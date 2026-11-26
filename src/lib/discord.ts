import { supabase } from './supabase'

export const DISCORD_INVITE_URL = 'https://discord.gg/uHhbhFB5rC'

export interface DiscordSongItem {
  id: string
  day: string
  title: string
  by: string
  ytId?: string
  votes: number
  vip?: boolean
  at: number
}

export interface DiscordAnnouncementItem {
  id: string
  text: string
  author: string
  at: number
}

export interface DiscordSyncData {
  songs: DiscordSongItem[]
  announcements: DiscordAnnouncementItem[]
  channels?: {
    music?: string
  }
}

let lastSyncAt = 0
let hasFetchedOnce = false
let cachedSync: DiscordSyncData = {
  songs: [],
  announcements: [],
  channels: {
    music: '#🎵-zenekérés-ötletek',
  },
}
let pendingSync: Promise<DiscordSyncData> | null = null

/**
 * Lekéri a Discord szerverről a #🎵-zenekérés-ötletek és #📢-közlemények szobák legfrissebb üzeneteit.
 */
export async function fetchDiscordSync(force = false): Promise<DiscordSyncData> {
  const now = Date.now()
  if (hasFetchedOnce && (!force ? now - lastSyncAt < 15_000 : now - lastSyncAt < 1_500)) {
    return cachedSync
  }
  if (pendingSync) return pendingSync

  pendingSync = (async () => {
    try {
      const { data, error } = await supabase.functions.invoke('discord-bridge', {
        body: { action: 'sync' },
      })
      if (!error && data?.ok) {
        cachedSync = {
          songs: Array.isArray(data.songs) ? data.songs : [],
          announcements: Array.isArray(data.announcements) ? data.announcements : [],
          channels: {
            music: typeof data.channels?.music === 'string' && data.channels.music ? data.channels.music : cachedSync.channels?.music,
          },
        }
        hasFetchedOnce = true
        lastSyncAt = Date.now()
      }
    } catch {
      // Offline vagy nem elérhető: marad a legutóbbi állapot
    } finally {
      pendingSync = null
    }
    return cachedSync
  })()

  return pendingSync
}

/**
 * Weboldal esemény átküldése a Discord szerver megfelelő csatornájába.
 */
export async function postToDiscord(payload: {
  kind: 'jukebox' | 'announcement' | 'alert' | 'change' | 'menu' | 'poll' | 'version' | 'git' | 'bug' | 'idea'
  [key: string]: unknown
}): Promise<boolean> {
  try {
    const { data, error } = await supabase.functions.invoke('discord-bridge', {
      body: { action: 'post', ...payload },
    })
    return !error && !!data?.ok
  } catch {
    return false
  }
}

/** Hibajelentés vagy ötlet/javaslat beküldése közvetlenül a Discord fórum-csatornába. */
export async function submitFeedbackToDiscord(params: {
  kind: 'bug' | 'idea'
  title: string
  details: string
  by?: string
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('discord-bridge', {
      body: {
        action: 'post',
        kind: params.kind,
        title: params.title,
        details: params.details,
        by: params.by,
      },
    })
    if (error) {
      return { ok: false, error: 'Nem sikerült kapcsolódni a szerverhez. Próbáld meg Discordon!' }
    }
    if (!data?.ok) {
      return {
        ok: false,
        error: typeof data?.error === 'string' && data.error
          ? data.error
          : 'A beküldés most nem sikerült — írd meg nyugodtan a Discordon!',
      }
    }
    return { ok: true }
  } catch {
    return { ok: false, error: 'Hálózati hiba történt. Próbáld meg kicsit később vagy a Discordon!' }
  }
}
