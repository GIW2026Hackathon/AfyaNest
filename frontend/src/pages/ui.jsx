import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useCountUp } from '../lib/hooks'
import { useT } from '../lib/i18n'

/* ---------------------------------------------------------------- icons (inline, no deps) */
const P = {
  overview: <><rect x="3" y="3" width="7" height="9" rx="2" /><rect x="14" y="3" width="7" height="5" rx="2" /><rect x="14" y="12" width="7" height="9" rx="2" /><rect x="3" y="16" width="7" height="5" rx="2" /></>,
  farmers: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5" /><circle cx="17.5" cy="9" r="2.5" /><path d="M16.5 14.6c2.6.2 4.4 1.9 5 4.9" /></>,
  shield: <><path d="M12 3 4.5 6v6c0 4.6 3.2 7.9 7.5 9 4.3-1.1 7.5-4.4 7.5-9V6z" /><path d="m8.8 12 2.2 2.2 4.3-4.4" /></>,
  phone: <><rect x="6.5" y="2.5" width="11" height="19" rx="2.5" /><path d="M10.5 18.5h3" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1.2-4.2 4.2-6.5 8-6.5s6.8 2.3 8 6.5" /></>,
  logout: <><path d="M9 21H5.5A1.5 1.5 0 0 1 4 19.5v-15A1.5 1.5 0 0 1 5.5 3H9" /><path d="m16 17 5-5-5-5M21 12H9" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  plus: <path d="M12 5v14M5 12h14" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  sms: <><path d="M4 5h16v11H8l-4 4z" /><path d="M8 9h8M8 12.5h5" /></>,
  call: <path d="M5 4h3.5l1.6 4-2.2 1.4a11 11 0 0 0 6.7 6.7l1.4-2.2 4 1.6V19a1.5 1.5 0 0 1-1.6 1.5C10.3 20 4 13.7 3.5 5.6A1.5 1.5 0 0 1 5 4z" />,
  bell: <><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>,
  house: <><path d="M3.5 11 12 4l8.5 7" /><path d="M5.5 9.5V20h13V9.5" /></>,
  wifi: <><path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.8 16a5 5 0 0 1 6.4 0" /><circle cx="12" cy="19" r="1" /></>,
  send: <path d="m4 12 16-8-6 16-2.5-6.5z" />,
  dial: <><circle cx="6" cy="6" r="1.4" /><circle cx="12" cy="6" r="1.4" /><circle cx="18" cy="6" r="1.4" /><circle cx="6" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="18" cy="12" r="1.4" /><circle cx="6" cy="18" r="1.4" /><circle cx="12" cy="18" r="1.4" /><circle cx="18" cy="18" r="1.4" /></>,
  key: <><circle cx="8" cy="15" r="4" /><path d="m11 12 9-9M17 6l2 2M15 8l2 2" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H3a2 2 0 0 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V3a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1.3z" /></>,
  chart: <><path d="M4 19V5M4 19h16" /><path d="m7 15 4-4 3 3 5-6" /></>,
  bolt: <path d="M13 3 5 13.5h6L10 21l8-10.5h-6z" />,
  lock: <><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></>,
}
export function Icon({ name, ...p }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
      {P[name]}
    </svg>
  )
}

export function Logo({ big }) {
  return (
    <span className={`logo ${big ? 'big' : ''}`}>
      <span className="logo-mark">
        <svg viewBox="0 0 24 24" fill="none" stroke="#03140d" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3.5 11.5 12 4.5l8.5 7V19a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z" />
          <path d="M8.5 16a3.5 3.5 0 0 1 7 0" />
        </svg>
      </span>
      <span className="logo-word">Afya<em>Nest</em></span>
    </span>
  )
}

const ICON = { ok: '●', watch: '◐', warn: '▲', danger: '◆', null: '○' }
const LEVEL_EN = { ok: 'All good', watch: 'Watch', warn: 'Warning', danger: 'Danger', nodata: 'No data', warming: 'Learning' }
export function LevelBadge({ level, status, big }) {
  const { t } = useT()
  const k = status === 'warming_up' && (!level || level === 'ok') ? 'warming' : level ?? 'nodata'
  return (
    <span className={`badge tone-${level ?? 'none'} ${big ? 'big' : ''} ${level === 'danger' ? 'throb' : ''}`}>
      <i aria-hidden="true">{ICON[level] ?? ICON.null}</i>{t[k] ?? LEVEL_EN[k] ?? k}
    </span>
  )
}

