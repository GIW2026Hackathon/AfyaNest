import { mean } from 'd3-array'
import { useMemo, useState } from 'react'
import { api } from '../api'
import { ComfortMap, Diurnal, Exposure, Heatmap } from '../charts/Analysis'
import { FloorMap, ForecastChart, ProjectionChart, RingGauge, TempForecast } from '../charts/Live'
import TimeSeries from '../charts/TimeSeries'
import { byTime, diurnal, eat, exposure, fmtAgo, houseSeries, NH3, stats, zoneSeries } from '../lib/data'
import { usePoll } from '../lib/hooks'
import { useT, ZONE_LABEL } from '../lib/i18n'
import { ErrorNote, Field, Icon, LevelBadge, Modal, SecretOnce, SourceBadge, Spinner } from './ui'

const RANGES = [{ h: 6, l: '6 hours' }, { h: 24, l: '1 day' }, { h: 72, l: '3 days' }, { h: 168, l: '7 days' }]
const ZONE_COLORS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)']
const RH_COMFORT = [50, 70]

/* ---------------------------------------------------------------- what each number means */
export function nh3State(v) {
  if (v == null) return { tone: 'none', text: 'No ammonia sensor' }
  if (v < NH3.target) return { tone: 'good', text: 'Clean air' }
  if (v < NH3.warn) return { tone: 'watch', text: 'Rising - keep an eye' }
  if (v < NH3.danger) return { tone: 'warn', text: 'High - open curtains' }
  return { tone: 'danger', text: 'Dangerous - ventilate now' }
}
export function tempState(v, [lo, hi]) {
  if (v == null) return { tone: 'none', text: 'No data' }
  if (v < lo - 6) return { tone: 'danger', text: 'Far too cold' }
  if (v < lo - 3) return { tone: 'warn', text: 'Too cold for the birds' }
  if (v < lo) return { tone: 'watch', text: 'A little cool' }
  if (v <= hi) return { tone: 'good', text: 'Comfortable' }
  if (v <= hi + 3) return { tone: 'watch', text: 'A little warm' }
  if (v <= hi + 6) return { tone: 'warn', text: 'Too hot' }
  return { tone: 'danger', text: 'Heat stress' }
}
export function rhState(v) {
  if (v == null) return { tone: 'none', text: 'No data' }
  if (v < 40) return { tone: 'warn', text: 'Too dry - dusty air' }
  if (v < 50) return { tone: 'watch', text: 'Dry' }
  if (v <= 70) return { tone: 'good', text: 'Ideal' }
  if (v <= 80) return { tone: 'watch', text: 'Humid' }
  return { tone: 'warn', text: 'Too humid - wet litter' }
}
export const NH3_BANDS = [{ from: 0, to: 15, tone: 'good' }, { from: 15, to: 20, tone: 'watch' }, { from: 20, to: 25, tone: 'warn' }, { from: 25, to: 40, tone: 'danger' }]
export const tempBands = ([lo, hi]) => [
  { from: lo - 12, to: lo - 6, tone: 'danger' }, { from: lo - 6, to: lo - 3, tone: 'warn' }, { from: lo - 3, to: lo, tone: 'watch' },
  { from: lo, to: hi, tone: 'good' }, { from: hi, to: hi + 3, tone: 'watch' }, { from: hi + 3, to: hi + 6, tone: 'warn' }, { from: hi + 6, to: hi + 12, tone: 'danger' }]
export const RH_BANDS = [{ from: 0, to: 40, tone: 'warn' }, { from: 40, to: 50, tone: 'watch' }, { from: 50, to: 70, tone: 'good' }, { from: 70, to: 80, tone: 'watch' }, { from: 80, to: 100, tone: 'warn' }]

/** Humidity outlook: linear trend of the last 3 hours carried 6 hours ahead, damped,
 *  with an uncertainty band that widens with time. */
