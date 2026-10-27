import { api } from '../api'
import { Sparkline } from '../charts/Live'
import { eat } from '../lib/data'
import { useCountUp, usePoll } from '../lib/hooks'
import { ErrorNote, Icon, LevelBadge, SourceBadge } from './ui'

const TONE = { ok: 'var(--good)', watch: 'var(--warning)', warn: 'var(--serious)', danger: 'var(--critical)' }
const LEVEL_WORD = { ok: 'Safe', watch: 'Watch', warn: 'Warning', danger: 'Danger' }

function greeting() {
  const h = Number(new Date().toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: 'Africa/Nairobi' }))
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

export default function Overview({ user }) {
  const ov = usePoll(() => api.overview(), [], 30000)
  const hs = usePoll(() => api.houses(), [], 60000)
  const o = ov.data
  const houses = hs.data || []
  const sent = (o?.messages_24h || []).filter((m) => ['sent', 'dry_run', 'sandbox'].includes(m.status))
  const sms = sent.filter((m) => m.channel === 'sms').reduce((a, m) => a + m.n, 0)
  const calls = sent.filter((m) => m.channel === 'voice').reduce((a, m) => a + m.n, 0)
  const lv = o?.houses.levels || {}
  const total = o?.houses.total || 0
  const safe = (lv.ok || 0) + (lv.watch || 0)

  return (
    <div className="page">
      <section className="hero rise">
        <div>
          <p className="eyebrow">{eat(Date.now() / 1000, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <h1 className="display">{greeting()}, {user.name.split(' ')[0]}</h1>
          <p className="muted">
            {!o ? 'Loading your farmers…'
              : o.attention.length ? <><b className="hl-bad">{o.attention.length} house{o.attention.length > 1 ? 's' : ''}</b> need attention right now. The farmers have been told by SMS{calls ? ' and a phone call' : ''}.</>
                : <>All <b>{total}</b> houses are safe. Nothing needs you right now.</>}
          </p>
        </div>
        <a className="btn primary" href="#/farmers?add=1"><Icon name="plus" />Add farmer</a>
      </section>
      <ErrorNote error={ov.error} />

      <section className="grid-kpi">
        <Kpi icon="farmers" label="Farmers" value={o?.farmers.total} sub={o ? `${o.farmers.new_7d} new this week` : ''} delay={0} />
        <Kpi icon="house" label="Houses safe" value={o ? safe : null} sub={o ? `of ${total} houses` : ''} delay={60} ring={total ? safe / total : null} />
        <Kpi icon="bell" label="Need attention" value={o ? o.attention.length : null} tone={o?.attention.length ? (lv.danger ? 'danger' : 'warn') : null} sub={o ? `${lv.danger || 0} danger · ${lv.warn || 0} warning` : ''} delay={120} />
        <Kpi icon="sms" label="Messages today" value={o ? sms + calls : null} sub={o ? `${sms} SMS · ${calls} call${calls === 1 ? '' : 's'}` : ''} delay={180} />
      </section>

      <section className="grid-main">
        <div className="card rise">
          <div className="card-head"><h3>Needs attention now</h3><span className="muted small">worst first</span></div>
          {!o ? <div className="skeleton" /> : o.attention.length === 0 ? (
            <div className="calm-box"><span className="calm-ic">✓</span><div><b>Every house is fine</b><p className="muted small">When ammonia, cold or heat become a problem the house appears here and the farmer gets an SMS.</p></div></div>
          ) : (
            <div className="attn">
              {o.attention.map((h, i) => (
                <a key={h.device_id} href={`#/house/${encodeURIComponent(h.device_id)}`} style={{ animationDelay: `${i * 50}ms` }} className="rise">
                  <span className="lvl-bar" style={{ background: TONE[h.level] }} />
                  <div className="who">
                    <span className="mini-avatar">{(h.farmer || h.name).split(' ').map((w) => w[0]).slice(0, 2).join('')}</span>
                    <div><b>{h.farmer || h.name}</b><span>{h.name}</span></div>
                  </div>
                  <div className="readings">
                    {h.now_max_nh3 != null && <span style={{ color: 'var(--c-nh3)' }}>{h.now_max_nh3.toFixed(0)} ppm</span>}
                    {h.now_temp != null && <span style={{ color: 'var(--c-temp)' }}>{h.now_temp.toFixed(1)}°</span>}
                    {h.now_rh != null && <span style={{ color: 'var(--c-rh)' }}>{h.now_rh.toFixed(0)}%</span>}
                    <LevelBadge level={h.level} />
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
        <div className="card rise" style={{ animationDelay: '80ms' }}>
          <div className="card-head"><h3>House status</h3></div>
          <Donut levels={lv} total={total} />
          <div className="legend-rows">
            {['ok', 'watch', 'warn', 'danger'].map((k) => (
              <div key={k}><i className="sw" style={{ background: TONE[k] }} />{LEVEL_WORD[k]}<b>{lv[k] || 0}</b></div>
            ))}
            <div className="sep" />
            <div><i className="sw" style={{ background: 'var(--brand)' }} />Sensor live<b>{o?.houses.live ?? 0}</b></div>
            <div><i className="sw" style={{ background: 'var(--ink-3)' }} />Simulated<b>{o?.houses.synthetic ?? 0}</b></div>
          </div>
        </div>
      </section>

      <section className="card rise">
        <div className="card-head"><h3>All houses</h3><a href="#/farmers" className="link small">See farmers →</a></div>
        {!hs.data ? <div className="skeleton" /> : houses.length === 0 ? (
          <div className="empty-state"><h3>No farmers yet</h3><p className="muted">Add the first farmer when their sensor box is sold.</p><a className="btn primary" href="#/farmers?add=1"><Icon name="plus" />Add farmer</a></div>
        ) : (
          <div className="tiles">
            {houses.map((h, i) => (
              <a key={h.device_id} href={`#/house/${encodeURIComponent(h.device_id)}`} className={`tile lvl-${h.level || 'none'} rise`} style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }}>
                <div className="tile-top"><b>{h.name}</b><LevelBadge level={h.level} status={h.status} /></div>
                <div className="tile-vals">
                  <span className="tv nh3"><small>Ammonia</small>{h.now_max_nh3 != null ? h.now_max_nh3.toFixed(0) : '—'}<em>ppm</em></span>
                  <span className="tv temp"><small>Temp</small>{h.now_temp != null ? h.now_temp.toFixed(1) : '—'}<em>°C</em></span>
                  <span className="tv rh"><small>Humidity</small>{h.now_rh != null ? h.now_rh.toFixed(0) : '—'}<em>%</em></span>
                </div>
                <Sparkline data={h.spark || []} width={260} height={34} k={h.has_nh3 === false ? 'temp' : 'nh3'} color={h.has_nh3 === false ? 'var(--c-temp)' : 'var(--c-nh3)'} />
                <div className="tile-foot"><SourceBadge source={h.source} sandbox={h.sandbox} />{h.county && <span className="muted small">{h.county}</span>}</div>
              </a>
            ))}
          </div>
        )}
      </section>

      <section className="grid-2">
        <div className="card rise">
          <div className="card-head"><h3>Latest alerts</h3><span className="muted small">last 2 days</span></div>
          {!o ? <div className="skeleton" /> : o.recent_alerts.length === 0 ? <p className="muted">No alerts.</p> : (
            <ul className="feed">
              {o.recent_alerts.map((r, i) => (
                <li key={i}>
                  <span className="dot" style={{ background: TONE[r.level] || 'var(--ink-3)' }} />
                  <div><a className="link" href={r.farmer_id ? `#/farmers/${r.farmer_id}` : `#/house/${r.device_id}`}><b>{r.house}</b></a><p>{r.message}</p></div>
                  <time>{eat(r.ts, { hour: '2-digit', minute: '2-digit' })}</time>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card rise" style={{ animationDelay: '80ms' }}>
          <div className="card-head"><h3>Farmers by county</h3></div>
          <CountyBars counties={o?.counties || {}} />
        </div>
      </section>
    </div>
  )
}

function Kpi({ icon, label, value, sub, tone, delay, ring }) {
  const v = useCountUp(value ?? 0)
  return (
    <div className={`card kpi ${tone || ''} rise`} style={{ animationDelay: `${delay}ms` }}>
      <span className="k-label"><Icon name={icon} />{label}</span>
      <span className="k-value">{value == null ? '—' : Math.round(v)}</span>
      <span className="k-sub">{sub}</span>
      {ring != null && (
        <svg className="k-ring" viewBox="0 0 36 36" aria-hidden="true">
          <circle cx="18" cy="18" r="15" className="kr-track" />
          <circle cx="18" cy="18" r="15" className="kr-fill" style={{ strokeDasharray: `${ring * 94.2} 94.2` }} />
        </svg>
      )}
    </div>
  )
}

function Donut({ levels, total }) {
  const keys = ['ok', 'watch', 'warn', 'danger']
  const C = 2 * Math.PI * 52
  let acc = 0
  return (
    <div className="donut">
      <svg viewBox="0 0 140 140" role="img" aria-label="Houses by status">
        <circle cx="70" cy="70" r="52" className="donut-track" />
        {total > 0 && keys.map((k, i) => {
          const len = ((levels[k] || 0) / total) * C
          const el = <circle key={k} cx="70" cy="70" r="52" className="donut-seg" style={{ stroke: TONE[k], strokeDasharray: `${Math.max(0, len - 2)} ${C}`, strokeDashoffset: -acc, animationDelay: `${i * 120}ms` }} />
          acc += len
          return el
        })}
      </svg>
      <div className="donut-c"><b>{total}</b><span>houses</span></div>
    </div>
  )
}

function CountyBars({ counties }) {
  const rows = Object.entries(counties).sort((a, b) => b[1] - a[1]).slice(0, 8)
  if (!rows.length) return <p className="muted">No farmers yet.</p>
  const max = rows[0][1]
  return (
    <div className="bars">
      {rows.map(([c, n], i) => (
        <div key={c}><span>{c}</span><span className="track"><span className="fill" style={{ width: `${(n / max) * 100}%`, animationDelay: `${i * 70}ms` }} /></span><b>{n}</b></div>
      ))}
    </div>
  )
}
