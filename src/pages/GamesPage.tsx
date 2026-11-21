import { memo } from 'react'
import Arena from '../Arena'
import { PollCard, usePoll } from '../Poll'
import RestMode from '../Rest'
import type { Phase } from '../lib/engine'

export interface GamesPageProps {
  schoolId?: string
  day: string
  phase: Phase
  reason?: string
  breakKey?: string
  breakTotalSec?: number
  sound: boolean
  restEnabled: boolean
  restEv?: { icon: string; days: number; hours: number; mins: number; note: string }
}

const GamesPage = memo(function GamesPage({
  schoolId,
  day,
  phase,
  reason,
  breakKey,
  breakTotalSec,
  sound,
  restEnabled,
  restEv,
}: GamesPageProps) {
  const { poll, counts: pollCounts } = usePoll(schoolId)
  const showRest = phase === 'closed' && restEnabled

  return (
    <div className="page-grid page-games">
      {showRest ? (
        <>
          <div className="dash-col">
            <RestMode tv={false} reason={reason} day={day} ev={restEv} />
            {poll && <PollCard poll={poll} counts={pollCounts} tv={false} />}
          </div>
          <div className="dash-col">
            <Arena
              schoolId={schoolId}
              day={day}
              phase={phase}
              breakKey={breakKey}
              breakTotalSec={breakTotalSec}
              sound={sound}
            />
          </div>
        </>
      ) : (
        <>
          <div className="dash-col">
            <Arena
              schoolId={schoolId}
              day={day}
              phase={phase}
              breakKey={breakKey}
              breakTotalSec={breakTotalSec}
              sound={sound}
            />
          </div>
          <div className="dash-col">
            {poll && <PollCard poll={poll} counts={pollCounts} tv={false} />}
            <section className="panel page-hint-card">
              <div className="tag" style={{ marginBottom: 6 }}>🐍 Pihenő mód (Snake &amp; Ünnepi játékok)</div>
              <p className="meta" style={{ margin: 0 }}>
                Hétvégén, ünnepnapokon és iskolai szünetekben itt a Mini-Aréna mellett automatikusan megjelenik a Snake és a szezonális ünnepi minijáték is!
              </p>
            </section>
          </div>
        </>
      )}
    </div>
  )
})

export default GamesPage
