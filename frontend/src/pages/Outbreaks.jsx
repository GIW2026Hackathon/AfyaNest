import { useState } from 'react'
import { api } from '../api'
import { eat } from '../lib/data'
import { usePoll } from '../lib/hooks'
import { useT } from '../lib/i18n'
import { ago, ErrorNote, Modal, Spinner } from './ui'

const STATUS = {
  pending: { label: 'Waiting for your decision', tone: 'watch' },
  auto_sent: { label: 'SMS sent automatically', tone: 'ok' },
  sent: { label: 'SMS sent', tone: 'ok' },
  dismissed: { label: 'Dismissed', tone: 'none' },
}
const SCOPE = { county: 'County', national: 'Kenya-wide', regional: 'Neighbouring country' }

export default function Outbreaks({ user }) {
  const { lang } = useT()
  const models = usePoll(() => api.models(), [], 60000)
  const ob = usePoll(() => api.outbreaks(), [], 60000)
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const canAct = user.role !== 'viewer'
  const m = models.data
  const sigs = ob.data?.signals || []

  const act = async (fn, key) => {
    setBusy(key); setErr(null)
    try { await fn(); ob.reload(); models.reload() } catch (e) { setErr(e) } finally { setBusy(null) }
  }

  return (
    <div className="page">
      <section className="hero rise">
        <div>
          <p className="eyebrow">Early warning</p>
          <h1 className="display">Disease watch</h1>
          <p className="muted">Three helpers look after every flock: disease news from outside, danger inside the house, and what the next six hours will bring. Farmers only receive a short SMS or call.</p>
        </div>
        {canAct && (
          <button className="btn" disabled={busy === 'refresh'} onClick={() => act(() => api.refreshOutbreaks(), 'refresh')}>
            {busy === 'refresh' ? <Spinner /> : '↻'} Check news now
          </button>
        )}
      </section>
      <ErrorNote error={err || ob.error} />

      <section className="model-grid">
        <ModelCard n="1" title="Disease news" sub="Reads the news for outbreaks" tone="nh3" delay={0}
          lines={m ? [
            m.outbreak_watch.last_run ? `Last checked ${ago(m.outbreak_watch.last_run)}` : 'Checks a minute after start, then every few hours',
            `${m.outbreak_watch.sources} news and government sources`,
            'Texts farmers in the affected county how to protect their birds',
          ] : []} />
        <ModelCard n="2" title="Danger alarm" sub="Watches the sensors right now" tone="temp" delay={80}
          lines={m ? ['Ammonia too high', 'Too cold or too hot for the age of the birds', 'Sensor broken or offline', 'Danger = SMS and a phone call'] : []} />
        <ModelCard n="3" title="Prediction" sub="Looks 6 hours ahead" tone="rh" delay={160}
          lines={m ? [
            'Predicts ammonia and temperature',
            m.prediction.metrics ? `Usually within ${m.prediction.metrics.mae_1h_ppm.toFixed(1)} ppm one hour ahead` : 'Learns each house from its readings',
            'Tells the farmer what time to check the house',
          ] : []} />
      </section>
      {m && m.data.synthetic > 0 && (
        <div className="note info">
          {m.data.synthetic} of {m.data.houses} houses use <b>simulated readings</b> until their sensor box is installed. Their alerts are recorded but not sent. A house switches to real readings by itself when the box sends its first reading.
        </div>
      )}

      <div className="section-head"><h2>Disease reports near your farms</h2></div>
      {ob.loading && !ob.data && <div className="card skeleton" />}
      {ob.data && !sigs.length && (
        <div className="empty-state rise">
          
          <h3>No outbreak reports for your areas</h3>
          <p className="muted">AfyaNest reads the news and official sources every 6 hours. Reports are matched to each farmer's county.</p>
        </div>
      )}
      <div className="signals">
        {sigs.map((s, i) => {
          const st = (s.status === 'sent' || s.status === 'auto_sent') && !s.n_sent
            ? { label: s.status === 'auto_sent' ? 'Approved · no farmer texted (simulated houses)' : 'Approved · no farmer texted (simulated houses)', tone: 'none' }
            : STATUS[s.status] || STATUS.pending
          return (
            <article key={s.id} className={`card signal rise st-${s.status}`} style={{ animationDelay: `${i * 60}ms` }}>
              <div className="signal-head">
                <div>
                  <h3>{s.label} <span className="muted">· {s.county === 'Kenya' ? 'Kenya' : s.county === 'Region' ? 'neighbouring country' : `${s.county} County`}</span></h3>
                  <p className="muted small">{SCOPE[s.scope]} · first reported {eat(s.first_seen, { day: '2-digit', month: 'short' })} · latest {ago(s.last_seen)} · {s.n_sources} source{s.n_sources > 1 ? 's' : ''}</p>
                </div>
                <span className={`badge tone-${st.tone}`}>{st.label}{s.n_sent ? ` · ${s.n_sent} farmer${s.n_sent === 1 ? '' : 's'}` : ''}</span>
              </div>
              <div className="signal-body">
                <div className="conf">
                  <span className="field-label">How sure</span>
                  <div className="conf-bar"><span style={{ width: `${Math.round(s.confidence * 100)}%` }} className={s.confidence >= 0.8 ? 'hi' : s.confidence >= 0.5 ? 'mid' : 'lo'} /></div>
                  <b>{Math.round(s.confidence * 100)}%</b>
                  {s.official ? <span className="badge tone-ok">Official source</span> : <span className="badge tone-watch">News only</span>}
                </div>
                <p className="small muted">Affects {s.houses_in_area} of your houses{s.nearby.length ? ` (within ~100 km: ${s.nearby.join(', ')})` : ''}.</p>
                <div className="sms-preview">
                  <span className="field-label">SMS farmers receive</span>
                  <p className="sms">{s.sms_preview[lang] || s.sms_preview.sw}</p>
                </div>
                <details>
                  <summary>Reports ({s.items.length})</summary>
                  <ul className="reports">
                    {s.items.map((it) => (
                      <li key={it.link}>
                        <a href={/^https?:\/\//.test(it.link) ? it.link : '#'} target="_blank" rel="noopener noreferrer nofollow">{it.title}</a>
                        <span className="muted small"> — {it.domain}{it.official ? ' (official)' : ''} · {ago(it.ts)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
              {canAct && s.status === 'pending' && s.scope !== 'regional' && (
                <div className="row-end">
                  <button className="btn" disabled={!!busy} onClick={() => act(() => api.dismissOutbreak(s.id), s.id + 'd')}>Dismiss</button>
                  <button className="btn primary" disabled={!!busy || !s.houses_in_area} onClick={() => setConfirm(s)}>Send SMS to {s.houses_in_area} farmer{s.houses_in_area === 1 ? '' : 's'}</button>
                </div>
              )}
            </article>
          )
        })}
      </div>
      {confirm && (
        <Modal title="Send outbreak SMS?" onClose={() => setConfirm(null)}>
          <p>This report is <b>not from an official source</b>. Check the linked reports first: a wrong alarm can cause panic selling. Farmers in the area will receive:</p>
          <p className="sms">{confirm.sms_preview[lang] || confirm.sms_preview.sw}</p>
          <div className="row-end">
            <button className="btn" onClick={() => setConfirm(null)}>Cancel</button>
            <button className="btn primary" onClick={() => { const s = confirm; setConfirm(null); act(() => api.approveOutbreak(s.id), s.id) }}>Send to {confirm.houses_in_area} farmers</button>
          </div>
        </Modal>
      )}
    </div>
  )
}

function ModelCard({ n, title, sub, lines, tone, delay }) {
  return (
    <div className={`card model-card m-${tone} rise`} style={{ animationDelay: `${delay}ms` }}>
      <div className="model-n">{n}</div>
      <h3>{title}</h3>
      <p className="eyebrow">{sub}</p>
      {lines.length ? <ul>{lines.map((l, i) => <li key={i}>{l}</li>)}</ul> : <Spinner />}
      <span className="model-live"><i />on</span>
    </div>
  )
}
