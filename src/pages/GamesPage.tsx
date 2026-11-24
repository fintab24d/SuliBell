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
            <RestMode tv={false} schoolId={schoolId} reason={reason} day={day} ev={restEv} sound={sound} />
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
              <div className="tag" style={{ marginBottom: 6 }}>🐍 Játékok, Toplista &amp; Bajnokság</div>
              <p className="meta" style={{ margin: 0 }}>
                A Neon Snake már minden nap elérhető a Mini-Arénában külön napi toplistával! Hétvégén, ünnepnapokon és szünetekben az ünnepi minijáték is itt jelenik meg, a heti és havi legtöbb napi győzelmet szerző bajnokok pedig exkluzív jutalmakat kapnak.
              </p>
            </section>
          </div>
        </>
      )}
    </div>
  )
})

export default GamesPage
