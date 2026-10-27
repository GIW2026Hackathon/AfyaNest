import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { RingGauge } from '../charts/Live'
import { eat } from '../lib/data'
import { usePoll } from '../lib/hooks'
import { AutoPanel, NH3_BANDS, RH_BANDS, tempBands } from './House'
import { ago, ErrorNote, Field, Icon, initials, LevelBadge, Modal, SourceBadge, Spinner } from './ui'

const STATUS_WORD = { sent: 'sent', dry_run: 'sent', sandbox: 'test only', received: 'from farmer', held: 'not sent', opted_out: 'SMS stopped', failed: 'failed' }
const SCENARIOS = [
  { k: 'ammonia', ic: '💨', l: 'Ammonia builds up', s: 'Strong smell, wet litter' },
  { k: 'cold', ic: '❄', l: 'Cold night', s: 'Brooder heat lost' },
  { k: 'heat', ic: '☀', l: 'Hot afternoon', s: 'Heat stress' },
  { k: 'normal', ic: '✓', l: 'Back to normal', s: 'All-clear message' },
]

export default function Farmer({ id, user }) {
  const d = usePoll(() => api.farmer(id), [id], 10000)
  const [edit, setEdit] = useState(false)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(null)
  const [del, setDel] = useState(false)
  const f = d.data
  const canEdit = user.role !== 'viewer'

  if (d.error?.status === 404) return <div className="page"><a href="#/farmers" className="back">← Farmers</a><div className="empty-state"><h3>Farmer not found</h3></div></div>
  if (!f) return <div className="page">{d.error ? <ErrorNote error={d.error} /> : <div className="skeleton tall" />}</div>

  const toggle = async () => {
    setBusy('status'); setErr(null)
    try { await api.updateFarmer(f.id, { status: f.status === 'stopped' ? 'active' : 'stopped' }); d.reload() } catch (e) { setErr(e) } finally { setBusy(null) }
  }

  return (
    <div className="page">
      <a href="#/farmers" className="back">← Farmers</a>
      <section className="farmer-head card rise">
        <span className={`avatar xl lvl-${f.level || 'none'}`}>{initials(f.name)}</span>
        <div className="grow">
          <div className="title-row"><h1 className="display">{f.name}</h1><LevelBadge level={f.level} big />{f.sandbox && <SourceBadge sandbox />}</div>
          <p className="meta-line">
            <span><Icon name="phone" style={{ width: 14 }} /> {f.phone}</span>
            <span>{f.county || 'No county'}</span>
            <span>Messages in {f.lang === 'sw' ? 'Kiswahili' : 'English'}</span>
            <span>Added {ago(f.created_ts)}</span>
            <span className={f.status === 'stopped' ? 'hl-bad' : 'hl-good'}>{f.status === 'stopped' ? 'SMS stopped by farmer' : 'Receiving SMS & calls'}</span>
          </p>
        </div>
        {canEdit && (
          <div className="row">
            <button className="btn" onClick={() => setEdit(true)}><Icon name="settings" />Edit</button>
            <button className="btn" onClick={toggle} disabled={busy === 'status'}>{f.status === 'stopped' ? 'Restart SMS' : 'Pause SMS'}</button>
            {user.role === 'owner' && <button className="btn ghost-danger" onClick={() => setDel(true)}>Remove</button>}
          </div>
        )}
      </section>
      <ErrorNote error={err} />

      <section className="farmer-body">
        <div className="stack">
          {f.houses.map((h, i) => <HouseCard key={h.device_id} h={h} delay={i * 80} />)}
          {f.houses.length === 0 && <div className="card"><p className="muted">No house linked.</p></div>}
          {f.sandbox && canEdit && f.houses[0] && <TryAlerts device={f.houses[0].device_id} onDone={d.reload} />}
        </div>
        <PhoneView farmer={f} canReply={f.sandbox && canEdit} onChange={d.reload} />
      </section>

      {edit && <EditFarmer f={f} onClose={() => setEdit(false)} onSaved={d.reload} />}
      {del && <RemoveFarmer f={f} onClose={() => setDel(false)} />}
    </div>
  )
}

