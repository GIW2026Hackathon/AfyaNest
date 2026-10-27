import { useState } from 'react'
import { api } from '../api'
import { ErrorNote, Field, Icon, Logo, Modal, PasswordMeter, ServerStatus, Spinner } from './ui'

/* One simple screen: email + password. The protection is underneath (rate limits,
   lockout, hashed passwords, HttpOnly session cookie, CSRF tokens, encrypted data). */
export default function Login({ onSignedIn, notice }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [needCode, setNeedCode] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [intro, setIntro] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      if (needCode) {
        onSignedIn((await api.mfa(code)).user)
      } else {
        const r = await api.login(email, password)
        if (r.mfa_required) setNeedCode(true)
        else onSignedIn(r.user)
      }
    } catch (e2) {
      setErr(e2)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <section className="login-art">
        <svg className="orbit" viewBox="0 0 560 560" aria-hidden="true">
          <circle cx="280" cy="280" r="270" />
          <circle cx="280" cy="280" r="200" />
          <circle cx="280" cy="280" r="130" />
          <g className="o1"><circle className="sat" cx="280" cy="10" r="7" fill="var(--c-nh3)" /><circle className="sat" cx="550" cy="280" r="5" fill="var(--c-rh)" /></g>
          <g className="o2"><circle className="sat" cx="280" cy="80" r="6" fill="var(--c-temp)" /><circle className="sat" cx="80" cy="280" r="4" fill="var(--brand)" /></g>
        </svg>
        <Logo big />
        <div style={{ position: 'relative', zIndex: 1 }}>
          <p className="eyebrow">Operator console</p>
          <h1>Every poultry house, <span className="grad-text">watched all night.</span></h1>
          <p>Sensors in farmers' houses, three AI models on our side, and one clear SMS or call to the farmer before ammonia, cold or heat harm the birds.</p>
        </div>
        <button type="button" className="intro-card" onClick={() => setIntro(true)} aria-label="Play the AfyaNest introduction video">
          <span className="intro-thumb"><img src="/intro-poster.jpg" alt="" /><span className="intro-play"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor" /></svg></span></span>
          <span className="intro-text"><b>See how AfyaNest works</b><span>1 minute · sensors, AI and the SMS the farmer gets</span></span>
        </button>
        <div className="login-stats">
          <div><b>6 h</b><span>early warning</span></div>
          <div><b>SMS + call</b><span>any phone, no app</span></div>
          <div><b>Private</b><span>farmer details locked away</span></div>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-top"><span /><ServerStatus /></div>
        <form className="login-card rise" onSubmit={submit}>
          <div>
            <h2>{needCode ? 'Enter your code' : 'Sign in'}</h2>
            <p className="muted">{needCode ? 'Type the 6-digit code from your authenticator app.' : 'For the AfyaNest team only. Farmers receive SMS and do not need an account.'}</p>
          </div>
          {notice && <div className="note info">{notice}</div>}
          {needCode ? (
            <Field label="Code"><input className="otp" inputMode="numeric" autoComplete="one-time-code" autoFocus value={code} onChange={(e) => setCode(e.target.value)} maxLength={20} required /></Field>
          ) : (
            <>
              <Field label="Email"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required autoFocus maxLength={254} /></Field>
              <Field label="Password"><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required maxLength={128} /></Field>
            </>
          )}
          <ErrorNote error={err} />
          <button className="btn primary wide" disabled={busy}>{busy ? <Spinner /> : needCode ? 'Verify' : 'Sign in'}</button>
          <p className="lock-note"><Icon name="lock" />Too many wrong passwords lock the account for a while. Ask your admin if you are locked out.</p>
        </form>
      </section>
      {intro && (
        <Modal title="How AfyaNest works" onClose={() => setIntro(false)} wide>
          <video className="intro-video" src="/intro.mp4" poster="/intro-poster.jpg" controls autoPlay playsInline preload="auto" />
        </Modal>
      )}
    </div>
  )
}

export function ForcedStep({ user, onDone, onSignOut }) {
  return (
    <div className="forced">
      <div className="forced-card rise">
        <Logo />
        <ChangePassword forced onDone={onDone} />
        <button className="link" onClick={onSignOut}>Sign out</button>
      </div>
    </div>
  )
}

export function ChangePassword({ forced, onDone }) {
  const [cur, setCur] = useState('')
  const [nw, setNw] = useState('')
  const [nw2, setNw2] = useState('')
  const [err, setErr] = useState(null)
  const [ok, setOk] = useState(false)
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    setErr(null)
    if (nw !== nw2) return setErr(new Error('The two new passwords do not match.'))
    setBusy(true)
    try {
      await api.changePassword(cur, nw)
      setOk(true); setCur(''); setNw(''); setNw2('')
      onDone?.()
    } catch (e2) { setErr(e2) } finally { setBusy(false) }
  }
  return (
    <form onSubmit={submit} className="stack">
      <h3>{forced ? 'Choose your own password' : 'Change password'}</h3>
      {forced && <p className="muted">You signed in with a temporary password. Pick one only you know.</p>}
      <Field label={forced ? 'Temporary password' : 'Current password'}><input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" required /></Field>
      <Field label="New password"><input type="password" value={nw} onChange={(e) => setNw(e.target.value)} autoComplete="new-password" required minLength={10} /></Field>
      <PasswordMeter value={nw} />
      <Field label="Repeat new password"><input type="password" value={nw2} onChange={(e) => setNw2(e.target.value)} autoComplete="new-password" required /></Field>
      <ErrorNote error={err} />
      {ok && <div className="note good">Password changed. Other devices were signed out.</div>}
      <button className="btn primary" disabled={busy}>{busy ? <Spinner /> : 'Save password'}</button>
    </form>
  )
}
