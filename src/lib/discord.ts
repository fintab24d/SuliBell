import { supabase } from './supabase'

export const DISCORD_INVITE_URL = 'https://discord.gg/uHhbhFB5rC'

export interface DiscordSongItem {
  id: string
  day: string
  title: string
  by: string
  ytId?: string
  votes: number
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
}

let lastSyncAt = 0
let cachedSync: DiscordSyncData = { songs: [], announcements: [] }
let pendingSync: Promise<DiscordSyncData> | null = null

/**
 * Lekéri a Discord szerverről a #🎵-zenekérés-ötletek és #📢-közlemények szobák legfrissebb üzeneteit.
 */
export async function fetchDiscordSync(force = false): Promise<DiscordSyncData> {
  const now = Date.now()
  if (!force && now - lastSyncAt < 10_000 && cachedSync.songs.length + cachedSync.announcements.length > 0) {
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
        }
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
  kind: 'jukebox' | 'announcement' | 'alert' | 'change' | 'menu' | 'poll'
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