function rhProjection(series) {
  const pts = series.filter((s) => s.rh != null).slice(-18)
  if (pts.length < 6) return null
  const t0 = pts[pts.length - 1].ts
  const xs = pts.map((p) => (p.ts - t0) / 3600)
  const ys = pts.map((p) => p.rh)
  const mx = mean(xs); const my = mean(ys)
  const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / (xs.reduce((a, x) => a + (x - mx) ** 2, 0) || 1)
  const resid = Math.sqrt(mean(ys.map((y, i) => (y - (my + slope * (xs[i] - mx))) ** 2)) || 1)
  const s = Math.max(-4, Math.min(4, slope))
  const now = ys[ys.length - 1]
  return {
    now,
    points: Array.from({ length: 18 }, (_, i) => {
      const h = (i + 1) / 3
      const mid = Math.max(15, Math.min(100, now + s * h * 0.7))
      const w = 2 * resid + h * 1.2
      return { h, mid, lo: Math.max(10, mid - w), hi: Math.min(100, mid + w) }
    }),
  }
}

export default function House({ id, user }) {
  const { t, lang } = useT()
  const zl = ZONE_LABEL[lang] || ZONE_LABEL.en
  const [hours, setHours] = useState(24)
  const [mode, setMode] = useState('house')
  const [hover, setHover] = useState(null)
  const [picked, setPicked] = useState(null)
  const [settings, setSettings] = useState(false)
  const det = usePoll(() => api.house(id), [id], 30000)
  const hist = usePoll(() => api.history(id, 168), [id], 60000)

  const h = det.data
  const a = h?.advice
  const raw = hist.data
  const all = useMemo(() => (raw ? byTime(raw.readings) : []), [raw])
  const rows = useMemo(() => {
    if (!all.length) return []
    const cut = all[all.length - 1].ts - hours * 3600
    return all.filter((r) => r.ts > cut)
  }, [all, hours])
  const series = useMemo(() => houseSeries(rows), [rows])
  const allSeries = useMemo(() => houseSeries(all), [all])
  const last24 = useMemo(() => houseSeries(all.filter((r) => r.ts > (all.at(-1)?.ts ?? 0) - 86400)), [all])
  const controls = useMemo(() => {
    if (!raw || !rows.length) return []
    return raw.controls.filter((c) => c.ts >= rows[0].ts && c.curtain != null).map((c) => ({ ts: c.ts, v: c.curtain }))
  }, [raw, rows])
  const zData = useMemo(() => {
    const mk = (key) => {
      const z = zoneSeries(rows, key)
      return rows.map((r, k) => Object.fromEntries([['ts', r.ts], ...z.map((s, i) => [`z${i}`, s[k].v])]))
    }
    return { nh3: mk('nh3'), temp: mk('temp'), rh: mk('rh') }
  }, [rows])
  const proj = useMemo(() => rhProjection(allSeries), [allSeries])

  if (det.error?.status === 404) return <div className="page"><a href="#/farmers" className="back">← Farmers</a><div className="empty-state"><h3>This house was not found</h3></div></div>
  if (!h) return <div className="page">{det.error ? <ErrorNote error={det.error} /> : <div className="skeleton tall" />}</div>

  const comfort = h.comfort || [18, 24]
  const zoneNames = raw?.nodes || []
  const latest = rows.length ? rows[rows.length - 1].nodes : []
  const noNh3 = h.has_nh3 === false || a?.has_nh3 === false
  const shown = picked != null ? [picked] : zoneNames.map((_, i) => i)
  const zLines = shown.map((i) => ({ key: `z${i}`, color: ZONE_COLORS[i], label: zl[zoneNames[i]] }))
  const animKey = `${hours}-${mode}-${picked}`
  const canEdit = user.role !== 'viewer'
  const s24 = { nh3: stats(last24, 'nh3'), temp: stats(last24, 'temp'), rh: stats(last24, 'rh') }
  const fcMinTemp = a?.forecast ? Math.min(...a.forecast.status_quo.temp_min) : null

  let action = lang === 'sw' ? a?.action_sw : a?.action_en
  if (a && /^(Keep going|Endelea)/.test(action || '') && a.status_quo_peak_nh3 - a.plan_peak_nh3 > 3) {
    const pct = Math.round((a.plan_curtain?.[0] ?? 0) * 100)
    action = `Keep the curtains ${pct}% open - don't close them tonight`
  }
  const climate = a?.climate || []
  if (noNh3 || (a && !action)) {
    action = climate.length ? (climate[0].kind === 'cold' ? 'Chicks are getting cold - add heat at the brooder' : 'Heat stress - open curtains, give cool water') : 'Conditions are right for the birds'
  }

  return (
    <div className="page">
      <a href={h.farmer_id ? `#/farmers/${h.farmer_id}` : '#/farmers'} className="back">← Back to farmer</a>
      <section className="house-head rise">
        <div>
          <div className="title-row">
            <h1 className="display">{h.name}</h1>
            <LevelBadge level={h.level} status={h.status} big />
            <SourceBadge source={h.source} sandbox={h.sandbox} />
          </div>
          <p className="meta-line">
            <span>Sensor {h.device_id}</span>
            {h.county && <span>{h.county}</span>}
            <span><b>{h.n_birds ? h.n_birds.toLocaleString() : '—'}</b> birds · <b>{Math.floor(h.age_days)}</b> days old</span>
            <span className={`live-dot ${h.online ? 'on' : ''}`}><i />{h.online ? 'Sensor online' : 'Sensor offline'} · {fmtAgo(h.last_seen)}</span>
          </p>
        </div>
        {canEdit && <button className="btn" onClick={() => setSettings(true)}><Icon name="settings" />Edit house</button>}
      </section>

      {/* ---------------- three gauges, one per measure */}
      <section className="grid-3">
        <MeasureCard cls="m-nh3" title="Ammonia" state={nh3State(noNh3 ? null : h.now_max_nh3)} delay={0}
          gauge={<RingGauge label="Ammonia" value={noNh3 ? null : h.now_max_nh3} min={0} max={40} bands={NH3_BANDS} unit="ppm"
            footer={!noNh3 && a?.status_quo_peak_nh3 != null ? `next 6 h: up to ${a.status_quo_peak_nh3.toFixed(0)}` : 'safe below 20'} />}
          s={noNh3 ? null : s24.nh3} />
        <MeasureCard cls="m-temp" title="Temperature" state={tempState(h.now_temp, comfort)} delay={90}
          gauge={<RingGauge label="Temperature" value={h.now_temp} min={comfort[0] - 12} max={comfort[1] + 12} bands={tempBands(comfort)} unit="°C"
            footer={fcMinTemp != null ? `next 6 h: low ${fcMinTemp.toFixed(1)}°` : `birds need ${comfort[0]}-${comfort[1]}°`} />}
          s={s24.temp} />
        <MeasureCard cls="m-rh" title="Humidity" state={rhState(h.now_rh)} delay={180}
          gauge={<RingGauge label="Humidity" value={h.now_rh} min={0} max={100} bands={RH_BANDS} unit="%" digits={0}
            footer={proj ? `next 6 h: about ${proj.points.at(-1).mid.toFixed(0)}%` : 'ideal 50-70%'} />}
          s={s24.rh} digits={0} />
      </section>

      {/* ---------------- advice + map */}
      <section className="grid-main">
        <div className={`card advice lvl-${h.level} rise`}>
          <p className="eyebrow">What the farmer is told</p>
          {a?.status === 'warming_up' && !climate.length ? (
            <>
              <h2 className="advice-action">Still learning this house</h2>
              <p className="advice-why">Predictions start after 3 hours of readings. Danger alerts already work.</p>
            </>
          ) : a ? (
            <>
              <h2 className="advice-action">{action}</h2>
              {!noNh3 && a.hours_to_warn != null && (
                <p className="advice-why">If nothing changes, ammonia reaches <b>{a.status_quo_peak_nh3?.toFixed(0)} ppm</b> in about <b>{a.hours_to_warn.toFixed(1)} hours</b> near the <b>{zl[a.worst_node] || a.worst_node}</b>.</p>
              )}
              {!noNh3 && a.status_quo_peak_nh3 != null && (
                <div className="vs">
                  <div className="vs-side bad"><span>{t.ifNothing}</span><b>{a.status_quo_peak_nh3.toFixed(1)}<small> ppm</small></b><em>{t.peakIn6h}</em></div>
                  <div className="vs-arrow" aria-hidden="true">→</div>
                  <div className="vs-side good"><span>{t.ifFollow}</span><b>{a.plan_peak_nh3?.toFixed(1)}<small> ppm</small></b><em>{t.coldest}: {a.plan_min_temp?.toFixed(1)}°C</em></div>
                </div>
              )}
              {!noNh3 && <PlanStrip curtain={a.plan_curtain} fan={a.plan_fan} t={t} />}
              {climate.map((c, i) => (
                <div key={i} className={`note tone-${c.level}`} style={{ marginTop: 12, position: 'relative', zIndex: 1 }}>
                  <b>{c.kind === 'cold' ? 'Too cold' : 'Too hot'}</b>: {c.temp.toFixed(1)}°C near the {zl[c.node] || c.node} {c.hours_to < 0.25 ? 'now' : `in ${c.hours_to.toFixed(1)} h`}. Birds need {c.comfort[0]}-{c.comfort[1]}°C.
                </div>
              ))}
              <NextCheck check={a.next_check} t={t} />
              <AutoPanel auto={a.auto} esc={h.escalation} house={h} />
              <p className="fineprint" style={{ position: 'relative', zIndex: 1 }}>Updated {fmtAgo(a.ts)}</p>
            </>
          ) : <p className="muted">No readings yet.</p>}
        </div>
        <div className="card rise">
          <div className="card-head"><h3>Inside the house</h3>{picked != null && <button className="chip on" onClick={() => setPicked(null)}>{zl[zoneNames[picked]]} ✕</button>}</div>
          <FloorMap nodes={h.nodes} latest={latest.map((n) => (noNh3 ? n?.temp : n?.nh3) ?? null)} metric={noNh3 ? 'temp' : 'nh3'} comfort={comfort}
            zoneLabel={zl} picked={picked} onPick={(i) => { setPicked(picked === i ? null : i); setMode('zones') }} />
          <p className="caption">{noNh3 ? 'Colour shows temperature now.' : 'Bigger, redder circle = more ammonia.'} Tap a sensor to follow that spot in the charts.</p>
        </div>
      </section>

      {/* ---------------- history + prediction, one section per measure */}
      <section className="toolbar sticky">
        <div className="seg" role="group" aria-label="Period">
          {RANGES.map((r) => <button key={r.h} className={hours === r.h ? 'on' : ''} onClick={() => setHours(r.h)}>{r.l}</button>)}
        </div>
        <div className="seg" role="group" aria-label="Show">
          <button className={mode === 'house' ? 'on' : ''} onClick={() => { setMode('house'); setPicked(null) }}>Whole house</button>
          <button className={mode === 'zones' ? 'on' : ''} onClick={() => setMode('zones')}>Each spot</button>
        </div>
      </section>
      {mode === 'zones' && (
        <div className="zone-legend">
          {zoneNames.map((z, i) => (
            <button key={z} className={`chip ${picked === null || picked === i ? 'on' : 'off'}`} onClick={() => setPicked(picked === i ? null : i)}>
              <i className="sw" style={{ background: ZONE_COLORS[i] }} />{zl[z]}
            </button>
          ))}
        </div>
      )}
      {hist.loading && !raw ? <div className="skeleton tall" /> : (
        <>
          {!noNh3 && (
            <MeasureSection cls="m-nh3" title="Ammonia" s={stats(series, 'nh3')} unit="ppm"
              history={<TimeSeries data={mode === 'house' ? series : zData.nh3}
                lines={mode === 'house' ? [{ key: 'nh3', color: 'var(--c-nh3)', label: 'Ammonia' }] : zLines}
                band={mode === 'house' ? { lo: 'nh3Lo', hi: 'nh3', color: 'var(--c-nh3)' } : null}
                thresholds={[{ y: NH3.warn, label: '20 high', tone: 'warn' }, { y: NH3.danger, label: '25 danger', tone: 'danger' }]}
                lane={controls} laneLabel={t.curtain} unit=" ppm" hoverTs={hover} onHover={setHover} height={260} animateKey={animKey} />}
              historyNote="Line = the worst spot in the house. Strip below = how far the curtains were open."
              prediction={<ForecastChart forecast={a?.forecast} nowValue={h.now_max_nh3} t={t} />}
              predictionTitle="Prediction · next 6 hours"
              predictionNote={<span className="legend"><span><i className="sw" style={{ background: 'var(--critical)' }} />{t.ifNothing}</span><span><i className="sw" style={{ background: 'var(--good)' }} />{t.ifFollow}</span></span>} />
          )}
          <MeasureSection cls="m-temp" title="Temperature" s={stats(series, 'temp')} unit="°C"
            history={<TimeSeries data={mode === 'house' ? series : zData.temp}
              lines={mode === 'house' ? [{ key: 'temp', color: 'var(--c-temp)', label: 'Temperature' }] : zLines}
              band={mode === 'house' ? { lo: 'tempLo', hi: 'tempHi', color: 'var(--c-temp)' } : null}
              comfort={comfort} unit="°C" hoverTs={hover} onHover={setHover} height={260} animateKey={animKey} />}
            historyNote={`Green band = right temperature for ${Math.floor(h.age_days)}-day-old birds. Shading = coldest to warmest spot.`}
            prediction={<TempForecast forecast={a?.forecast} now={h.now_temp} comfort={comfort} t={t} />}
            predictionTitle="Prediction · next 6 hours"
            predictionNote="Shading = coldest to warmest spot if nothing changes." />
          <MeasureSection cls="m-rh" title="Humidity" s={stats(series, 'rh')} unit="%" digits={0}
            history={<TimeSeries data={mode === 'house' ? series : zData.rh}
              lines={mode === 'house' ? [{ key: 'rh', color: 'var(--c-rh)', label: 'Humidity' }] : zLines}
              band={mode === 'house' ? { lo: 'rhLo', hi: 'rhHi', color: 'var(--c-rh)' } : null}
              comfort={RH_COMFORT} yDomain={[20, 100]} unit="%" fmt={(v) => v.toFixed(0)} hoverTs={hover} onHover={setHover} height={260} animateKey={animKey} />}
            historyNote="Ideal 50-70%. Long periods above 75% make the litter wet and raise ammonia."
            prediction={<ProjectionChart points={proj?.points} now={proj?.now} comfort={RH_COMFORT} unit="%" color="var(--c-rh)" label="Humidity" />}
            predictionTitle="Outlook · next 6 hours"
            predictionNote="Based on how humidity moved in the last 3 hours." />
        </>
      )}

      {raw && (
        <details className="card more">
          <summary><b>More charts</b> <span className="muted small">daily pattern, ammonia by spot, time in danger</span></summary>
          <div className="stack" style={{ marginTop: 16 }}>
            {!noNh3 && <div><div className="card-head"><h3>Ammonia by spot and hour</h3></div><Heatmap rows={rows} zoneNames={zoneNames} zoneLabel={zl} hours={hours} /></div>}
            <div className="grid-2">
              <div><div className="card-head"><h3>Typical day · temperature</h3></div><Diurnal profile={diurnal(allSeries, 'temp')} color="var(--c-temp)" unit="°C" comfort={comfort} /></div>
              {noNh3
                ? <div><div className="card-head"><h3>Typical day · humidity</h3></div><Diurnal profile={diurnal(allSeries, 'rh')} color="var(--c-rh)" unit="%" comfort={RH_COMFORT} /></div>
                : <div><div className="card-head"><h3>Typical day · ammonia</h3></div><Diurnal profile={diurnal(allSeries, 'nh3')} color="var(--c-nh3)" unit=" ppm" thresholds={[{ y: NH3.warn, tone: 'warn' }, { y: NH3.danger, tone: 'danger' }]} /></div>}
            </div>
            <div className="grid-2">
              <div><div className="card-head"><h3>{t.comfort}</h3></div><ComfortMap series={series} comfort={comfort} /></div>
              {!noNh3 && <div><div className="card-head"><h3>{t.exposure}</h3></div><Exposure data={exposure(rows)} zoneNames={zoneNames} zoneLabel={zl} /></div>}
            </div>
            <ZoneTable rows={rows} zoneNames={zoneNames} zl={zl} />
          </div>
        </details>
      )}

      {raw && (
        <section className="card rise">
          <div className="card-head"><h3>Alerts for this house</h3><span className="muted small">last 7 days</span></div>
          <AlertList alerts={raw.alerts} />
        </section>
      )}
      {settings && <HouseSettings house={h} user={user} onClose={() => setSettings(false)} onSaved={det.reload} />}
    </div>
  )
}

