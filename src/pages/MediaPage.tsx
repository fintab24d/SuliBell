import { memo } from 'react'
import BreakVideo from '../BreakVideo'
import Jukebox, { isJukeboxWeekend, useJukebox, type SongWish } from '../Jukebox'
import type { Phase } from '../lib/engine'

export interface MediaPageProps {
  schoolId?: string
  day: string
  phase: Phase
  breakKey: string
  videoBreakKey: string
  breakMusicEnabled: boolean
  sound: boolean
  userMuted: boolean
  christmas: boolean
  sandboxDemo?: { forceBreakMedia: boolean }
}

const MediaPage = memo(function MediaPage({
  schoolId,
  day,
  phase,
  breakKey,
  videoBreakKey,
  breakMusicEnabled,
  sound,
  userMuted,
  christmas,
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
  const hasAnyWish = effectiveWishes.some(w => !!w.ytId)
  const showPlayer = !weekend && phase === 'break' && breakMusicEnabled && hasAnyWish

  return (
    <div className="page-grid page-media">
      <div className="dash-col">
        {showPlayer ? (
          <BreakVideo
            wishes={effectiveWishes}
            breakKey={videoBreakKey}
            soundOn={sound}
            userMuted={userMuted}
            onFinished={finishSong}
          />
        ) : (
          <section className="panel page-hint-card">
            <div className="tag" style={{ marginBottom: 6 }}>
              {weekend ? '🛌 Hétvégi szünet' : '🎧 Szüneti Zenelejátszó'}
            </div>
            <p className="meta" style={{ margin: 0 }}>
              {weekend
                ? 'Hétvégén a szüneti zenebeküldés és zenelejátszás szünetel. Hétfőn újra indul!'
                : phase === 'break'
                  ? 'Még nincs elegendő szavazattal rendelkező mai zenekérés — küldj be egyet jobbra (vagy lent), és már indul is!'
                  : 'A szüneti zenelejátszó automatikusan elindul, amint kicsengetnek szünetre. Addig is küldd be a kedvenc számodat vagy szavazz a listán!'}
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
