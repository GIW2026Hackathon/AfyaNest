import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/** Width of an element, kept up to date with ResizeObserver. */
export function useWidth(fallback = 640) {
  const ref = useRef(null)
  const [w, setW] = useState(fallback)
  useLayoutEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, Math.floor(e.contentRect.width))))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

/** Load data, refresh on an interval, keep previous data while reloading. */
export function usePoll(fn, deps, every = 60000) {
  const [state, setState] = useState({ data: null, error: null, loading: true })
  const fnRef = useRef(fn)
  fnRef.current = fn
  const load = useCallback(async () => {
    try {
      const data = await fnRef.current()
      setState({ data, error: null, loading: false })
    } catch (error) {
      setState((s) => ({ ...s, error, loading: false }))
    }
  }, [])
  useEffect(() => {
    setState((s) => ({ ...s, loading: true }))
    load()
    if (!every) return
    const id = setInterval(() => document.visibilityState === 'visible' && load(), every)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return { ...state, reload: load }
}

export const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Animate a number from its previous value to the new one. */
export function useCountUp(value, ms = 900) {
  const [v, setV] = useState(value ?? 0)
  const from = useRef(0)
  useEffect(() => {
    if (value == null || Number.isNaN(value)) return
    if (reducedMotion()) {
      setV(value)
      from.current = value
      return
    }
    const start = performance.now()
    const a = from.current
    let raf
    const tick = (t) => {
      const k = Math.min(1, (t - start) / ms)
      const e = 1 - Math.pow(1 - k, 4)
      setV(a + (value - a) * e)
      if (k < 1) raf = requestAnimationFrame(tick)
      else from.current = value
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, ms])
  return v
}

/** True once the element has scrolled into view (for entry animations). */
export function useInView() {
  const ref = useRef(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    if (!ref.current || seen) return
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setSeen(true), { threshold: 0.15 })
    io.observe(ref.current)
    return () => io.disconnect()
  }, [seen])
  return [ref, seen]
}