function HouseCard({ h, delay }) {
  const comfort = h.comfort || [18, 24]
  const noNh3 = h.has_nh3 === false
  return (
    <a href={`#/house/${encodeURIComponent(h.device_id)}`} className={`card house-card lvl-${h.level || 'none'} rise`} style={{ animationDelay: `${delay}ms` }}>
      <div className="card-head">
        <div><h3>{h.name}</h3><span className="muted small">Sensor {h.device_id} · {h.n_birds ? `${h.n_birds.toLocaleString()} birds · ` : ''}{Math.floor(h.age_days)} days old</span></div>
        <div className="row"><SourceBadge source={h.source} sandbox={h.sandbox} /><LevelBadge level={h.level} status={h.status} /></div>
      </div>
      <div className="mini-rings">
        <div className="m-nh3"><RingGauge size={170} label="Ammonia" value={noNh3 ? null : h.now_max_nh3} min={0} max={40} bands={NH3_BANDS} unit="ppm" /><span className="mr-label">Ammonia</span></div>
        <div className="m-temp"><RingGauge size={170} label="Temperature" value={h.now_temp} min={comfort[0] - 12} max={comfort[1] + 12} bands={tempBands(comfort)} unit="°C" /><span className="mr-label">Temperature</span></div>
        <div className="m-rh"><RingGauge size={170} label="Humidity" value={h.now_rh} min={0} max={100} bands={RH_BANDS} unit="%" digits={0} /><span className="mr-label">Humidity</span></div>
      </div>
      {h.auto && <AutoPanel auto={h.auto} esc={h.escalation} house={h} compact />}
      <div className="hc-foot">
        <span className={`live-dot ${h.online ? 'on' : ''}`}><i />{h.online ? 'Sensor online' : 'Sensor offline'} · last reading {ago(h.last_seen)}</span>
        <span className="link">Open charts &amp; predictions →</span>
      </div>
    </a>
  )
}

function TryAlerts({ device, onDone }) {
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  const run = async (k) => {
    setBusy(k); setErr(null)
    try { await api.sandboxScenario(device, k); onDone() } catch (e) { setErr(e) } finally { setBusy(null) }
  }
  return (
    <div className="card rise">
      <div className="card-head"><h3>Try an alert</h3><span className="muted small">test farmers only</span></div>
      <p className="muted small">Pretend something happens in the house. The box reacts by itself, the farmer gets an SMS and a call, and AfyaNest keeps calling every 10 minutes until they reply SAWA. The situation lasts 25 minutes; press Back to normal to end it.</p>
      <div className="scenario-grid">
        {SCENARIOS.map((s) => (
          <button key={s.k} className="scenario" onClick={() => run(s.k)} disabled={!!busy}>
            <span className="sc-ic">{busy === s.k ? <Spinner /> : s.ic}</span><span><b>{s.l}</b><span>{s.s}</span></span>
          </button>
        ))}
      </div>
      <ErrorNote error={err} />
    </div>
  )
}