function MeasureCard({ cls, title, state, gauge, s, digits = 1, delay }) {
  return (
    <div className={`card measure ${cls} rise`} style={{ animationDelay: `${delay}ms` }}>
      <div className="m-head"><h3><i className="sw lg" style={{ background: 'var(--mc)' }} />{title}</h3><span className="now-chip">now</span></div>
      {gauge}
      <div className={`m-state state-${state.tone}`}>{state.text}</div>
      <div className="m-stats">
        <span>lowest today<b>{s ? s.min.toFixed(digits) : '—'}</b></span>
        <span>average<b>{s ? s.mean.toFixed(digits) : '—'}</b></span>
        <span>highest<b>{s ? s.max.toFixed(digits) : '—'}</b></span>
      </div>
    </div>
  )
}

function MeasureSection({ cls, title, s, unit, digits = 1, history, historyNote, prediction, predictionTitle, predictionNote }) {
  return (
    <section className={cls}>
      <div className="mtitle"><span className="bar" /><h2>{title}</h2></div>
      <div className="mrow">
        <div className="card rise">
          <div className="card-head">
            <h3>History</h3>
            {s && <div className="mini-stats"><span>low <b>{s.min.toFixed(digits)}</b></span><span>avg <b>{s.mean.toFixed(digits)}</b></span><span>high <b>{s.max.toFixed(digits)}</b></span><span>{unit}</span></div>}
          </div>
          {history}
          <p className="caption">{historyNote}</p>
        </div>
        <div className="card rise" style={{ animationDelay: '80ms' }}>
          <div className="card-head"><h3>{predictionTitle}</h3></div>
          {prediction}
          <div className="caption">{predictionNote}</div>
        </div>
      </div>
    </section>
  )
}

