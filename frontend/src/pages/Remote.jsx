import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { jitter, PRESETS } from './Simulator'

/* Hidden presenter remote. Not in the menu: tap the AfyaNest logo 5 times quickly (or press
   Ctrl+Shift+S) to show it. Tapping a scenario changes that house's readings straight away and
   keeps sending them every 30 s with small natural wobble, even after the remote is hidden.
   "Normal" hands the house back to the background simulation. */
export function useSecretTaps(onOpen, taps = 5, windowMs = 3000) {
  const hits = useRef([])
  useEffect(() => {
    const key = (e) => { if (e.ctrlKey && e.shiftKey && (e.key === 'S' || e.key === 's')) { e.preventDefault(); onOpen() } }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onOpen])
  return () => {
    const now = Date.now()
    hits.current = [...hits.current.filter((t) => now - t < windowMs), now]
    if (hits.current.length >= taps) { hits.current = []; onOpen() }
  }
}

export default function Remote({ open, onClose, user }) {
  const [houses, setHouses] = useState([])
  const [did, setDid] = useState('')
  const [active, setActive] = useState(null) // { device_id, key, vals, comfort }
  const [msg, setMsg] = useState('')
  const canAct = user.role === 'owner' || user.role === 'manager'

  useEffect(() => {
    if (!open) return
    api.houses().then((hs) => {
      const list = (hs || []).filter((h) => h.source !== 'live')
      setHouses(list)
      setDid((d) => d || (list.find((h) => h.sandbox) || list[0])?.device_id || '')
    }).catch(() => {})
  }, [open])

  const send = (a, vals) => api.simReading({
    device_id: a.device_id, temp: +vals.temp.toFixed(1), rh: +Math.min(100, Math.max(0, vals.rh)).toFixed(1),
    nh3: a.has_nh3 ? +Math.max(0, vals.nh3).toFixed(1) : null, hold_min: 120,
  })

  // keep "the box" sending while a scenario is on, wherever the presenter navigates
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => {
      const v = active.vals
      send(active, { temp: jitter(v.temp, 0.3), rh: jitter(v.rh, 1.5), nh3: jitter(v.nh3, 1) }).catch(() => {})
    }, 30000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const pick = async (p) => {
    const h = houses.find((x) => x.device_id === did)
    if (!h) return
    setMsg('…')
    try {
      if (p.k === 'normal') {
        if (active && active.device_id !== h.device_id) await api.simRelease(active.device_id).catch(() => {})
        await api.simRelease(h.device_id)
        setActive(null); setMsg('Back to normal')
        return
      }
      if (active && active.device_id !== h.device_id) await api.simRelease(active.device_id).catch(() => {})
      const vals = p.v(h.comfort || [18, 24])
      const a = { device_id: h.device_id, key: p.k, vals, has_nh3: h.has_nh3 !== false }
      const r = await send(a, vals)
      setActive(a); setMsg(r.level === 'danger' ? 'Danger' : r.level === 'warn' ? 'Warning' : 'Sent')
    } catch (e) { setMsg(e?.message || 'Failed') }
  }

  if (!open) return active ? <span className="remote-dot" title="Scenario running" /> : null
  return (
    <div className="remote" role="dialog" aria-label="Remote">
      <div className="remote-top">
        <select value={did} onChange={(e) => setDid(e.target.value)} aria-label="House">
          {houses.map((h) => <option key={h.device_id} value={h.device_id}>{h.farmer || h.name}{h.sandbox ? ' ·T' : ''}</option>)}
        </select>
        <button className="remote-x" onClick={onClose} aria-label="Hide">×</button>
      </div>
      <div className="remote-grid">
        {PRESETS.map((p) => (
          <button key={p.k} disabled={!canAct || !did} className={active?.key === p.k && active?.device_id === did ? 'on' : ''} onClick={() => pick(p)} title={p.l}>
            <span>{p.ic}</span><small>{p.l.split(' ')[0]}</small>
          </button>
        ))}
      </div>
      <div className="remote-foot"><small>{canAct ? msg : 'Owner or manager only'}</small><a href="#/simulator" onClick={onClose}>more</a></div>
    </div>
  )
}
