import { api } from '../api'
import { eat } from '../lib/data'
import { usePoll } from '../lib/hooks'
import { ZONE_LABEL } from '../lib/i18n'
import { AutoPanel } from './House'
import { ErrorNote, Icon, initials, LevelBadge, SourceBadge } from './ui'

const TONE = { ok: 'var(--good)', watch: 'var(--warning)', warn: 'var(--serious)', danger: 'var(--critical)' }
const KIND = {
  ammonia: 'Ammonia', cold: 'Too cold', heat: 'Too hot', sensor_fault: 'Sensor fault',
  wet_litter: 'Wet litter', heater_failure: 'Heater failure', ventilation: 'Ventilation',
}

function reasonText(r) {
  const z = ZONE_LABEL.en[r.node] || r.node
  if (r.kind === 'ammonia') return `${r.value} ppm`
  if (r.kind === 'cold' || r.kind === 'heat') return `${r.value}°C${z ? ` at ${z}` : ''}`
  return z ? `at ${z}` : ''
}

export default function Danger() {
  const d = usePoll(() => api.dangerBoard(), [], 15000)
  const b = d.data
  const houses = b?.houses || []
  const bad = houses.filter((h) => h.level === 'danger' || h.level === 'warn')
  const calm = houses.filter((h) => !(h.level === 'danger' || h.level === 'warn'))
  const feed = houses.flatMap((h) => h.alerts_24h.map((a) => ({ ...a, house: h.name, device_id: h.device_id }))).sort((x, y) => y.ts - x.ts).slice(0, 12)

  return (
    <div className="page">
      <section className="hero rise">
        <div>
          <p className="eyebrow">AI model 2 · inside the house, right now</p>
          <h1 className="display">Danger alarm</h1>
          <p className="muted">Checks every reading the moment it arrives: ammonia limits, cold or heat for the age of the birds, and broken sensors. In danger the sensor box acts by itself and the farmer gets an SMS and a phone call.</p>
        </div>
      </section>
      <ErrorNote error={d.error} />

      <section className="grid-kpi">
        <Kpi label="In danger now" value={b?.counts.danger} tone={b?.counts.danger ? 'danger' : ''} sub="SMS + phone call" />
        <Kpi label="Warnings now" value={b?.counts.warn} tone={b?.counts.warn ? 'warn' : ''} sub="SMS to the farmer" />
        <Kpi label="Box acting by itself" value={b?.counts.acting} sub="fan, heater or curtains switched" />
        <Kpi label="Alerts · last 24 h" value={b?.counts.alerts_24h} sub={b ? `${b.counts.calls_24h} phone calls` : ''} />
      </section>

      <section className="stack">
        <div className="section-head"><h2>Houses with a problem now</h2></div>
        {!b ? <div className="skeleton tall" /> : bad.length === 0 ? (
          <div className="card calm-box rise"><span className="calm-ic">✓</span><div><b>No danger anywhere</b><p className="muted small">Every house is within safe limits.</p></div></div>
        ) : (
          <div className="danger-grid">
            {bad.map((h, i) => (
              <a key={h.device_id} href={`#/house/${encodeURIComponent(h.device_id)}`} className={`card danger-card lvl-${h.level} rise`} style={{ animationDelay: `${i * 60}ms` }}>
                <div className="dc-top">
                  <span className="mini-avatar">{initials(h.farmer || h.name)}</span>
                  <div className="grow"><b>{h.farmer || h.name}</b><span className="muted small">{h.name}{h.county ? ` · ${h.county}` : ''}</span></div>
                  <LevelBadge level={h.level} />
                </div>
                <div className="reasons">
                  {(h.detection?.reasons || []).map((r, k) => (
                    <span key={k} className={`reason tone-${r.level}`}><b>{KIND[r.kind] || r.kind}</b> {reasonText(r)}</span>
                  ))}
                  {!(h.detection?.reasons || []).length && <span className="reason tone-watch"><b>Expected soon</b> from the forecast</span>}
                </div>
                {h.auto && <AutoPanel auto={h.auto} esc={h.escalation} house={h} compact />}
                <div className="dc-foot"><SourceBadge source={h.source} sandbox={h.sandbox} /><span className="link small grow" style={{ textAlign: 'right' }}>Open house →</span></div>
              </a>
            ))}
          </div>
        )}
      </section>

      <section className="grid-main">
        <div className="card rise">
          <div className="card-head"><h3>Danger and warning alerts · last 24 h</h3></div>
          {!b ? <div className="skeleton" /> : feed.length === 0 ? <p className="muted">No alerts in the last 24 hours.</p> : (
            <ul className="feed">
              {feed.map((a, i) => (
                <li key={i}>
                  <span className="dot" style={{ background: TONE[a.level] }} />
                  <div><a className="link" href={`#/house/${encodeURIComponent(a.device_id)}`}><b>{a.house}</b></a><p>{a.message}</p></div>
                  <time>{eat(a.ts, { hour: '2-digit', minute: '2-digit' })}{a.delivered === 0 ? ' · not sent' : ''}</time>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card rise">
          <div className="card-head"><h3>Safe houses</h3><span className="muted small">{calm.length}</span></div>
          <div className="safe-list">
            {calm.map((h) => (
              <a key={h.device_id} href={`#/house/${encodeURIComponent(h.device_id)}`}>
                <span className="dot" style={{ background: TONE[h.level] || 'var(--ink-3)' }} />
                <span className="grow">{h.name}</span>
                <span className="readings">
                  {h.now_max_nh3 != null && <span style={{ color: 'var(--c-nh3)' }}>{h.now_max_nh3.toFixed(0)} ppm</span>}
                  {h.now_temp != null && <span style={{ color: 'var(--c-temp)' }}>{h.now_temp.toFixed(1)}°</span>}
                </span>
              </a>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

function Kpi({ label, value, sub, tone }) {
  return (
    <div className={`card kpi ${tone || ''} rise`}>
      <span className="k-label">{label}</span>
      <span className="k-value">{value ?? '—'}</span>
      <span className="k-sub">{sub}</span>
    </div>
  )
}