function PlanStrip({ curtain = [], fan = [], t }) {
  if (!curtain?.length) return null
  return (
    <div className="plan-strip" aria-label="Recommended curtain opening for the next 6 hours">
      {curtain.map((c, i) => (
        <div key={i} className="plan-h">
          <div className="plan-bar"><span style={{ height: `${Math.max(4, c * 100)}%`, animationDelay: `${i * 70}ms` }} /></div>
          <b>{Math.round(c * 100)}%</b>
          <small>{i === 0 ? t.now : `+${i}h`}{fan?.[i] > 0.5 ? ' · fan' : ''}</small>
        </div>
      ))}
      <span className="plan-label">{t.curtain}</span>
    </div>
  )
}

function ZoneTable({ rows, zoneNames, zl }) {
  const data = zoneNames.map((z, i) => {
    const n = rows.map((r) => r.nodes[i]?.nh3).filter((v) => v != null)
    const tt = rows.map((r) => r.nodes[i]?.temp).filter((v) => v != null)
    const hh = rows.map((r) => r.nodes[i]?.rh).filter((v) => v != null)
    return { z, nh3: n.length ? [mean(n), Math.max(...n)] : null, temp: tt.length ? [Math.min(...tt), mean(tt)] : null, rh: hh.length ? mean(hh) : null }
  })
  return (
    <details>
      <summary>Show numbers as a table</summary>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Spot</th><th>Ammonia avg</th><th>Ammonia max</th><th>Temp low</th><th>Temp avg</th><th>Humidity avg</th></tr></thead>
          <tbody>{data.map((d) => <tr key={d.z}><td>{zl[d.z]}</td><td>{d.nh3?.[0].toFixed(1)}</td><td>{d.nh3?.[1].toFixed(1)}</td><td>{d.temp?.[0].toFixed(1)}</td><td>{d.temp?.[1].toFixed(1)}</td><td>{d.rh?.toFixed(0)}</td></tr>)}</tbody>
        </table>
      </div>
    </details>
  )
}

