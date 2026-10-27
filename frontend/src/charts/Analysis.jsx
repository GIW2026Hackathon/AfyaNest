import { mean } from 'd3-array'
import { scaleBand, scaleLinear, scaleSequential, scaleUtc } from 'd3-scale'
import { area, curveMonotoneX, line } from 'd3-shape'
import { interpolateRgb } from 'd3-interpolate'
import { useMemo, useState } from 'react'
import { NH3, thi } from '../lib/data'
import { useWidth } from '../lib/hooks'
import { fullTime, timeTicks, toDate } from './TimeSeries'

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888'

/* ------------------------------------------------------------------ Zone × time heatmap */
export function Heatmap({ rows, zoneNames, zoneLabel, hours }) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState(null)
  const bucketMin = hours <= 6 ? 10 : hours <= 24 ? 30 : hours <= 72 ? 60 : 180
  const cells = useMemo(() => {
    const out = new Map()
    for (const r of rows) {
      const b = Math.floor(r.ts / (bucketMin * 60)) * bucketMin * 60
      r.nodes.forEach((n, i) => {
        if (n?.nh3 == null) return
        const k = `${b}|${i}`
        const c = out.get(k) || { ts: b, node: i, vals: [] }
        c.vals.push(n.nh3)
        out.set(k, c)
      })
    }
    return [...out.values()].map((c) => ({ ...c, v: mean(c.vals) }))
  }, [rows, bucketMin])
  const m = { t: 8, r: 70, b: 26, l: 98 }
  const iw = Math.max(10, width - m.l - m.r)
  const rowH = 24
  const ih = rowH * zoneNames.length
  if (!cells.length) return <div className="empty" ref={ref}>No readings in this period.</div>
  const t0 = Math.min(...cells.map((c) => c.ts))
  const t1 = Math.max(...cells.map((c) => c.ts)) + bucketMin * 60
  const x = scaleUtc().domain([toDate(t0), toDate(t1)]).range([0, iw])
  const yb = scaleBand().domain(zoneNames.map((_, i) => i)).range([0, ih]).paddingInner(0.12)
  const color = scaleSequential(interpolateRgb(css('--heat-0'), css('--heat-1'))).domain([0, 35]).clamp(true)
  const cw = Math.max(1, x(toDate(t0 + bucketMin * 60)) - x(toDate(t0)) - 1)
  const legend = [0, 10, 20, 30]
  return (
    <div className="chart" ref={ref} style={{ height: ih + m.t + m.b + 34 }}>
      <svg width={width} height={ih + m.t + m.b + 34} role="img" aria-label="Ammonia by zone over time">
        <g transform={`translate(${m.l},${m.t})`}>
          {zoneNames.map((z, i) => (
            <text key={z} x={-10} y={yb(i) + yb.bandwidth() / 2} dy="0.32em" textAnchor="end" className="tick strong">{zoneLabel[z]}</text>
          ))}
          <g className="heat-cells">
            {cells.map((c, k) => (
              <rect key={k} x={x(toDate(c.ts))} y={yb(c.node)} width={cw} height={yb.bandwidth()} rx={2}
                style={{ fill: color(c.v), animationDelay: `${(x(toDate(c.ts)) / iw) * 500}ms` }}
                className={`cell ${c.v >= NH3.danger ? 'cell-danger' : ''}`}
                onPointerEnter={() => setHover(c)} onPointerLeave={() => setHover(null)} />
            ))}
          </g>
          {timeTicks(x, iw).map(({ d, label }) => (
            <text key={+d} x={x(d)} y={ih + 16} textAnchor="middle" className="tick">{label}</text>
          ))}
          {/* colour legend */}
          <g transform={`translate(0,${ih + 30})`}>
            <text x={-10} y={5} textAnchor="end" className="tick">ppm</text>
            {Array.from({ length: 36 }, (_, i) => (
              <rect key={i} x={i * 5} y={0} width={5} height={8} style={{ fill: color(i) }} />
            ))}
            {legend.map((v) => <text key={v} x={v * 5} y={20} textAnchor="middle" className="tick">{v}</text>)}
            <rect x={NH3.danger * 5} y={-2} width={1.5} height={12} className="legend-mark" />
            <text x={36 * 5 + 10} y={7} className="tick">outlined cells ≥ 25 ppm</text>
          </g>
        </g>
      </svg>
      {hover && (
        <div className="tooltip" style={{ left: Math.min(m.l + x(toDate(hover.ts)) + 12, width - 190), top: yb(hover.node) + m.t + 30 }}>
          <div className="tt-time">{fullTime(hover.ts)}</div>
          <div className="tt-row"><span className="sw" style={{ background: color(hover.v) }} /><span>{zoneLabel[zoneNames[hover.node]]}</span><b>{hover.v.toFixed(1)} ppm</b></div>
          <div className="tt-row muted"><span /><span>peak in bucket</span><b>{Math.max(...hover.vals).toFixed(1)}</b></div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ Hour-of-day profile */
export function Diurnal({ profile, color, unit, thresholds = [], comfort, height = 210 }) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState(null)
  const m = { t: 12, r: 16, b: 28, l: 38 }
  const iw = Math.max(10, width - m.l - m.r)
  const ih = height - m.t - m.b
  const pts = profile.filter((p) => p.p50 != null)
  if (!pts.length) return <div className="empty" ref={ref}>Not enough data yet.</div>
  const x = scaleLinear().domain([0, 23]).range([0, iw])
  const lo = Math.min(...pts.map((p) => p.p10), comfort ? comfort[0] : Infinity)
  const hi = Math.max(...pts.map((p) => p.p90), ...thresholds.map((t) => t.y), comfort ? comfort[1] : -Infinity)
  const y = scaleLinear().domain([Math.max(0, lo - (hi - lo) * 0.1), hi + (hi - lo) * 0.1]).nice().range([ih, 0])
  const b = area().x((d) => x(d.h)).y0((d) => y(d.p10)).y1((d) => y(d.p90)).curve(curveMonotoneX)(pts)
  const l = line().x((d) => x(d.h)).y((d) => y(d.p50)).curve(curveMonotoneX)(pts)
  const hp = hover != null ? pts.find((p) => p.h === hover) : null
  return (
    <div className="chart" ref={ref} style={{ height }}>
      <svg width={width} height={height} role="img" aria-label="Typical value by hour of day">
        <g transform={`translate(${m.l},${m.t})`}>
          <rect x={x(19)} width={iw - x(19)} height={ih} className="night" />
          <rect x={0} width={x(7)} height={ih} className="night" />
          <text x={x(3)} y={12} textAnchor="middle" className="tick night-label">night · curtains closed</text>
          {y.ticks(4).map((v) => (
            <g key={v} transform={`translate(0,${y(v)})`}>
              <line x2={iw} className="grid" />
              <text x={-8} dy="0.32em" textAnchor="end" className="tick">{v}</text>
            </g>
          ))}
          {comfort && <rect x={0} width={iw} y={y(comfort[1])} height={y(comfort[0]) - y(comfort[1])} className="comfort-band" />}
          {thresholds.map((t) => (
            <g key={t.y} transform={`translate(0,${y(t.y)})`} className={`thr thr-${t.tone}`}><line x2={iw} /></g>
          ))}
          {(iw < 420 ? [0, 6, 12, 18] : [0, 3, 6, 9, 12, 15, 18, 21]).map((h) => (
            <text key={h} x={x(h)} y={ih + 18} textAnchor="middle" className="tick">{String(h).padStart(2, '0')}:00</text>
          ))}
          <g className="reveal-x">
            <path d={b} className="band" style={{ fill: color }} />
            <path d={l} className="series draw" pathLength={1} style={{ stroke: color, strokeWidth: 2.2 }} />
          </g>
          {hp && (
            <g className="crosshair">
              <line x1={x(hp.h)} x2={x(hp.h)} y1={0} y2={ih} />
              <circle cx={x(hp.h)} cy={y(hp.p50)} r={4.5} style={{ fill: color }} />
            </g>
          )}
          <rect width={iw} height={ih} fill="transparent"
            onPointerMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setHover(Math.round(x.invert(e.clientX - r.left))) }}
            onPointerLeave={() => setHover(null)} />
        </g>
      </svg>
      {hp && (
        <div className="tooltip" style={{ left: Math.min(m.l + x(hp.h) + 12, width - 180), top: 6 }}>
          <div className="tt-time">{String(hp.h).padStart(2, '0')}:00 – {String(hp.h).padStart(2, '0')}:59</div>
          <div className="tt-row"><span className="sw" style={{ background: color }} /><span>typical</span><b>{hp.p50.toFixed(1)}{unit}</b></div>
          <div className="tt-row muted"><span /><span>most days</span><b>{hp.p10.toFixed(1)}–{hp.p90.toFixed(1)}</b></div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ Temperature × humidity comfort map */
export function ComfortMap({ series, comfort, height = 260 }) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState(null)
  const m = { t: 12, r: 18, b: 38, l: 44 }
  const iw = Math.max(10, width - m.l - m.r)
  const ih = height - m.t - m.b
  const pts = useMemo(() => {
    // hourly averages keep the plot readable
    const g = new Map()
    for (const s of series) {
      if (s.temp == null || s.rh == null) continue
      const k = Math.floor(s.ts / 3600)
      const a = g.get(k) || { ts: k * 3600, t: [], h: [], n: [] }
      a.t.push(s.temp); a.h.push(s.rh); if (s.nh3 != null) a.n.push(s.nh3)
      g.set(k, a)
    }
    return [...g.values()].map((a) => ({ ts: a.ts, temp: mean(a.t), rh: mean(a.h), nh3: a.n.length ? Math.max(...a.n) : null }))
  }, [series])
  if (!pts.length) return <div className="empty" ref={ref}>Not enough data yet.</div>
  const tx = [Math.min(comfort[0] - 3, ...pts.map((p) => p.temp)), Math.max(comfort[1] + 3, ...pts.map((p) => p.temp))]
  const x = scaleLinear().domain(tx).nice().range([0, iw])
  const y = scaleLinear().domain([30, 100]).range([ih, 0])
  const color = scaleSequential(interpolateRgb(css('--heat-0'), css('--heat-1'))).domain([0, 35]).clamp(true)
  // heat-stress line: THI where broilers begin to suffer (~ 78)
  const thiLine = []
  for (let rh = 30; rh <= 100; rh += 5) {
    const t = (78 - 46.4 + 0.144 * rh) / (0.8 + rh / 100)
    thiLine.push({ rh, t })
  }
  const tl = line().x((d) => x(d.t)).y((d) => y(d.rh))(thiLine.filter((d) => d.t >= x.domain()[0] && d.t <= x.domain()[1]))
  return (
    <div className="chart" ref={ref} style={{ height }}>
      <svg width={width} height={height} role="img" aria-label="Temperature against humidity, coloured by ammonia">
        <g transform={`translate(${m.l},${m.t})`}>
          {x.ticks(6).map((v) => (
            <g key={v} transform={`translate(${x(v)},0)`}>
              <line y2={ih} className="grid" />
              <text y={ih + 16} textAnchor="middle" className="tick">{v}°</text>
            </g>
          ))}
          {[40, 60, 80, 100].map((v) => (
            <g key={v} transform={`translate(0,${y(v)})`}>
              <line x2={iw} className="grid" />
              <text x={-8} dy="0.32em" textAnchor="end" className="tick">{v}%</text>
            </g>
          ))}
          <rect x={x(comfort[0])} width={x(comfort[1]) - x(comfort[0])} y={y(70)} height={y(50) - y(70)} rx={6} className="comfort-zone" />
          <text x={x(comfort[0]) + 6} y={y(70) + 14} className="tick comfort-label">ideal for this age</text>
          {tl && <path d={tl} className="thi-line" />}
          {tl && <text x={iw - 4} y={y(96)} textAnchor="end" className="tick thi-label">heat-stress line (THI 78)</text>}
          <text x={iw / 2} y={ih + 32} textAnchor="middle" className="tick">temperature, bird zones (°C)</text>
          {pts.map((p, i) => (
            <circle key={p.ts} cx={x(p.temp)} cy={y(p.rh)} r={hover === p ? 7 : 5}
              className="dot pop" style={{ fill: p.nh3 == null ? 'var(--c-temp)' : color(p.nh3), animationDelay: `${i * 8}ms` }}
              onPointerEnter={() => setHover(p)} onPointerLeave={() => setHover(null)} />
          ))}
        </g>
      </svg>
      {hover && (
        <div className="tooltip" style={{ left: Math.min(m.l + x(hover.temp) + 12, width - 190), top: Math.max(4, m.t + y(hover.rh) - 40) }}>
          <div className="tt-time">{fullTime(hover.ts)}</div>
          <div className="tt-row"><span className="sw" style={{ background: 'var(--c-temp)' }} /><span>Temperature</span><b>{hover.temp.toFixed(1)}°C</b></div>
          <div className="tt-row"><span className="sw" style={{ background: 'var(--c-rh)' }} /><span>Humidity</span><b>{hover.rh.toFixed(0)}%</b></div>
          {hover.nh3 != null && <div className="tt-row"><span className="sw" style={{ background: color(hover.nh3) }} /><span>Ammonia (worst)</span><b>{hover.nh3.toFixed(1)} ppm</b></div>}
          <div className="tt-row muted"><span /><span>THI</span><b>{thi(hover.temp, hover.rh).toFixed(0)}</b></div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ Hours above limits, per zone */
export function Exposure({ data, zoneNames, zoneLabel }) {
  const [ref, width] = useWidth()
  const m = { l: 98, r: 70 }
  const iw = Math.max(10, width - m.l - m.r)
  const max = Math.max(1, ...data.map((d) => d.warn + d.danger))
  const x = scaleLinear().domain([0, max]).nice().range([0, iw])
  const rowH = 30
  return (
    <div className="chart" ref={ref} style={{ height: data.length * rowH + 34 }}>
      <svg width={width} height={data.length * rowH + 34} role="img" aria-label="Hours above ammonia limits by zone">
        <g transform={`translate(${m.l},6)`}>
          {data.map((d, i) => (
            <g key={i} transform={`translate(0,${i * rowH})`}>
              <text x={-10} y={11} dy="0.32em" textAnchor="end" className="tick strong">{zoneLabel[zoneNames[d.node]]}</text>
              <rect x={0} y={2} width={iw} height={18} rx={4} className="bar-track" />
              {d.danger > 0 && <rect x={0} y={2} width={Math.max(4, x(d.danger))} height={18} rx={4} className="bar bar-danger grow" style={{ animationDelay: `${i * 60}ms` }} />}
              {d.warn > 0 && <rect x={x(d.danger) + (d.danger > 0 ? 2 : 0)} y={2} width={Math.max(4, x(d.warn))} height={18} rx={4} className="bar bar-warn grow" style={{ animationDelay: `${i * 60 + 120}ms` }} />}
              <text x={iw + 8} y={11} dy="0.32em" className="tick strong">{(d.warn + d.danger).toFixed(1)} h</text>
            </g>
          ))}
          <g transform={`translate(0,${data.length * rowH + 8})`} className="legend-row">
            <rect width={10} height={10} rx={2} className="bar-danger" /><text x={16} y={9} className="tick">≥ 25 ppm (danger)</text>
            <rect x={140} width={10} height={10} rx={2} className="bar-warn" /><text x={156} y={9} className="tick">20–25 ppm (warning)</text>
          </g>
        </g>
      </svg>
    </div>
  )
}