export function SourceBadge({ source, sandbox }) {
  if (sandbox) return <span className="badge sandbox" title="Test farmer: messages are shown here and never sent">Test farmer</span>
  if (source === 'live') return <span className="badge live" title="Readings come from the sensor box">● Sensor live</span>
  return <span className="badge synth" title="Simulated readings until the sensor box sends its first reading">Simulated</span>
}

export function Stat({ label, value, unit, digits = 1, sub, tone, color }) {
  const v = useCountUp(value)
  return (
    <div className={`stat ${tone ? 'tone-' + tone : ''}`}>
      <span className="stat-label">{color && <i className="sw" style={{ background: color }} />}{label}</span>
      <span className="stat-value">{value == null ? '—' : v.toFixed(digits)}<small>{unit}</small></span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  )
}

export function Field({ label, hint, error, children }) {
  return (
    <label className={`field ${error ? 'has-error' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </label>
  )
}

export function ErrorNote({ error }) {
  if (!error) return null
  return <div className="note error shake" role="alert">{error.message || String(error)}</div>
}

export function Spinner() {
  return <span className="spinner" aria-label="Loading" />
}

export function Modal({ title, onClose, children, wide }) {
  const ref = useRef(null)
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose?.()
    window.addEventListener('keydown', k)
    ref.current?.querySelector('input,select,button')?.focus()
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <div className="modal-wrap" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal pop-in ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head">
          <h3>{title}</h3>
          {onClose && <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>}
        </div>
        {children}
      </div>
    </div>
  )
}

export function SecretOnce({ label, value, note }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="secret">
      <span className="field-label">{label}</span>
      <div className="secret-row">
        <code>{value}</code>
        <button className="btn small" onClick={() => { navigator.clipboard?.writeText(value); setCopied(true) }}>{copied ? 'Copied ✓' : 'Copy'}</button>
      </div>
      <span className="field-hint">{note || 'Shown only once. Store it somewhere safe.'}</span>
    </div>
  )
}

export function PasswordMeter({ value }) {
  let s = 0
  if (value.length >= 10) s++
  if (value.length >= 14) s++
  if (/[A-Z]/.test(value) && /[a-z]/.test(value)) s++
  if (/\d/.test(value)) s++
  if (/[^A-Za-z0-9]/.test(value)) s++
  const labels = ['Too short', 'Weak', 'Fair', 'Good', 'Strong', 'Excellent']
  return (
    <div className="pw-meter" aria-live="polite">
      <div className="pw-bars">{[0, 1, 2, 3, 4].map((i) => <span key={i} className={i < s ? `on s${s}` : ''} />)}</div>
      <span>{value ? labels[s] : 'At least 10 characters. A short sentence works well.'}</span>
    </div>
  )
}

export const ago = (ts) => {
  if (!ts) return 'never'
  const s = Date.now() / 1000 - ts
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 172800) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} days ago`
}

export const initials = (name) => (name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()

/* ---------------------------------------------------------------- server status */
export function useServerStatus(every = 15000) {
  const [st, setSt] = useState({ state: 'checking', info: null })
  useEffect(() => {
    let alive = true
    const check = async () => {
      try {
        const info = await api.health()
        if (alive) setSt({ state: 'live', info })
      } catch (e) {
        if (alive) setSt({ state: e.status === 503 ? 'degraded' : 'offline', info: null })
      }
    }
    check()
    const id = setInterval(check, every)
    window.addEventListener('online', check)
    window.addEventListener('offline', check)
    return () => { alive = false; clearInterval(id); window.removeEventListener('online', check); window.removeEventListener('offline', check) }
  }, [every])
  return st
}

export function ServerStatus() {
  const st = useServerStatus()
  const label = { live: 'Server live', degraded: 'Database down', offline: 'Server offline', checking: 'Connecting…' }[st.state]
  return (
    <span className={`server-pill s-${st.state}`} role="status" aria-live="polite"
      title={st.state === 'live' ? `Database: ${st.info?.db} · AI: ${st.info?.model}` : ''}>
      <i />{label}{st.state === 'live' && st.info?.db ? <small>{st.info.db}</small> : null}
    </span>
  )
}