/* ---------------------------------------------------------------- what the farmer sees on their phone */
function PhoneView({ farmer, canReply, onChange }) {
  const all = farmer.messages || []
  const msgs = all.filter((m) => !['held', 'opted_out'].includes(m.status)).reverse()
  const notSent = all.length - msgs.length
  const listRef = useRef(null)
  const seen = useRef(null)
  const [call, setCall] = useState(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => { listRef.current?.scrollTo({ top: 1e6, behavior: 'smooth' }) }, [msgs.length])
  // a new phone call to a test farmer rings on the simulated phone
  useEffect(() => {
    const last = farmer.messages?.[0]
    if (seen.current === null) { seen.current = last?.id || ''; return }
    if (last && last.id !== seen.current) {
      seen.current = last.id
      if (last.channel === 'voice' && last.status === 'sandbox') setCall(last)
    }
  }, [farmer.messages])

  const send = async (e) => {
    e.preventDefault()
    if (!text.trim()) return
    setBusy(true); setErr(null)
    try { await api.sandboxSms(farmer.phone, text.trim()); setText(''); onChange() } catch (e2) { setErr(e2) } finally { setBusy(false) }
  }
  const speak = (m) => {
    try {
      const u = new SpeechSynthesisUtterance(m.text)
      u.lang = farmer.lang === 'sw' ? 'sw-KE' : 'en-GB'
      u.rate = 0.95
      window.speechSynthesis.cancel(); window.speechSynthesis.speak(u)
    } catch { /* no speech in this browser */ }
  }

  return (
    <div className="phone-col rise" style={{ animationDelay: '120ms' }}>
      <p className="eyebrow center">What {farmer.name.split(' ')[0]} sees</p>
      <div className="phone">
        <div className="screen">
          <div className="status-bar"><span>{eat(Date.now() / 1000, { hour: '2-digit', minute: '2-digit' })}</span><span>AfyaNest</span></div>
          <div className="sms-head"><span className="avatar sm">AN</span><div><b>AfyaNest</b><small>SMS &amp; calls</small></div></div>
          <div className="sms-list" ref={listRef}>
            {msgs.length === 0 && <p className="sms-empty">No messages yet.</p>}
            {msgs.map((m) => {
              const mine = m.kind === 'inbound'
              const muted = ['held', 'opted_out', 'failed'].includes(m.status)
              return (
                <div key={m.id} className={`sms-in ${mine ? 'out' : ''} ${m.channel === 'voice' ? 'voice' : ''} ${muted ? 'held' : ''}`}>
                  {m.channel === 'voice' && <span className="voice-tag"><Icon name="call" style={{ width: 13 }} /> Phone call <button className="link" onClick={() => speak(m)}>▶ listen</button></span>}
                  {m.text}
                  <time>{eat(m.ts, { weekday: 'short', hour: '2-digit', minute: '2-digit' })} · {STATUS_WORD[m.status] || m.status}</time>
                </div>
              )
            })}
          </div>
          {notSent > 0 && <div className="sms-foot" style={{ borderTop: 0, paddingBottom: 4 }}>{notSent} older alert{notSent > 1 ? 's' : ''} from simulated readings were recorded but not sent</div>}
          {canReply ? (
            <form className="sms-compose" onSubmit={send}>
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Reply as the farmer (HALI, STOP…)" maxLength={160} aria-label="Reply as the farmer" />
              <button disabled={busy} aria-label="Send">{busy ? <Spinner /> : <Icon name="send" />}</button>
            </form>
          ) : <div className="sms-foot">Farmers can reply HALI / STATUS, PAZIA 50 or STOP.</div>}
          {call && (
            <div className="call-screen">
              <div style={{ textAlign: 'center' }}>
                <p className="muted small">Incoming call</p>
                <h4>AfyaNest</h4>
              </div>
              <div className="caller-ring"><Icon name="call" /></div>
              <p className="call-text">{call.text}</p>
              <div className="call-actions">
                <button className="decline" onClick={() => { window.speechSynthesis?.cancel(); setCall(null) }} aria-label="Hang up"><Icon name="call" style={{ transform: 'rotate(135deg)' }} /></button>
                <button className="accept" onClick={() => speak(call)} aria-label="Answer"><Icon name="call" /></button>
              </div>
            </div>
          )}
        </div>
      </div>
      <ErrorNote error={err} />
    </div>
  )
}

function EditFarmer({ f, onClose, onSaved }) {
  const counties = usePoll(() => api.counties(), [], 0)
  const [v, setV] = useState({ name: f.name, county: f.county || '', lang: f.lang, n_birds: f.n_birds || '' })
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value })
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null)
    try {
      await api.updateFarmer(f.id, { name: v.name, county: v.county, lang: v.lang, ...(v.n_birds ? { n_birds: Number(v.n_birds) } : {}) })
      onSaved(); onClose()
    } catch (e2) { setErr(e2) } finally { setBusy(false) }
  }
  return (
    <Modal title={`Edit ${f.name}`} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <Field label="Full name"><input value={v.name} onChange={set('name')} required maxLength={60} /></Field>
        <Field label="County"><select value={v.county} onChange={set('county')}>{(counties.data || [v.county]).map((c) => <option key={c}>{c}</option>)}</select></Field>
        <Field label="Messages in"><select value={v.lang} onChange={set('lang')}><option value="sw">Kiswahili</option><option value="en">English</option></select></Field>
        <Field label="Number of birds"><input type="number" min="1" value={v.n_birds} onChange={set('n_birds')} /></Field>
        <p className="muted small">To change the phone number, remove the farmer and add them again.</p>
        <ErrorNote error={err} />
        <div className="row-end"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy}>{busy ? <Spinner /> : 'Save'}</button></div>
      </form>
    </Modal>
  )
}

function RemoveFarmer({ f, onClose }) {
  const [txt, setTxt] = useState('')
  const [err, setErr] = useState(null)
  const go = async () => { try { await api.deleteFarmer(f.id); window.location.hash = '/farmers' } catch (e) { setErr(e) } }
  const first = f.name.split(' ')[0]
  return (
    <Modal title="Remove farmer" onClose={onClose}>
      <div className="stack">
        <p>This deletes <b>{f.name}</b>, their house, all readings and messages. It cannot be undone.</p>
        <Field label={`Type ${first} to confirm`}><input value={txt} onChange={(e) => setTxt(e.target.value)} autoFocus /></Field>
        <ErrorNote error={err} />
        <div className="row-end"><button className="btn" onClick={onClose}>Cancel</button><button className="btn danger" disabled={txt !== first} onClick={go}>Remove</button></div>
      </div>
    </Modal>
  )
}
