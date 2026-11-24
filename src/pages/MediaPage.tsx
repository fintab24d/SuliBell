import { memo } from 'react'
import BreakVideo from '../BreakVideo'
import Jukebox, { isJukeboxWeekend, useJukebox, type SongWish } from '../Jukebox'
import type { Phase } from '../lib/engine'
import type { MusicWindow } from '../lib/musicSync'
import type { RadioTrack } from '../lib/radio'
import { useMusicSync } from '../lib/useMusicSync'

export interface MediaPageProps {
  schoolId?: string
  day: string
  tz: string
  phase: Phase
  secs: number
  breakKey: string
  musicWindows: MusicWindow[]
  breakMusicEnabled: boolean
  sound: boolean
  userMuted: boolean
  christmas: boolean
  extraRadioTracks?: RadioTrack[]
  sandboxDemo?: { forceBreakMedia: boolean }
}

const MediaPage = memo(function MediaPage({
  schoolId,
  day,
  tz,
  phase,
  secs,
  breakKey,
  musicWindows,
  breakMusicEnabled,
  sound,
  userMuted,
  christmas,
  extraRadioTracks,
  sandboxDemo,
}: MediaPageProps) {
  const { songs: jbWishes, ghosts: jbGhosts } = useJukebox(schoolId, day, false)
  const effectiveWishes: SongWish[] =
    sandboxDemo?.forceBreakMedia
      ? [
          {
            id: 'sb-demo',
            day,
            kind: 'music',
            title: 'Cartoon – On & On (Szüneti Zene Mix)',
            by: 'Admin Tesztlabor',
            ytId: 'K4DyBUG242c',
            votes: 99,
            at: Date.now(),
          },
          ...jbWishes,
        ]
      : jbWishes

  const weekend = isJukeboxWeekend(day)
  const showPlayer =
    !weekend &&
    (phase === 'break' || (phase === 'before' && secs >= 7 * 3600 + 45 * 60) || (phase === 'after' && secs < 15 * 3600)) &&
    breakMusicEnabled

  const musicSync = useMusicSync({
    day,
    tz,
    secs,
    windows: musicWindows,
    wishes: effectiveWishes,
    ghosts: jbGhosts,
    christmas,
    customRadio: extraRadioTracks,
    enabled: showPlayer,
  })

  return (
    <div className="page-grid page-media">
      <div className="dash-col">
        {showPlayer ? (
          <BreakVideo
            sync={musicSync}
            soundOn={sound}
            userMuted={userMuted}
          />
        ) : (
          <section className="panel page-hint-card">
            <div className="tag" style={{ marginBottom: 6 }}>
              {weekend ? '🛌 Hétvégi szünet' : '🎧 Szüneti Zenelejátszó & SuliRádió'}
            </div>
            <p className="meta" style={{ margin: 0 }}>
              {weekend
                ? 'Hétvégén a szüneti zenebeküldés és zenelejátszás szünetel. Hétfőn újra indul!'
                : 'A zenelejátszó reggel 07:45-től, a szünetekben és tanítás után 15:00-ig központi idővonalon működik! Ha beküldesz egy YouTube-linket, az szól elsőként érkezési sorrendben — ha pedig nincs beküldött szám, automatikusan a SuliRádió gondoskodik a zenéről.'}
            </p>
          </section>
        )}
      </div>

      <div className="dash-col">
        <Jukebox
          schoolId={schoolId}
          day={day}
          breakKey={breakKey}
          sound={sound}
          christmas={christmas}
          playedIds={musicSync.startedWishIds}
          nowPlayingId={musicSync.nowPlayingWishId}
        />
      </div>
    </div>
  )
})

export default MediaPage
