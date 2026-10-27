import { api } from '../api'
import { usePoll } from '../lib/hooks'
import { ErrorNote, Icon, initials, LevelBadge } from './ui'

const WHY = { ammonia: 'ammonia will pass 20 ppm', cold: 'it will get too cold', heat: 'it will get too hot', stable: 'stable' }

export default function Prediction() {
  const d = usePoll(() => api.predictionBoard(), [], 30000)
  const b = d.data
  const houses = b?.houses || []
  const soon = houses.filter((h) => h.next_check?.in_hours != null)
  const met = b?.metrics

  return (
    <div className="page">
      <section className="hero rise">
        <div>
          <p className="eyebrow">AI model 3 · the next six hours</p>
          <h1 className="display">Prediction</h1>
          <p className="muted">Forecasts ammonia and temperature six hours ahead for every house, compares “if nothing changes” with “if the farmer follows the advice”, and tells the farmer what time to go and check.</p>
        </div>
      </section>
      <ErrorNote error={d.error} />

      <section className="grid-kpi">
        <div className="card kpi rise"><span className="k-label">Looks ahead</span><span className="k-value">6 h</span><span className="k-sub">updated every 10 minutes</span></div>
        <div className="card kpi rise" style={{ animationDelay: '60ms' }}><span className="k-label">Check-ins coming up</span><span className="k-value">{b ? soon.length : '—'}</span><span className="k-sub">farmers told the time by SMS</span></div>
        <div className="card kpi rise" style={{ animationDelay: '120ms' }}><span className="k-label">Accuracy, 1 hour ahead</span><span className="k-value">{met?.mae_1h_ppm != null ? `±${met.mae_1h_ppm.toFixed(1)}` : '—'}</span><span className="k-sub">ppm ammonia, on test houses</span></div>
        <div className="card kpi rise" style={{ animationDelay: '180ms' }}><span className="k-label">Accuracy, 6 hours ahead</span><span className="k-value">{met?.mae_6h_ppm != null ? `±${met.mae_6h_ppm.toFixed(1)}` : '—'}</span><span className="k-sub">ppm ammonia, on test houses</span></div>
      </section>

      <div className="section-head"><h2>Every house, the next six hours</h2></div>
      {!b ? <div className="skeleton tall" /> : (
        <div className="pred-grid">
          {houses.map((h, i) => <PredCard key={h.device_id} h={h} delay={Math.min(i, 10) * 50} />)}
        </div>
      )}
      <p className="caption">Accuracy is measured on simulated test houses; a field pilot will measure it on real farms.</p>
    </div>
  )
}

function PredCard({ h, delay }) {
  const nc = h.next_check
  const warming = h.status === 'warming_up' || !h.hours
  const [lo, hi] = h.comfort || [18, 24]
  return (
    <a href={`#/house/${encodeURIComponent(h.device_id)}`} className={`card pred-card rise`} style={{ animationDelay: `${delay}ms` }}>
      <div className="dc-top">
        <span className="mini-avatar">{initials(h.farmer || h.name)}</span>
        <div className="grow"><b>{h.farmer || h.name}</b><span className="muted small">{h.name}</span></div>
        <LevelBadge level={h.level} status={h.status} />
      </div>
      {warming ? <p className="muted small">Still learning this house: predictions start after 3 hours of readings.</p> : (
        <>
          <div className={`pc-check ${nc?.in_hours != null ? 'due' : 'calm'}`}>
            {nc?.in_hours != null ? (
              <><span className="pc-time">{nc.local}</span><span><b>Check the house</b><small>{WHY[nc.reason] || nc.reason} · in {nc.in_hours < 1 ? `${Math.round(nc.in_hours * 60)} min` : `${nc.in_hours.toFixed(1)} h`}</small></span></>
            ) : <><Icon name="shield" style={{ width: 22 }} /><span><b>No visit needed</b><small>for the next 6 hours</small></span></>}
          </div>
          {h.has_nh3 !== false && h.nh3_curve && <MiniForecast h={h} />}
          <div className="pc-stats">
            {h.has_nh3 !== false && <span><small>Ammonia peak</small><b style={{ color: (h.peak_nh3 ?? 0) >= 20 ? 'var(--serious)' : 'var(--ink)' }}>{h.peak_nh3?.toFixed(1) ?? '—'}</b><em>ppm if nothing changes</em></span>}
            {h.has_nh3 !== false && <span><small>With advice</small><b style={{ color: 'var(--good)' }}>{h.plan_peak_nh3?.toFixed(1) ?? '—'}</b><em>ppm</em></span>}
            <span><small>Coldest</small><b style={{ color: h.min_temp != null && h.min_temp < lo - 3 ? 'var(--c-temp)' : 'var(--ink)' }}>{h.min_temp?.toFixed(1) ?? '—'}°</b><em>birds need {lo}-{hi}°</em></span>
          </div>
        </>
      )}
    </a>
  )
}

function MiniForecast({ h }) {
  const W = 320, H = 70, P = 4
  const all = [...h.nh3_curve, ...(h.plan_curve || []), 25]
  const max = Math.max(...all) * 1.08
  const x = (i, n) => P + (i / (n - 1)) * (W - 2 * P)
  const y = (v) => H - P - (v / max) * (H - 2 * P)
  const path = (arr) => arr.map((v, i) => `${i ? 'L' : 'M'}${x(i, arr.length).toFixed(1)},${y(v).toFixed(1)}`).join('')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="mini-fc" role="img" aria-label="Ammonia forecast for the next 6 hours">
      <line x1={0} x2={W} y1={y(20)} y2={y(20)} className="mf-warn" />
      <path d={path(h.nh3_curve)} className="mf-sq draw" pathLength={1} />
      {h.plan_curve && <path d={path(h.plan_curve)} className="mf-plan draw" pathLength={1} />}
    </svg>
  )
}
