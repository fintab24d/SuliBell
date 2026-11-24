import { memo } from 'react'
import BreakVideo from '../BreakVideo'
import Jukebox, { isJukeboxWeekend, useJukebox, type SongWish } from '../Jukebox'
import type { Phase } from '../lib/engine'
import type { RadioTrack } from '../lib/radio'

export interface MediaPageProps {
  schoolId?: string
  day: string
  phase: Phase
  secs: number
  breakKey: string
  videoBreakKey: string
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
  phase,
  secs,
  breakKey,
  videoBreakKey,
  breakMusicEnabled,
  sound,
  userMuted,
  christmas,
  extraRadioTracks,
  sandboxDemo,
}: MediaPageProps) {
  const { songs: jbWishes, finishSong } = useJukebox(schoolId, day, false)
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
  const showPlayer = !weekend && (phase === 'break' || (phase === 'before' && secs >= 7 * 3600 + 45 * 60) || (phase === 'after' && secs < 15 * 3600)) && breakMusicEnabled

  return (
    <div className="page-grid page-media">
      <div className="dash-col">
        {showPlayer ? (
          <BreakVideo
            wishes={effectiveWishes}
            breakKey={videoBreakKey}
            day={day}
            christmas={christmas}
            soundOn={sound}
            userMuted={userMuted}
            extraRadioTracks={extraRadioTracks}
            onFinished={finishSong}
          />
        ) : (
          <section className="panel page-hint-card">
            <div className="tag" style={{ marginBottom: 6 }}>
              {weekend ? '🛌 Hétvégi szünet' : '🎧 Szüneti Zenelejátszó & SuliRádió'}
            </div>
            <p className="meta" style={{ margin: 0 }}>
              {weekend
                ? 'Hétvégén a szüneti zenebeküldés és zenelejátszás szünetel. Hétfőn újra indul!'
                : 'A zenelejátszó reggel 07:45-től, a szünetekben és tanítás után 15:00-ig automatikusan működik! Ha beküldesz egy YouTube-linket, az szól elsőként érkezési sorrendben — ha pedig nincs beküldött szám, automatikusan a SuliRádió gondoskodik a zenéről.'}
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
        />
      </div>
    </div>
  )
})

export default MediaPage
