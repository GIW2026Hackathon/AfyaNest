import { bisector, extent } from 'd3-array'
import { scaleLinear, scaleUtc } from 'd3-scale'
import { area, curveMonotoneX, line } from 'd3-shape'
import { utcFormat } from 'd3-time-format'
import { useId, useMemo } from 'react'
import { useWidth } from '../lib/hooks'

const EAT = 3 * 3600
export const toDate = (ts) => new Date((ts + EAT) * 1000) // shift so utc formatters show Nairobi time
const fmtHour = utcFormat('%H:%M')
const fmtDay = utcFormat('%a %d')
const fmtFull = utcFormat('%a %d %b, %H:%M')

export function timeTicks(x, width) {
  const n = Math.max(2, Math.floor(width / 110))
  return x.ticks(n).map((d) => ({
    d,
    label: d.getUTCHours() === 0 && d.getUTCMinutes() === 0 ? fmtDay(d) : fmtHour(d),
  }))
}
export const fullTime = (ts) => fmtFull(toDate(ts))

const bis = bisector((d) => d.ts).center

/**
 * One measure over time.
 *  lines:      [{key, color, label, width?, dash?}]
 *  band:       {lo, hi, color} keys for a min–max ribbon
 *  thresholds: [{y, label, tone}]   tone: warn | danger | target
 *  comfort:    [lo, hi] shaded "good" band
 *  lane:       [{ts, v}] 0..1 values drawn as a thin strip under the plot (curtain)
 */
