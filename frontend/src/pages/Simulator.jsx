import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { RingGauge } from '../charts/Live'
import { usePoll } from '../lib/hooks'
import { AutoPanel, NH3_BANDS, nh3State, RH_BANDS, rhState, tempBands, tempState } from './House'
import { ErrorNote, Icon, LevelBadge, SourceBadge, Spinner } from './ui'

/* Sensor simulator: pretend a sensor box is connected and sending these readings. They go
   through the real AI models, automatic response and SMS rules. The background simulation
   keeps running for every other house; this house follows the sliders until released. */
export const PRESETS = [
  { k: 'normal', l: 'Normal', ic: '✓', v: (c) => ({ temp: (c[0] + c[1]) / 2, rh: 62, nh3: 6 }) },
  { k: 'ammonia', l: 'Ammonia builds up', ic: '💨', v: (c) => ({ temp: (c[0] + c[1]) / 2, rh: 80, nh3: 32 }) },
  { k: 'cold', l: 'Cold night', ic: '❄', v: (c) => ({ temp: c[0] - 8, rh: 74, nh3: 8 }) },
  { k: 'heat', l: 'Heat wave', ic: '☀', v: (c) => ({ temp: c[1] + 8, rh: 82, nh3: 10 }) },
  { k: 'wet', l: 'Wet litter', ic: '💧', v: (c) => ({ temp: (c[0] + c[1]) / 2, rh: 90, nh3: 22 }) },
]
export const jitter = (v, s) => v + (Math.random() * 2 - 1) * s

