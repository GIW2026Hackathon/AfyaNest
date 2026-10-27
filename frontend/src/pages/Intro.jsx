import { useEffect, useRef, useState } from 'react'

/* Full-screen introduction shown when AfyaNest opens (once per browser session).
   Browsers only allow sound after a tap, so it tries with sound first and falls back
   to muted with a "Tap for sound" button. */
export default function Intro({ onDone }) {
  const ref = useRef(null)
  const bg = useRef(null)
  const box = useRef(null)
  const [muted, setMuted] = useState(false)
  const [progress, setProgress] = useState(0)
  const [leaving, setLeaving] = useState(false)
  const [fit, setFit] = useState({})

  // Fill the screen: zoom the video a little (only empty sky at the top and bottom is
  // trimmed, max 12 %) and soften its side edges into a blurred copy behind it.
  useEffect(() => {
    const calc = () => {
      const W = window.innerWidth, H = window.innerHeight, r = 16 / 9
      const wide = W / H > r
      const cw = wide ? H * r : W, ch = wide ? H : W / r
      const z = Math.min(1.12, wide ? W / cw : H / ch)
      const e = 60
      setFit({
        transform: `scale(${z})`,
        WebkitMaskImage: wide
          ? `linear-gradient(90deg, transparent calc(50% - ${cw / 2}px), #000 calc(50% - ${cw / 2 - e}px), #000 calc(50% + ${cw / 2 - e}px), transparent calc(50% + ${cw / 2}px))`
          : `linear-gradient(180deg, transparent calc(50% - ${ch / 2}px), #000 calc(50% - ${ch / 2 - e}px), #000 calc(50% + ${ch / 2 - e}px), transparent calc(50% + ${ch / 2}px))`,
      })
    }
    calc()
    window.addEventListener('resize', calc)
    document.addEventListener('fullscreenchange', calc)
    return () => { window.removeEventListener('resize', calc); document.removeEventListener('fullscreenchange', calc) }
  }, [])

  const finish = () => {
    if (leaving) return
    setLeaving(true)
    try { sessionStorage.setItem('afya.introSeen', '1') } catch { /* private mode */ }
    setTimeout(onDone, 600)
  }

  useEffect(() => {
    const v = ref.current
    if (!v) return
    bg.current?.play().catch(() => {})
    v.muted = false
    v.play().catch(() => {
      v.muted = true
      setMuted(true)
      v.play().catch(() => {})
    })
    const k = (e) => { if (e.key === 'Escape' && !document.fullscreenElement) finish() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // the soft background copy follows the main video
  const sync = (e) => {
    const b = bg.current
    setProgress(e.target.currentTime / (e.target.duration || 60))
    if (b && Math.abs(b.currentTime - e.target.currentTime) > 0.3) b.currentTime = e.target.currentTime
  }
  const fullScreen = () => {
    const el = box.current
    if (el && !document.fullscreenElement) el.requestFullscreen?.().catch(() => {})
  }
  const unmute = () => {
    const v = ref.current
    v.muted = false
    setMuted(false)
    v.play().catch(() => {})
    fullScreen()
  }
  const leave = () => {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    finish()
  }

  return (
    <div ref={box} className={`intro-screen ${leaving ? 'leaving' : ''}`} role="dialog" aria-label="AfyaNest introduction" onDoubleClick={fullScreen}>
      <video ref={bg} className="intro-bg" src="/intro.mp4" muted playsInline autoPlay preload="auto" aria-hidden="true" tabIndex={-1} />
      <video ref={ref} className="intro-main" style={{ ...fit, maskImage: fit.WebkitMaskImage }} src="/intro.mp4" poster="/intro-poster.jpg" playsInline autoPlay preload="auto"
        onEnded={leave} onTimeUpdate={sync} onPause={() => bg.current?.pause()} onPlay={() => bg.current?.play().catch(() => {})} />
      <div className="intro-bar"><span style={{ width: `${progress * 100}%` }} /></div>
      <div className="intro-controls">
        {muted && <button className="btn primary" onClick={unmute}>🔊 Tap for sound</button>}
        {!muted && <button className="btn" onClick={fullScreen}>⛶ Full screen</button>}
        <button className="btn" onClick={leave}>Skip intro →</button>
      </div>
    </div>
  )
}