export default function TimeSeries({
  data, lines, band, thresholds = [], comfort, lane, laneLabel, unit, height = 220,
  yDomain, hoverTs, onHover, fmt = (v) => v.toFixed(1), animateKey,
}) {
  const [ref, width] = useWidth()
  const clipId = useId().replace(/:/g, '')
  const m = { t: 14, r: 64, b: lane ? 50 : 28, l: 40 }
  const iw = Math.max(10, width - m.l - m.r)
  const ih = height - m.t - m.b

  const { x, y, paths, bandPath } = useMemo(() => {
    const xd = extent(data, (d) => d.ts)
    const x = scaleUtc().domain(xd[0] != null ? xd.map(toDate) : [new Date(), new Date()]).range([0, iw])
    let lo = Infinity
    let hi = -Infinity
    for (const d of data) {
      for (const l of lines) if (d[l.key] != null) { lo = Math.min(lo, d[l.key]); hi = Math.max(hi, d[l.key]) }
      if (band) for (const k of [band.lo, band.hi]) if (d[k] != null) { lo = Math.min(lo, d[k]); hi = Math.max(hi, d[k]) }
    }
    for (const t of thresholds) hi = Math.max(hi, t.y * 1.08)
    if (comfort) { lo = Math.min(lo, comfort[0] - 1); hi = Math.max(hi, comfort[1] + 1) }
    if (!Number.isFinite(lo)) { lo = 0; hi = 1 }
    const pad = (hi - lo) * 0.08 || 1
    const y = scaleLinear().domain(yDomain || [Math.max(0, lo - pad), hi + pad]).nice().range([ih, 0])
    const X = (d) => x(toDate(d.ts))
    const paths = lines.map((l) => line().defined((d) => d[l.key] != null).x(X).y((d) => y(d[l.key])).curve(curveMonotoneX)(data))
    const bandPath = band
      ? area().defined((d) => d[band.lo] != null && d[band.hi] != null).x(X).y0((d) => y(d[band.lo])).y1((d) => y(d[band.hi])).curve(curveMonotoneX)(data)
      : null
    return { x, y, paths, bandPath }
  }, [data, lines, band, thresholds, comfort, iw, ih, yDomain])

  const hoverIdx = hoverTs != null && data.length ? bis(data, hoverTs) : null
  const hd = hoverIdx != null ? data[hoverIdx] : null
  const hx = hd ? x(toDate(hd.ts)) : null

  const move = (e) => {
    if (!data.length || !onHover) return
    const r = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - r.left
    const ts = x.invert(px).getTime() / 1000 - EAT
    onHover(data[bis(data, ts)]?.ts ?? null)
  }

  const yt = y.ticks(Math.max(3, Math.floor(ih / 45)))
  const laneY = ih + 22
  const laneArea = lane?.length
    ? area().x((d) => x(toDate(d.ts))).y0(laneY + 14).y1((d) => laneY + 14 - 14 * (d.v ?? 0)).curve(curveMonotoneX)(lane)
    : null

  // keep the tooltip inside the chart
  const tipLeft = hx != null ? Math.min(Math.max(m.l + hx + 14, 0), width - 190) : 0
  const tipFlip = hx != null && hx + m.l + 200 > width
  return (
    <div className="chart" ref={ref} style={{ height }}>
      <svg width={width} height={height} role="img" aria-label={lines.map((l) => l.label).join(', ') + ' over time'}>
        <defs>
          <clipPath id={`c${clipId}`}>
            <rect key={animateKey} className="reveal" x={0} y={-4} width={iw} height={ih + 8} />
          </clipPath>
          {lines.map((l, i) => (
            <linearGradient key={i} id={`g${clipId}${i}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" style={{ stopColor: l.color, stopOpacity: 0.28 }} />
              <stop offset="100%" style={{ stopColor: l.color, stopOpacity: 0 }} />
            </linearGradient>
          ))}
        </defs>
        <g transform={`translate(${m.l},${m.t})`}>
          {/* grid + y axis */}
          {yt.map((t) => (
            <g key={t} transform={`translate(0,${y(t)})`}>
              <line x2={iw} className="grid" />
              <text x={-8} dy="0.32em" className="tick" textAnchor="end">{t}</text>
            </g>
          ))}
          {comfort && (
            <g>
              <rect x={0} width={iw} y={y(comfort[1])} height={Math.max(0, y(comfort[0]) - y(comfort[1]))} className="comfort-band" />
              <text x={iw + 6} y={y(comfort[1]) + 10} className="tick comfort-label">comfort</text>
            </g>
          )}
          {thresholds.map((t) => t.tone === 'danger' && (
            <rect key={'z' + t.y} x={0} width={iw} y={0} height={Math.max(0, y(t.y))} className="danger-zone" />
          ))}
          {thresholds.map((t) => (
            <g key={t.y} transform={`translate(0,${y(t.y)})`} className={`thr thr-${t.tone}`}>
              <line x2={iw} />
              <text x={iw + 6} dy={t.tone === 'danger' ? '-0.25em' : t.tone === 'warn' ? '0.95em' : '0.32em'}>{t.label}</text>
            </g>
          ))}
          {/* x axis */}
          {timeTicks(x, iw).map(({ d, label }) => (
            <g key={+d} transform={`translate(${x(d)},${ih})`}>
              <line y2={5} className="axis" />
              <text y={18} className="tick" textAnchor="middle">{label}</text>
            </g>
          ))}
          <line x1={0} x2={iw} y1={ih} y2={ih} className="axis" />

          <g clipPath={`url(#c${clipId})`}>
            {bandPath && <path d={bandPath} className="band" style={{ fill: band.color }} />}
            {lines.length === 1 && paths[0] && (
              <path d={area().defined((d) => d[lines[0].key] != null).x((d) => x(toDate(d.ts))).y0(ih).y1((d) => y(d[lines[0].key])).curve(curveMonotoneX)(data)}
                style={{ fill: `url(#g${clipId}0)` }} />
            )}
            {paths.map((p, i) => p && (
              <path key={i + (animateKey || '')} d={p} className="series draw" pathLength={1}
                style={{ stroke: lines[i].color, strokeWidth: lines[i].width || 2, strokeDasharray: lines[i].dash, animationDelay: `${i * 80}ms` }} />
            ))}
          </g>

          {laneArea && (
            <g className="lane">
              <text x={-8} y={laneY + 11} textAnchor="end" className="tick">{laneLabel}</text>
              <rect x={0} y={laneY} width={iw} height={14} className="lane-bg" />
              <path d={laneArea} className="lane-fill" />
            </g>
          )}

          {/* last value label (direct label, no legend box needed) */}
          {lines.map((l, i) => {
            const last = [...data].reverse().find((d) => d[l.key] != null)
            if (!last || hd) return null
            return (
              <g key={'lv' + i} transform={`translate(${x(toDate(last.ts))},${y(last[l.key])})`} className="last-dot">
                <circle r={4} style={{ fill: l.color }} />
                <circle r={4} className="ping" style={{ stroke: l.color }} />
              </g>
            )
          })}

          {hd && (
            <g className="crosshair">
              <line x1={hx} x2={hx} y1={0} y2={ih} />
              {lines.map((l, i) => hd[l.key] != null && (
                <circle key={i} cx={hx} cy={y(hd[l.key])} r={4.5} style={{ fill: l.color }} />
              ))}
            </g>
          )}
          <rect width={iw} height={ih + (lane ? 40 : 0)} fill="transparent"
            onPointerMove={move} onPointerDown={move} onPointerLeave={() => onHover?.(null)} style={{ touchAction: 'pan-y' }} />
        </g>
      </svg>
      {hd && (
        <div className="tooltip" style={{ left: tipFlip ? undefined : tipLeft, right: tipFlip ? width - (m.l + hx) + 14 : undefined, top: 8 }}>
          <div className="tt-time">{fullTime(hd.ts)}</div>
          {lines.map((l, i) => hd[l.key] != null && (
            <div key={i} className="tt-row">
              <span className="sw" style={{ background: l.color }} />
              <span>{l.label}</span>
              <b>{fmt(hd[l.key])}{unit}</b>
            </div>
          ))}
          {band && hd[band.lo] != null && (
            <div className="tt-row muted"><span className="sw band-sw" style={{ background: band.color }} /><span>range</span><b>{fmt(hd[band.lo])}–{fmt(hd[band.hi])}{unit}</b></div>
          )}
        </div>
      )}
    </div>
  )
}