export default function Simulator({ user, query }) {
  const hs = usePoll(() => api.houses(), [], 20000)
  const houses = (hs.data || []).filter((h) => h.source !== 'live')
  const [did, setDid] = useState(query?.get('h') || '')
  const h = houses.find((x) => x.device_id === did) || houses[0]
  const comfort = h?.comfort || [18, 24]
  const [v, setV] = useState(null)
  const [withNh3, setWithNh3] = useState(true)
  const [hold, setHold] = useState(15)
  const [live, setLive] = useState(false)
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState(null)
  const [err, setErr] = useState(null)
  const [sent, setSent] = useState(0)
  const canAct = user.role !== 'viewer'
  const vRef = useRef(null)
  vRef.current = v

  // start the sliders from the house's current readings
  useEffect(() => {
    if (!h) return
    setV({ temp: +(h.now_temp ?? (comfort[0] + comfort[1]) / 2).toFixed(1), rh: Math.round(h.now_rh ?? 65), nh3: Math.round(h.now_max_nh3 ?? 5) })
    setWithNh3(h.has_nh3 !== false)
    setRes(null); setLive(false); setSent(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [h?.device_id])

  const send = async (vals, quiet) => {
    if (!h || !vals) return
    if (!quiet) setBusy(true)
    setErr(null)
    try {
      const r = await api.simReading({ device_id: h.device_id, temp: +vals.temp.toFixed(1), rh: +Math.min(100, Math.max(0, vals.rh)).toFixed(1), nh3: withNh3 ? +Math.max(0, vals.nh3).toFixed(1) : null, hold_min: hold })
      setRes(r); setSent((n) => n + 1)
    } catch (e) { setErr(e); setLive(false) } finally { if (!quiet) setBusy(false) }
  }

  // connected: keep sending every 30 s with small natural wobble, like a real box
  useEffect(() => {
    if (!live) return
    send(vRef.current)
    const id = setInterval(() => {
      const x = vRef.current
      if (x) send({ temp: jitter(x.temp, 0.3), rh: jitter(x.rh, 1.5), nh3: jitter(x.nh3, 1) }, true)
    }, 30000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, h?.device_id])

  const release = async () => {
    setLive(false)
    try { await api.simRelease(h.device_id); setRes(null); setSent(0); hs.reload() } catch (e) { setErr(e) }
  }

  const states = useMemo(() => v && ({ nh3: nh3State(withNh3 ? v.nh3 : null), temp: tempState(v.temp, comfort), rh: rhState(v.rh) }), [v, withNh3, comfort])

  return (
    <div className="page">
      <section className="hero rise">
        <div>
          <p className="eyebrow">Demo · training · presentations</p>
          <h1 className="display">Sensor simulator</h1>
          <p className="muted">Pretend a sensor box is connected to a house and choose what it measures. The readings go through the real AI models, the box’s automatic response and the SMS rules. Every other house keeps its normal, unpredictable simulation.</p>
        </div>
      </section>
      <ErrorNote error={err || hs.error} />

      {!hs.data ? <div className="skeleton tall" /> : !h ? (
        <div className="card empty-state"><h3>No houses to simulate</h3><p className="muted">Add a farmer first. Houses with a real sensor box cannot be simulated.</p></div>
      ) : (
        <>
          <section className="card sim-house rise">
            <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
              <label className="field" style={{ minWidth: 300, flex: 1 }}>
                <span className="field-label">House</span>
                <select value={h.device_id} onChange={(e) => setDid(e.target.value)}>
                  {houses.map((x) => <option key={x.device_id} value={x.device_id}>{x.name} · {x.device_id}{x.sandbox ? ' (test farmer)' : ''}</option>)}
                </select>
              </label>
              <div className="sim-meta">
                <SourceBadge source={h.source} sandbox={h.sandbox} />
                <span className="muted small">{Math.floor(h.age_days)}-day-old birds · comfort {comfort[0]}-{comfort[1]}°C</span>
              </div>
              <div className={`sim-conn ${live ? 'on' : ''}`}>
                <span className="sim-dot" />
                <span><b>{live ? 'Simulated sensor connected' : h.simulated_until ? 'Holding simulator values' : 'Not connected'}</b>
                  <small>{live ? `sending every 30 s · ${sent} sent` : h.simulated_until ? 'background simulation paused for this house' : 'background simulation running'}</small></span>
              </div>
            </div>
            {!h.sandbox && <p className="note info" style={{ marginTop: 12 }}>This is a real farmer on simulated data: alerts are recorded in the console but no SMS or call is sent. Use a <b>test farmer</b> to see the SMS and call on the phone during a presentation.</p>}
          </section>

          <section className="presets">
            {PRESETS.map((p) => (
              <button key={p.k} className="scenario" disabled={!canAct} onClick={() => { const nv = p.v(comfort); setV({ temp: +nv.temp.toFixed(1), rh: nv.rh, nh3: nv.nh3 }) }}>
                <span className="sc-ic">{p.ic}</span><span><b>{p.l}</b><span>set the sliders</span></span>
              </button>
            ))}
          </section>

          {v && (
            <section className="grid-3">
              <SimCard cls="m-nh3" title="Ammonia" state={states.nh3} disabled={!withNh3}
                gauge={<RingGauge label="Ammonia" value={withNh3 ? v.nh3 : null} min={0} max={40} bands={NH3_BANDS} unit="ppm" size={200} />}
                slider={<input type="range" min="0" max="50" step="0.5" value={v.nh3} disabled={!withNh3} onChange={(e) => setV({ ...v, nh3: +e.target.value })} aria-label="Ammonia ppm" />}
                extra={<label className="check small"><input type="checkbox" checked={withNh3} onChange={(e) => setWithNh3(e.target.checked)} /> box has an ammonia sensor</label>} />
              <SimCard cls="m-temp" title="Temperature" state={states.temp}
                gauge={<RingGauge label="Temperature" value={v.temp} min={comfort[0] - 12} max={comfort[1] + 12} bands={tempBands(comfort)} unit="°C" size={200} />}
                slider={<input type="range" min={Math.floor(comfort[0] - 14)} max={Math.ceil(comfort[1] + 14)} step="0.1" value={v.temp} onChange={(e) => setV({ ...v, temp: +e.target.value })} aria-label="Temperature °C" />} />
              <SimCard cls="m-rh" title="Humidity" state={states.rh}
                gauge={<RingGauge label="Humidity" value={v.rh} min={0} max={100} bands={RH_BANDS} unit="%" digits={0} size={200} />}
                slider={<input type="range" min="10" max="100" step="1" value={v.rh} onChange={(e) => setV({ ...v, rh: +e.target.value })} aria-label="Humidity %" />} />
            </section>
          )}

          <section className="card sim-actions rise">
            <label className="field" style={{ width: 220 }}>
              <span className="field-label">Keep these values for</span>
              <select value={hold} onChange={(e) => setHold(+e.target.value)}>
                {[5, 15, 30, 60, 120].map((m) => <option key={m} value={m}>{m} minutes</option>)}
              </select>
            </label>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <button className="btn" disabled={!canAct || busy || live} onClick={() => send(v)}>{busy ? <Spinner /> : <Icon name="send" />}Send one reading</button>
              {live
                ? <button className="btn danger" onClick={() => setLive(false)}>Stop sending</button>
                : <button className="btn primary" disabled={!canAct} onClick={() => setLive(true)}><Icon name="wifi" />Connect simulated sensor</button>}
              <button className="btn" disabled={!canAct} onClick={release}>Back to normal simulation</button>
            </div>
          </section>

          {res && (
            <section className="card sim-result rise">
              <div className="card-head">
                <h3>What AfyaNest did</h3>
                <LevelBadge level={res.level} big />
              </div>
              <div className="reasons">
                {(res.detection?.reasons || []).map((r, k) => <span key={k} className={`reason tone-${r.level}`}><b>{r.kind === 'ammonia' ? 'Ammonia' : r.kind === 'cold' ? 'Too cold' : r.kind === 'heat' ? 'Too hot' : r.kind}</b> {r.value != null ? r.value : ''}{r.kind === 'ammonia' ? ' ppm' : r.kind === 'cold' || r.kind === 'heat' ? '°C' : ''}</span>)}
                {!(res.detection?.reasons || []).length && <span className="reason tone-ok"><b>No danger</b> right now</span>}
              </div>
              {res.auto && <AutoPanel auto={res.auto} house={h} />}
              <div className="row" style={{ marginTop: 14, flexWrap: 'wrap' }}>
                <a className="btn" href={`#/house/${encodeURIComponent(h.device_id)}`}>Open house charts →</a>
                {h.farmer_id && <a className="btn" href={`#/farmers/${h.farmer_id}`}>{res.sandbox ? 'See the SMS and call on the phone →' : 'Open farmer →'}</a>}
                <a className="btn" href="#/danger">Danger alarm →</a>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}

function SimCard({ cls, title, state, gauge, slider, extra, disabled }) {
  return (
    <div className={`card measure ${cls} sim-card rise ${disabled ? 'dim' : ''}`}>
      <div className="m-head"><h3><i className="sw lg" style={{ background: 'var(--mc)' }} />{title}</h3></div>
      {gauge}
      <div className={`m-state state-${state.tone}`}>{state.text}</div>
      <div className="sim-slider">{slider}</div>
      {extra}
    </div>
  )
}