const KIND = { ammonia: 'Ammonia', climate: 'Temperature', offline: 'Sensor offline', fault: 'Sensor fault', report: 'Farmer report', outbreak: 'Disease news' }
export function AlertList({ alerts }) {
  if (!alerts.length) return <p className="muted">No alerts in this period.</p>
  return (
    <ul className="msgs">
      {alerts.slice(0, 40).map((x, i) => (
        <li key={i} className="msg" style={{ animationDelay: `${Math.min(i, 10) * 40}ms` }}>
          <span className={`ic tone-${x.level}`}><Icon name="bell" /></span>
          <div>
            <div className="msg-meta"><LevelBadge level={x.level} /><span>{KIND[x.kind.split(':')[0]] || x.kind.split(':')[0]}</span><time>{eat(x.ts, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</time>
              {x.delivered === 0 && <span className="st st-held">not sent</span>}</div>
            <p className="bubble">{x.message}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}

const AUTO_WHY = { ammonia: 'ammonia is high', cold: 'it is too cold for the chicks', heat: 'it is too hot' }
export function AutoPanel({ auto, esc, house, compact }) {
  if (!auto) return null
  const c = auto.cmd || {}
  const gear = [
    { k: 'fan', label: 'Fan', has: house.has_fan, on: !!c.fan, val: c.fan ? 'ON' : 'off' },
    { k: 'heater', label: 'Heater', has: house.has_heater, on: !!c.heater, val: c.heater ? 'ON' : 'off' },
    { k: 'curtain', label: 'Curtains', has: house.has_curtain, on: c.curtain != null, val: c.curtain != null ? `${c.curtain}% open` : '—' },
    { k: 'alarm', label: 'Alarm', has: true, on: !!c.buzzer, val: c.buzzer ? 'SOUNDING' : 'quiet' },
  ]
  const why = (auto.reasons || []).map((r) => AUTO_WHY[r]).filter(Boolean)
  return (
    <div className={`auto-panel ${compact ? 'compact' : ''}`}>
      <div className="auto-head">
        <span className="auto-dot" /><b>Automatic response</b>
        <span className="muted small">{why.length ? `acting because ${why.join(' and ')}` : 'standing by'}</span>
      </div>
      <div className="auto-gear">
        {gear.map((g) => (
          <span key={g.k} className={`gear ${g.has ? (g.on ? 'on' : '') : 'missing'} ${g.k === 'alarm' && g.on ? 'alarm' : ''}`} title={g.has ? '' : 'Not fitted in this house'}>
            <small>{g.label}</small>{g.has ? g.val : 'not fitted'}
          </span>
        ))}
      </div>
      {esc && esc.open && (
        <p className="auto-esc">Calling the farmer until someone answers: call {esc.calls} of 3{esc.backup ? ' · backup contact told' : ''}.</p>
      )}
      {esc && !esc.open && esc.closed_by === 'farmer' && <p className="auto-esc ok">Farmer answered (SAWA). Calls stopped.</p>}
    </div>
  )
}

function NextCheck({ check, t }) {
  if (!check) return null
  if (!check.local) return <div className="next-check calm">✓ No visit needed in the next 6 hours</div>
  const why = { ammonia: 'ammonia rising', cold: 'getting cold', heat: 'getting hot' }[check.reason] || check.reason
  return (
    <div className="next-check">
      <span className="nc-time">{check.local}</span>
      <span><b>{t.nextCheck}</b><small>{why} · in {check.in_hours < 1 ? `${Math.round(check.in_hours * 60)} min` : `${check.in_hours.toFixed(1)} h`} · told to the farmer by SMS</small></span>
    </div>
  )
}

function HouseSettings({ house, user, onClose, onSaved }) {
  const { t } = useT()
  const [f, setF] = useState({ name: house.name, tech_phone: house.tech_phone || '', has_fan: house.has_fan, has_heater: !!house.has_heater, has_curtain: !!house.has_curtain, n_birds: house.n_birds || '',
    chicks: new Date((house.placement_ts || Date.now() / 1000) * 1000).toISOString().slice(0, 10) })
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [key, setKey] = useState(null)
  const [confirmDel, setConfirmDel] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const save = async (e) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      await api.updateHouse(house.device_id, {
        name: f.name, tech_phone: f.tech_phone || null, has_fan: f.has_fan, has_heater: f.has_heater, has_curtain: f.has_curtain,
        n_birds: f.n_birds ? Number(f.n_birds) : null, placement_ts: Math.floor(new Date(f.chicks + 'T12:00:00+03:00').getTime() / 1000),
      })
      onSaved(); onClose()
    } catch (e2) { setErr(e2) } finally { setBusy(false) }
  }
  const rotate = async () => { try { setKey((await api.rotateKey(house.device_id)).device_key) } catch (e2) { setErr(e2) } }
  const del = async () => { try { await api.deleteHouse(house.device_id); window.location.hash = '/farmers' } catch (e2) { setErr(e2) } }
  return (
    <Modal title={`Edit ${house.name}`} onClose={onClose} wide>
      <form className="form-grid" onSubmit={save}>
        <Field label="House name"><input value={f.name} onChange={set('name')} required maxLength={40} /></Field>
        <Field label="Number of birds"><input type="number" min="1" value={f.n_birds} onChange={set('n_birds')} /></Field>
        <Field label="Day the chicks arrived" hint="Change this when a new flock starts"><input type="date" value={f.chicks} onChange={set('chicks')} /></Field>
        <Field label="Backup contact" hint="Neighbour or technician, called if the farmer does not answer"><input value={f.tech_phone} onChange={set('tech_phone')} pattern="\+\d{9,15}" placeholder="+2547…" /></Field>
        <div className="span2 equip">
          <span className="field-label">What the box can switch by itself</span>
          <label className="check"><input type="checkbox" checked={f.has_fan} onChange={set('has_fan')} /> Fan</label>
          <label className="check"><input type="checkbox" checked={f.has_heater} onChange={set('has_heater')} /> Heater / brooder lamp</label>
          <label className="check"><input type="checkbox" checked={f.has_curtain} onChange={set('has_curtain')} /> Curtain motor</label>
        </div>
        <ErrorNote error={err} />
        <div className="row-end span2">
          <button type="button" className="btn" onClick={onClose}>{t.cancel}</button>
          <button className="btn primary" disabled={busy}>{busy ? <Spinner /> : t.save}</button>
        </div>
      </form>
      <hr />
      <div className="danger-zone-box">
        <div>
          <h4>Sensor box code</h4>
          <p className="muted small">Typed into the box when it is installed. Make a new one if a box is lost; the old code stops working at once.</p>
          {key ? <SecretOnce label="New code" value={key} /> : <button className="btn" onClick={rotate}><Icon name="key" />Make a new code</button>}
        </div>
        {user.role === 'owner' && (
          <div>
            <h4>Remove house</h4>
            <p className="muted small">Deletes the house and all its readings. Type <b>{house.device_id}</b> to confirm.</p>
            <div className="row">
              <input className="input" value={confirmDel} onChange={(e) => setConfirmDel(e.target.value)} placeholder={house.device_id} aria-label="Type sensor ID to confirm" />
              <button className="btn danger" disabled={confirmDel !== house.device_id} onClick={del}>{t.delete}</button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
