import { useMemo, useState } from 'react'
import { api } from '../api'
import { usePoll } from '../lib/hooks'
import { ago, ErrorNote, Field, Icon, initials, LevelBadge, Modal, SecretOnce, SourceBadge, Spinner } from './ui'

const FILTERS = [
  { k: 'all', l: 'All' },
  { k: 'attention', l: 'Need attention' },
  { k: 'test', l: 'Test farmers' },
  { k: 'stopped', l: 'SMS stopped' },
]
const RANK = { danger: 0, warn: 1, watch: 2, ok: 3 }

export default function Farmers({ user, query }) {
  const list = usePoll(() => api.farmers(), [], 30000)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all')
  const [adding, setAdding] = useState(query?.get('add') === '1')
  const canAdd = user.role !== 'viewer'
  const all = list.data || []
  const counts = {
    all: all.length,
    attention: all.filter((f) => f.level === 'warn' || f.level === 'danger').length,
    test: all.filter((f) => f.sandbox).length,
    stopped: all.filter((f) => f.status === 'stopped').length,
  }
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return all
      .filter((f) => filter === 'all' || (filter === 'attention' ? (f.level === 'warn' || f.level === 'danger')
        : filter === 'test' ? f.sandbox : f.status === 'stopped'))
      .filter((f) => !s || f.name.toLowerCase().includes(s) || f.phone.includes(s) || (f.county || '').toLowerCase().includes(s)
        || f.houses.some((h) => h.device_id.toLowerCase().includes(s)))
      .sort((a, b) => (RANK[a.level] ?? 4) - (RANK[b.level] ?? 4) || a.name.localeCompare(b.name))
  }, [all, q, filter])

  const close = () => { setAdding(false); if (window.location.hash.includes('?')) window.history.replaceState(null, '', '#/farmers') }

  return (
    <div className="page">
      <section className="hero rise">
        <div>
          <p className="eyebrow">Farmers</p>
          <h1 className="display">Everyone we protect</h1>
          <p className="muted">Farmers are added here when they buy a sensor box. They never log in: they get SMS and phone calls on any phone.</p>
        </div>
        {canAdd && <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" />Add farmer</button>}
      </section>

      <section className="toolbar">
        <label className="search"><Icon name="search" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone, county or sensor" aria-label="Search farmers" /></label>
        <div className="seg" role="group" aria-label="Filter">
          {FILTERS.map((f) => <button key={f.k} className={filter === f.k ? 'on' : ''} onClick={() => setFilter(f.k)}>{f.l}<span className="seg-n">{counts[f.k]}</span></button>)}
        </div>
      </section>
      <ErrorNote error={list.error} />

      {!list.data ? <div className="skeleton tall" /> : all.length === 0 ? (
        <div className="card empty-state rise">
          <div className="empty-art"><Icon name="farmers" /></div>
          <h3>No farmers yet</h3>
          <p className="muted">Add the first farmer when their sensor box is sold. They get a welcome SMS straight away.</p>
          {canAdd && <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" />Add farmer</button>}
        </div>
      ) : rows.length === 0 ? <p className="muted">Nobody matches.</p> : (
        <div className="farmer-grid">
          {rows.map((f, i) => {
            const h = f.houses[0]
            return (
              <a key={f.id} href={`#/farmers/${f.id}`} className={`card farmer-card lvl-${f.level || 'none'} rise`} style={{ animationDelay: `${Math.min(i, 14) * 30}ms` }}>
                <div className="fc-top">
                  <span className="avatar lg">{initials(f.name)}</span>
                  <div className="grow"><b>{f.name}</b><span className="muted small">{f.phone} · {f.county || 'no county'}</span></div>
                  <LevelBadge level={f.level} />
                </div>
                {h ? (
                  <div className="fc-vals">
                    <span className="tv nh3"><small>Ammonia</small>{h.now_max_nh3 != null ? h.now_max_nh3.toFixed(0) : '—'}<em>ppm</em></span>
                    <span className="tv temp"><small>Temp</small>{h.now_temp != null ? h.now_temp.toFixed(1) : '—'}<em>°C</em></span>
                    <span className="tv rh"><small>Humidity</small>{h.now_rh != null ? h.now_rh.toFixed(0) : '—'}<em>%</em></span>
                  </div>
                ) : <p className="muted small">No house yet</p>}
                <div className="fc-foot">
                  {h && <SourceBadge source={h.source} sandbox={f.sandbox} />}
                  {f.status === 'stopped' && <span className="badge tone-none">SMS stopped</span>}
                  <span className="muted small grow" style={{ textAlign: 'right' }}>added {ago(f.created_ts)}</span>
                </div>
              </a>
            )
          })}
        </div>
      )}
      {adding && <AddFarmer onClose={close} onDone={list.reload} />}
    </div>
  )
}

/* ---------------------------------------------------------------- Add farmer (2 short steps) */
export function AddFarmer({ onClose, onDone }) {
  const counties = usePoll(() => api.counties(), [], 0)
  const [step, setStep] = useState(1)
  const [f, setF] = useState({ name: '', phone: '+254', lang: 'sw', county: '', device_id: '', n_birds: '', age_weeks: '0', test: false, backup_phone: '', has_fan: false, has_heater: false, has_curtain: false })
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const phone = f.phone.replace(/[\s-]/g, '').replace(/^0(7|1)/, '+254$1')

  const next = (e) => { e.preventDefault(); setErr(null); setStep(2) }
  const save = async (e) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      const r = await api.addFarmer({
        name: f.name.trim(), phone, lang: f.lang, county: f.county,
        n_birds: f.n_birds ? Number(f.n_birds) : null, age_weeks: Number(f.age_weeks || 0),
        device_id: f.device_id.trim() || null, test: f.test,
        backup_phone: f.backup_phone ? f.backup_phone.replace(/[\s-]/g, '').replace(/^0(7|1)/, '+254$1') : null,
        has_fan: f.has_fan, has_heater: f.has_heater, has_curtain: f.has_curtain,
      })
      setDone(r); onDone?.()
    } catch (e2) {
      setErr(e2)
      if (e2.status === 409 && /phone/i.test(e2.message)) setStep(1)
    } finally { setBusy(false) }
  }

  return (
    <Modal title={done ? 'Farmer added' : 'Add farmer'} onClose={onClose} wide>
      {done ? (
        <div className="success pop-in">
          <svg className="tick-anim" viewBox="0 0 52 52" aria-hidden="true"><circle cx="26" cy="26" r="24" /><path d="M15 27l7 7 15-16" /></svg>
          <h3>{f.name.split(' ')[0]} is protected</h3>
          <p className="muted">{f.test ? 'Test farmer: messages appear only in this console.' : `A welcome SMS was sent to ${phone}.`} Readings are simulated until the sensor box sends its first reading.</p>
          <div className="done-grid">
            <div><span className="field-label">Sensor box ID</span><code className="big-code">{done.device_id}</code></div>
            <SecretOnce label="Sensor box code (for the installer)" value={done.device_key} note="Shown only once. Type it into the box when installing. You can make a new code later from the house page." />
          </div>
          <div className="row-end">
            <button className="btn" onClick={onClose}>Close</button>
            <a className="btn primary" href={`#/farmers/${done.farmer_id}`} onClick={onClose}>Open farmer →</a>
          </div>
        </div>
      ) : (
        <>
          <ol className="stepper" aria-label="Steps">
            <li className={step >= 1 ? 'on' : ''}><span>1</span>Farmer</li>
            <li className={step >= 2 ? 'on' : ''}><span>2</span>Sensor &amp; flock</li>
          </ol>
          {step === 1 ? (
            <form className="form-grid slide-in" onSubmit={next} key="s1">
              <Field label="Full name"><input value={f.name} onChange={set('name')} required minLength={2} maxLength={60} pattern="[A-Za-z][A-Za-z '\-.]{1,59}" autoFocus placeholder="e.g. Mary Wanjiku" /></Field>
              <Field label="Phone number" hint="The number that gets the SMS and calls"><input value={f.phone} onChange={set('phone')} required inputMode="tel" placeholder="+254712345678" /></Field>
              <Field label="County"><select value={f.county} onChange={set('county')} required><option value="">Choose…</option>{(counties.data || []).map((c) => <option key={c}>{c}</option>)}</select></Field>
              <Field label="Messages in">
                <div className="seg full">
                  <button type="button" className={f.lang === 'sw' ? 'on' : ''} onClick={() => setF({ ...f, lang: 'sw' })}>Kiswahili</button>
                  <button type="button" className={f.lang === 'en' ? 'on' : ''} onClick={() => setF({ ...f, lang: 'en' })}>English</button>
                </div>
              </Field>
              <ErrorNote error={err} />
              <div className="row-end span2">
                <button type="button" className="btn" onClick={onClose}>Cancel</button>
                <button className="btn primary" disabled={!/^\+\d{9,15}$/.test(phone)}>Next →</button>
              </div>
            </form>
          ) : (
            <form className="form-grid slide-in" onSubmit={save} key="s2">
              <Field label="Sensor box ID" hint="Printed on the box. Leave empty to create one."><input value={f.device_id} onChange={set('device_id')} maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9._\-]{2,31}" placeholder="e.g. AN-7KQ2PX" autoFocus /></Field>
              <Field label="Number of birds"><input type="number" min="1" max="200000" value={f.n_birds} onChange={set('n_birds')} placeholder="e.g. 300" /></Field>
              <Field label="Age of the chicks (weeks)" hint="0 if they arrive today"><input type="number" min="0" max="80" value={f.age_weeks} onChange={set('age_weeks')} /></Field>
              <Field label="Backup contact (optional)" hint="Neighbour or technician, called if the farmer does not answer"><input value={f.backup_phone} onChange={set('backup_phone')} inputMode="tel" placeholder="+2547…" /></Field>
              <div className="equip span2">
                <span className="field-label">What the box can switch by itself</span>
                <label className="check"><input type="checkbox" checked={f.has_fan} onChange={set('has_fan')} /> Fan</label>
                <label className="check"><input type="checkbox" checked={f.has_heater} onChange={set('has_heater')} /> Heater / brooder lamp</label>
                <label className="check"><input type="checkbox" checked={f.has_curtain} onChange={set('has_curtain')} /> Curtain motor</label>
              </div>
              <label className="check test-check"><input type="checkbox" checked={f.test} onChange={set('test')} /><span><b>Test farmer</b><small>Messages stay in this console and are never sent. Use it for training and demos.</small></span></label>
              <div className="summary-chip span2">
                <span className="avatar">{initials(f.name)}</span>
                <span><b>{f.name}</b><small>{phone} · {f.county} · {f.lang === 'sw' ? 'Kiswahili' : 'English'}</small></span>
              </div>
              <ErrorNote error={err} />
              <div className="row-end span2">
                <button type="button" className="btn" onClick={() => setStep(1)}>← Back</button>
                <button className="btn primary" disabled={busy}>{busy ? <Spinner /> : 'Add farmer'}</button>
              </div>
            </form>
          )}
        </>
      )}
    </Modal>
  )
}
