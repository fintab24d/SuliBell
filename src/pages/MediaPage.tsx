import { memo } from 'react'
import BreakVideo, { useVideos } from '../BreakVideo'
import Jukebox, { isJukeboxWeekend, mediaModeForDay, useJukebox, type SongWish } from '../Jukebox'
import type { Phase } from '../lib/engine'

export interface MediaPageProps {
  schoolId?: string
  day: string
  phase: Phase
  breakKey: string
  videoBreakKey: string
  breakVideosEnabled: boolean
  sound: boolean
  userMuted: boolean
  christmas: boolean
  sandboxDemo?: { forceBreakMedia: boolean; breakMediaKind: 'music' | 'video' }
}

const MediaPage = memo(function MediaPage({
  schoolId,
  day,
  phase,
  breakKey,
  videoBreakKey,
  breakVideosEnabled,
  sound,
  userMuted,
  christmas,
  sandboxDemo,
}: MediaPageProps) {
  const videos = useVideos(schoolId)
  const { songs: jbWishes, finishSong } = useJukebox(schoolId, day, false)
  const effectiveWishes: SongWish[] =
    sandboxDemo?.forceBreakMedia
      ? [
          {
            id: 'sb-demo',
            day,
            kind: sandboxDemo.breakMediaKind,
            title:
              sandboxDemo.breakMediaKind === 'music'
                ? 'Cartoon – On & On (Szüneti Zene Mix)'
                : 'Teszt szüneti videó (4K természetfilm)',
            by: 'Admin Tesztlabor',
            ytId: sandboxDemo.breakMediaKind === 'music' ? 'K4DyBUG242c' : 'LXb3EKWsInQ',
            votes: 99,
            at: Date.now(),
          },
          ...jbWishes,
        ]
      : jbWishes

  const weekend = isJukeboxWeekend(day)
  const hasAnyWish = effectiveWishes.some(w => w.ytId || w.mp4Url)
  const showPlayer = !weekend && phase === 'break' && breakVideosEnabled && (hasAnyWish || videos.length > 0)
  const isVideoDay = mediaModeForDay(day) === 'video'

  return (
    <div className="page-grid page-media">
      <div className="dash-col">
        {showPlayer ? (
          <BreakVideo
            list={videos}
            wishes={effectiveWishes}
            day={day}
            breakKey={videoBreakKey}
            soundOn={sound}
            userMuted={userMuted}
            onFinished={finishSong}
          />
        ) : (
          <section className="panel page-hint-card">
            <div className="tag" style={{ marginBottom: 6 }}>
              {weekend ? '🛌 Hétvégi szünet' : isVideoDay ? '🎬 Szüneti Videólejátszó' : '🎧 Szüneti Zenelejátszó'}
            </div>
            <p className="meta" style={{ margin: 0 }}>
              {weekend
                ? 'Hétvégén a szüneti zene- és videólejátszás, illetve a beküldés szünetel. Hétfőn újra indul!'
                : phase === 'break'
                  ? 'Még nincs elegendő szavazattal rendelkező mai beküldés — küldj be egyet jobbra (vagy lent), és már indul is!'
                  : 'A szüneti lejátszó automatikusan elindul, amint kicsengetnek szünetre. Addig is küldd be a kedvencedet vagy szavazz a listán!'}
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
