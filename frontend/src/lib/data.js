// Turn raw per-node readings into the series the charts need.
import { mean, quantile } from 'd3-array'

export const BIRD_ZONES = [0, 1, 2, 3] // brooder, drinkers, centre (not curtain/fan end)
export const NH3 = { target: 15, warn: 20, danger: 25 }

/** Group readings by timestamp → [{ts, nodes:[{nh3,temp,rh}...]}] */
export function byTime(readings, nNodes = 6) {
  const m = new Map()
  for (const r of readings) {
    let row = m.get(r.ts)
    if (!row) {
      row = { ts: r.ts, nodes: Array.from({ length: nNodes }, () => null) }
      m.set(r.ts, row)
    }
    if (r.node >= 0 && r.node < nNodes) row.nodes[r.node] = r
  }
  return [...m.values()].sort((a, b) => a.ts - b.ts)
}

const vals = (row, key, idx) =>
  idx.map((i) => row.nodes[i]?.[key]).filter((v) => v != null && Number.isFinite(v))

/** House-level series: worst/mean/min/max per measure. */
export function houseSeries(rows) {
  const all = [0, 1, 2, 3, 4, 5]
  return rows.map((row) => {
    const n = vals(row, 'nh3', all)
    const t = vals(row, 'temp', BIRD_ZONES)
    const h = vals(row, 'rh', BIRD_ZONES)
    return {
      ts: row.ts,
      nh3: n.length ? Math.max(...n) : null, nh3Lo: n.length ? Math.min(...n) : null, nh3Mean: n.length ? mean(n) : null,
      temp: t.length ? mean(t) : null, tempLo: t.length ? Math.min(...t) : null, tempHi: t.length ? Math.max(...t) : null,
      rh: h.length ? mean(h) : null, rhLo: h.length ? Math.min(...h) : null, rhHi: h.length ? Math.max(...h) : null,
    }
  })
}

/** Per-zone series for a measure → [[{ts,v}...] per node] */
export function zoneSeries(rows, key, nNodes = 6) {
  return Array.from({ length: nNodes }, (_, i) =>
    rows.map((r) => ({ ts: r.ts, v: r.nodes[i]?.[key] ?? null })))
}

/** Hour-of-day profile (EAT, UTC+3): p10/median/p90 + mean per hour. */
export function diurnal(series, key, tzOffsetH = 3) {
  const buckets = Array.from({ length: 24 }, () => [])
  for (const s of series) {
    if (s[key] == null) continue
    const h = Math.floor(((s.ts / 3600 + tzOffsetH) % 24 + 24) % 24)
    buckets[h].push(s[key])
  }
  return buckets.map((b, h) => {
    const s = b.slice().sort((x, y) => x - y)
    return { h, n: s.length, p10: s.length ? quantile(s, 0.1) : null, p50: s.length ? quantile(s, 0.5) : null, p90: s.length ? quantile(s, 0.9) : null }
  })
}

/** Hours above warn/danger per zone. */
export function exposure(rows, stepMin = 10, nNodes = 6) {
  return Array.from({ length: nNodes }, (_, i) => {
    let warn = 0
    let danger = 0
    let peak = 0
    for (const r of rows) {
      const v = r.nodes[i]?.nh3
      if (v == null) continue
      peak = Math.max(peak, v)
      if (v >= NH3.danger) danger += stepMin / 60
      else if (v >= NH3.warn) warn += stepMin / 60
    }
    return { node: i, warn, danger, peak }
  })
}

/** Temperature-humidity index (poultry form, Tao & Xin 2003 simplified). */
export const thi = (t, rh) => 0.8 * t + (rh / 100) * (t - 14.4) + 46.4

export function stats(series, key) {
  const v = series.map((s) => s[key]).filter((x) => x != null)
  if (!v.length) return null
  return { min: Math.min(...v), max: Math.max(...v), mean: mean(v), last: v[v.length - 1] }
}

export function levelOf(ppm) {
  if (ppm == null) return null
  return ppm >= NH3.danger ? 'danger' : ppm >= NH3.warn ? 'warn' : ppm >= NH3.target ? 'watch' : 'ok'
}

export const fmtAgo = (ts) => {
  if (!ts) return '—'
  const s = Date.now() / 1000 - ts
  if (s < 90) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400 * 2) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} days ago`
}

export const eat = (ts, opts) =>
  new Date(ts * 1000).toLocaleString('en-GB', { timeZone: 'Africa/Nairobi', ...opts })
