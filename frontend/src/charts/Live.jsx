import { extent } from 'd3-array'
import { scaleLinear } from 'd3-scale'
import { arc, area, curveMonotoneX, line } from 'd3-shape'
import { useId, useMemo, useState } from 'react'
import { NH3 } from '../lib/data'
import { useCountUp, useWidth } from '../lib/hooks'

/* ------------------------------------------------------------------ Sparkline */
export function Sparkline({ data, width = 132, height = 36, color = 'var(--c-nh3)', k = 'nh3' }) {
  const id = useId().replace(/:/g, '')
  const pts = data.filter((d) => d[k] != null)
  if (pts.length < 2) return <svg width={width} height={height} />
  const x = scaleLinear().domain(extent(pts, (d) => d.ts)).range([2, width - 4])
  const vals = pts.map((d) => d[k])
  const y = k === 'nh3'
    ? scaleLinear().domain([0, Math.max(30, ...vals)]).range([height - 2, 3])
    : scaleLinear().domain([Math.min(...vals) - 1, Math.max(...vals) + 1]).range([height - 2, 3])
  const l = line().x((d) => x(d.ts)).y((d) => y(d[k])).curve(curveMonotoneX)(pts)
  const a = area().x((d) => x(d.ts)).y0(height).y1((d) => y(d[k])).curve(curveMonotoneX)(pts)
  const last = pts[pts.length - 1]
  return (
    <svg width={width} height={height} className="spark" aria-hidden="true">
      <defs>
        <linearGradient id={`s${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" style={{ stopColor: color, stopOpacity: 0.35 }} />
          <stop offset="1" style={{ stopColor: color, stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      {k === 'nh3' && <line x1={0} x2={width} y1={y(NH3.danger)} y2={y(NH3.danger)} className="spark-thr" />}
      <path d={a} style={{ fill: `url(#s${id})` }} className="fade-in" />
      <path d={l} className="series draw" pathLength={1} style={{ stroke: color, strokeWidth: 1.6 }} />
      <circle cx={x(last.ts)} cy={y(last[k])} r={2.6} style={{ fill: color }} />
    </svg>
  )
}

/* ------------------------------------------------------------------ Gauge */
const SEGS = [
  { from: 0, to: NH3.target, tone: 'good' },
  { from: NH3.target, to: NH3.warn, tone: 'watch' },
  { from: NH3.warn, to: NH3.danger, tone: 'warn' },
  { from: NH3.danger, to: 40, tone: 'danger' },
]
export function Gauge({ value, max = 40, label = 'ppm', size = 210 }) {
  const v = useCountUp(value ?? 0, 1200)
  const r = size / 2 - 10
  const a = scaleLinear().domain([0, max]).range([-Math.PI * 0.75, Math.PI * 0.75]).clamp(true)
  const seg = arc().innerRadius(r - 12).outerRadius(r).cornerRadius(3).padAngle(0.025)
  const needle = a(v)
  const ticks = [0, 10, 15, 20, 25, 30, 40]
  return (
    <div className="gauge" style={{ width: size, height: size * 0.82 }}>
      <svg width={size} height={size * 0.82} role="img" aria-label={`Ammonia ${value?.toFixed(1)} ppm`}>
        <g transform={`translate(${size / 2},${size / 2})`}>
          <path d={arc().innerRadius(r - 12).outerRadius(r).startAngle(-Math.PI * 0.75).endAngle(Math.PI * 0.75)()} className="gauge-track" />
          {SEGS.map((s) => (
            <path key={s.tone} d={seg({ startAngle: a(s.from), endAngle: a(s.to) })} className={`gauge-seg tone-${s.tone}`} />
          ))}
          {ticks.map((t) => {
            const ang = a(t) - Math.PI / 2
            return (
              <text key={t} x={Math.cos(ang) * (r - 26)} y={Math.sin(ang) * (r - 26)} dy="0.35em" textAnchor="middle" className="tick">{t}</text>
            )
          })}
          <g style={{ transform: `rotate(${(needle * 180) / Math.PI}deg)` }} className="needle">
            <path d={`M -4 0 L 0 ${-(r - 18)} L 4 0 Z`} />
            <circle r={7} />
          </g>
        </g>
      </svg>
      <div className="gauge-value">
        <span className="num">{value == null ? '—' : v.toFixed(1)}</span>
        <span className="unit">{label}</span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ Forecast fan chart */
export function ForecastChart({ forecast, nowValue, t, height = 230 }) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState(null)
  const m = { t: 16, r: 92, b: 30, l: 38 }
  const iw = Math.max(10, width - m.l - m.r)
  const ih = height - m.t - m.b
  const rows = useMemo(() => {
    if (!forecast) return []
    const sq = forecast.status_quo
    const pl = forecast.plan
    const head = { h: 0, sq10: nowValue, sq50: nowValue, sq90: nowValue, pl10: nowValue, pl50: nowValue, pl90: nowValue }
    return [head, ...forecast.hours.map((h, i) => ({
      h, sq10: sq.nh3_p10[i], sq50: sq.nh3_p50[i], sq90: sq.nh3_p90[i], pl10: pl.nh3_p10[i], pl50: pl.nh3_p50[i], pl90: pl.nh3_p90[i],
    }))]
  }, [forecast, nowValue])
  if (!rows.length) return <div className="empty">The forecast appears after 3 hours of data.</div>
  const x = scaleLinear().domain([0, 6]).range([0, iw])
  const hi = Math.max(NH3.danger * 1.15, ...rows.map((r) => r.sq90 ?? 0))
  const y = scaleLinear().domain([0, hi]).nice().range([ih, 0])
  const band = (lo, hi_) => area().x((d) => x(d.h)).y0((d) => y(d[lo])).y1((d) => y(d[hi_])).curve(curveMonotoneX)(rows)
  const ln = (k) => line().x((d) => x(d.h)).y((d) => y(d[k])).curve(curveMonotoneX)(rows)
  const last = rows[rows.length - 1]
  const hr = hover != null ? rows.reduce((b, r) => (Math.abs(r.h - hover) < Math.abs(b.h - hover) ? r : b), rows[0]) : null
  return (
    <div className="chart" ref={ref} style={{ height }}>
      <svg width={width} height={height} role="img" aria-label="Ammonia forecast for the next 6 hours">
        <g transform={`translate(${m.l},${m.t})`}>
          {y.ticks(5).map((v) => (
            <g key={v} transform={`translate(0,${y(v)})`}>
              <line x2={iw} className="grid" />
              <text x={-8} dy="0.32em" textAnchor="end" className="tick">{v}</text>
            </g>
          ))}
          <rect x={0} width={iw} y={0} height={y(NH3.danger)} className="danger-zone" />
          {[{ v: NH3.warn, tone: 'warn', l: '20 warn' }, { v: NH3.danger, tone: 'danger', l: '25 danger' }].map((th) => (
            <g key={th.v} transform={`translate(0,${y(th.v)})`} className={`thr thr-${th.tone}`}>
              <line x2={iw} />
            </g>
          ))}
          {[0, 1, 2, 3, 4, 5, 6].map((h) => (
            <text key={h} x={x(h)} y={ih + 18} textAnchor="middle" className="tick">{h === 0 ? t.now : `+${h}h`}</text>
          ))}
          <line x1={0} x2={iw} y1={ih} y2={ih} className="axis" />
          <g className="reveal-x">
            <path d={band('sq10', 'sq90')} className="fc-band fc-sq" />
            <path d={band('pl10', 'pl90')} className="fc-band fc-plan" />
            <path d={ln('sq50')} className="series draw fc-line-sq" pathLength={1} />
            <path d={ln('pl50')} className="series draw fc-line-plan" pathLength={1} style={{ animationDelay: '250ms' }} />
          </g>
          <circle cx={0} cy={y(nowValue ?? 0)} r={5} className="now-dot" />
          {/* direct labels */}
          <g transform={`translate(${iw + 8},${y(last.sq50)})`} className="dl">
            <text dy="0.32em" className="dl-sq">{last.sq50?.toFixed(0)} ppm</text>
            <text dy="1.5em" className="dl-sub">{t.ifNothing}</text>
          </g>
          <g transform={`translate(${iw + 8},${Math.min(ih - 8, Math.max(y(last.pl50), y(last.sq50) + 34))})`} className="dl">
            <text dy="0.32em" className="dl-plan">{last.pl50?.toFixed(0)} ppm</text>
            <text dy="1.5em" className="dl-sub">{t.ifFollow}</text>
          </g>
          {hr && (
            <g className="crosshair">
              <line x1={x(hr.h)} x2={x(hr.h)} y1={0} y2={ih} />
              <circle cx={x(hr.h)} cy={y(hr.sq50)} r={4.5} className="fc-dot-sq" />
              <circle cx={x(hr.h)} cy={y(hr.pl50)} r={4.5} className="fc-dot-plan" />
            </g>
          )}
          <rect width={iw} height={ih} fill="transparent"
            onPointerMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setHover(x.invert(e.clientX - r.left)) }}
            onPointerLeave={() => setHover(null)} />
        </g>
      </svg>
      {hr && (
        <div className="tooltip" style={{ left: Math.min(m.l + x(hr.h) + 12, width - 200), top: 6 }}>
          <div className="tt-time">{hr.h === 0 ? 'Now' : `In ${hr.h.toFixed(1)} h`}</div>
          <div className="tt-row"><span className="sw" style={{ background: 'var(--critical)' }} /><span>{t.ifNothing}</span><b>{hr.sq50?.toFixed(1)} ppm</b></div>
          <div className="tt-row muted"><span /><span>likely range</span><b>{hr.sq10?.toFixed(0)}–{hr.sq90?.toFixed(0)}</b></div>
          <div className="tt-row"><span className="sw" style={{ background: 'var(--good)' }} /><span>{t.ifFollow}</span><b>{hr.pl50?.toFixed(1)} ppm</b></div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ Floor map */
export function FloorMap({ nodes, latest, zoneLabel, onPick, picked, metric = 'nh3', comfort = [18, 24] }) {
  const [ref, width] = useWidth()
  const H = Math.max(150, Math.min(220, width * 0.3))
  const pad = 28
  const x = scaleLinear().domain([0, 30]).range([pad, width - pad])
  const y = scaleLinear().domain([0, 8]).range([pad, H - pad])
  return (
    <div className="floormap" ref={ref}>
      <svg width={width} height={H} role="img" aria-label="Poultry house map with sensor readings">
        <defs>
          <pattern id="litter" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="8" className="litter-line" />
          </pattern>
        </defs>
        <rect x={x(0)} y={y(0)} width={x(30) - x(0)} height={y(8) - y(0)} rx={10} className="house-floor" />
        <rect x={x(0)} y={y(0)} width={x(30) - x(0)} height={y(8) - y(0)} rx={10} fill="url(#litter)" />
        <line x1={x(0)} x2={x(0)} y1={y(0.6)} y2={y(7.4)} className="house-curtain" />
        <text x={x(0) - 8} y={y(4)} className="tick" textAnchor="middle" transform={`rotate(-90 ${x(0) - 8} ${y(4)})`}>brooder end</text>
        <text x={x(30) + 10} y={y(4)} className="tick" textAnchor="middle" transform={`rotate(90 ${x(30) + 10} ${y(4)})`}>fan end</text>
        {nodes.map((n) => {
          const v = latest?.[n.id]
          const off = v == null ? 0 : Math.max(comfort[0] - v, v - comfort[1], 0)
          const tone = v == null ? 'none' : metric === 'temp'
            ? (off >= 6 ? 'danger' : off >= 3 ? 'warn' : off > 0 ? 'watch' : 'good')
            : v >= NH3.danger ? 'danger' : v >= NH3.warn ? 'warn' : v >= NH3.target ? 'watch' : 'good'
          const r = metric === 'temp' ? (v == null ? 9 : 15) : 9 + Math.min(14, (v ?? 0) * 0.45)
          return (
            <g key={n.id} transform={`translate(${x(n.x)},${y(n.y)})`} className={`node tone-${tone} ${picked === n.id ? 'picked' : ''}`}
              onClick={() => onPick?.(n.id)} role="button" tabIndex={0} aria-label={`${zoneLabel[n.name]} ${v?.toFixed(1) ?? 'no data'} ${metric === 'temp' ? '°C' : 'ppm'}`}>
              {(tone === 'warn' || tone === 'danger') && <circle r={r} className="node-pulse" />}
              <circle r={r} className="node-dot" />
              <text y={-r - 8} textAnchor="middle" className="node-label">{zoneLabel[n.name]}</text>
              <text dy="0.35em" textAnchor="middle" className="node-val">{v == null ? '–' : metric === 'temp' ? `${v.toFixed(0)}°` : v.toFixed(0)}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/* ------------------------------------------------------------------ Temperature vs comfort band */
export function ComfortBar({ value, comfort }) {
  const [ref, width] = useWidth()
  const v = useCountUp(value ?? 0, 1200)
  const lo = Math.min(10, comfort[0] - 6)
  const hi = Math.max(40, comfort[1] + 6)
  const x = scaleLinear().domain([lo, hi]).range([12, width - 12]).clamp(true)
  return (
    <div className="comfort-bar" ref={ref}>
      <svg width={width} height={58} role="img" aria-label={`Temperature ${value?.toFixed(1)} °C, comfort ${comfort[0]} to ${comfort[1]} °C`}>
        <rect x={x(lo)} y={18} width={x(hi) - x(lo)} height={12} rx={6} className="cb-track" />
        <rect x={x(comfort[0] - 3)} y={18} width={x(comfort[0]) - x(comfort[0] - 3)} height={12} className="gauge-seg tone-warn" />
        <rect x={x(comfort[1])} y={18} width={x(comfort[1] + 3) - x(comfort[1])} height={12} className="gauge-seg tone-warn" />
        <rect x={x(comfort[0])} y={18} width={x(comfort[1]) - x(comfort[0])} height={12} className="cb-band" />
        {[lo, comfort[0], comfort[1], hi].map((t) => <text key={t} x={x(t)} y={48} textAnchor="middle" className="tick">{Math.round(t)}°</text>)}
        {value != null && (
          <g className="cb-marker" style={{ transform: `translateX(${x(v)}px)` }}>
            <line y1={8} y2={40} />
            <circle cy={24} r={8} />
          </g>
        )}
      </svg>
    </div>
  )
}

export function TempForecast({ forecast, now, comfort, t, height = 230 }) {
  const [ref, width] = useWidth()
  const m = { t: 16, r: 70, b: 30, l: 38 }
  const iw = Math.max(10, width - m.l - m.r)
  const ih = height - m.t - m.b
  if (!forecast) return <div className="empty" ref={ref}>The forecast appears after 3 hours of data.</div>
  const sq = forecast.status_quo
  const rows = [{ h: 0, lo: now, hi: now }, ...forecast.hours.map((h, i) => ({ h, lo: sq.temp_min[i], hi: sq.temp_max[i] }))].filter((r) => r.lo != null)
  const all = rows.flatMap((r) => [r.lo, r.hi]).concat(comfort)
  const x = scaleLinear().domain([0, 6]).range([0, iw])
  const y = scaleLinear().domain([Math.min(...all) - 2, Math.max(...all) + 2]).nice().range([ih, 0])
  const band = area().x((d) => x(d.h)).y0((d) => y(d.lo)).y1((d) => y(d.hi)).curve(curveMonotoneX)(rows)
  const mid = line().x((d) => x(d.h)).y((d) => y((d.lo + d.hi) / 2)).curve(curveMonotoneX)(rows)
  const last = rows[rows.length - 1]
  return (
    <div className="chart" ref={ref} style={{ height }}>
      <svg width={width} height={height} role="img" aria-label="Temperature forecast for the next 6 hours">
        <g transform={`translate(${m.l},${m.t})`}>
          {y.ticks(5).map((v) => (
            <g key={v} transform={`translate(0,${y(v)})`}><line x2={iw} className="grid" /><text x={-8} dy="0.32em" textAnchor="end" className="tick">{v}°</text></g>
          ))}
          <rect x={0} width={iw} y={y(comfort[1])} height={y(comfort[0]) - y(comfort[1])} className="comfort-band" />
          <text x={iw + 6} y={y(comfort[1]) + 10} className="tick comfort-label">comfort</text>
          {[0, 1, 2, 3, 4, 5, 6].map((h) => <text key={h} x={x(h)} y={ih + 18} textAnchor="middle" className="tick">{h === 0 ? t.now : `+${h}h`}</text>)}
          <g className="reveal-x">
            <path d={band} className="band" style={{ fill: 'var(--c-temp)', opacity: 0.25 }} />
            <path d={mid} className="series draw" pathLength={1} style={{ stroke: 'var(--c-temp)', strokeWidth: 2.4 }} />
          </g>
          <circle cx={0} cy={y(now)} r={5} className="now-dot" />
          <text x={iw + 6} y={y((last.lo + last.hi) / 2)} dy="0.32em" className="dl-plan" style={{ fill: 'var(--c-temp)' }}>{((last.lo + last.hi) / 2).toFixed(1)}°</text>
        </g>
      </svg>
    </div>
  )
}

/* ------------------------------------------------------------------ Ring gauge (one per measure) */
// 270° ring; coloured outer band shows the safe/watch/warn/danger zones for this measure.
export function RingGauge({ value, min, max, bands = [], unit, digits = 1, size = 230, footer, label }) {
  const id = useId().replace(/:/g, '')
  const v = useCountUp(value ?? min, 1300)
  const r = size / 2 - 22
  const a = scaleLinear().domain([min, max]).range([-Math.PI * 0.75, Math.PI * 0.75]).clamp(true)
  const track = arc().innerRadius(r - 13).outerRadius(r).cornerRadius(8)
  const band = arc().innerRadius(r + 6).outerRadius(r + 10)
  const ang = a(v)
  const tip = [Math.sin(ang) * (r - 6.5), -Math.cos(ang) * (r - 6.5)]
  const ticks = [min, max]
  const h = size * 0.86
  return (
    <div className="ring" style={{ width: size, height: h }}>
      <svg width={size} height={h} role="img" aria-label={`${label}: ${value == null ? 'no data' : value.toFixed(digits)} ${unit}`}>
        <defs>
          <linearGradient id={`rg${id}`} x1="0" x2="1" y1="1" y2="0">
            <stop offset="0" style={{ stopColor: 'var(--mc)', stopOpacity: 0.35 }} />
            <stop offset="1" style={{ stopColor: 'var(--mc)', stopOpacity: 1 }} />
          </linearGradient>
        </defs>
        <g transform={`translate(${size / 2},${size / 2})`}>
          <path d={track({ startAngle: a(min), endAngle: a(max) })} className="ring-track" style={{ fill: 'var(--panel-3)' }} />
          {bands.map((b, i) => (
            <path key={i} d={band({ startAngle: a(b.from), endAngle: a(b.to) })} className={`ring-band tone-${b.tone}`} style={{ fill: `var(--${b.tone === 'good' ? 'good' : b.tone === 'watch' ? 'warning' : b.tone === 'warn' ? 'serious' : 'critical'})` }} />
          ))}
          {value != null && (
            <path d={track({ startAngle: a(min), endAngle: ang })} style={{ fill: `url(#rg${id})` }} className="ring-arc" />
          )}
          {ticks.map((tk) => {
            const t2 = a(tk)
            return (
              <text key={tk} x={Math.sin(t2) * (r + 4)} y={-Math.cos(t2) * (r + 4) + 16} dy="0.35em" textAnchor="middle" className="ring-scale">{Math.round(tk)}</text>
            )
          })}
          {value != null && <circle cx={tip[0]} cy={tip[1]} r={7} className="ring-dot" />}
        </g>
      </svg>
      <div className="ring-center">
        <span className="rv">{value == null ? '—' : v.toFixed(digits)}</span>
        <span className="ru">{unit}</span>
      </div>
      {footer && <span className="rf">{footer}</span>}
    </div>
  )
}

/* ------------------------------------------------------------------ Projection chart (e.g. humidity trend) */
export function ProjectionChart({ points, now, comfort, unit, color, label, height = 230 }) {
  const [ref, width] = useWidth()
  const m = { t: 16, r: 64, b: 30, l: 38 }
  const iw = Math.max(10, width - m.l - m.r)
  const ih = height - m.t - m.b
  if (!points?.length || now == null) return <div className="empty" ref={ref}>Not enough recent data to project.</div>
  const rows = [{ h: 0, lo: now, mid: now, hi: now }, ...points]
  const all = rows.flatMap((r) => [r.lo, r.hi]).concat(comfort || [])
  const x = scaleLinear().domain([0, 6]).range([0, iw])
  const y = scaleLinear().domain([Math.min(...all) - 3, Math.max(...all) + 3]).nice().range([ih, 0])
  const band = area().x((d) => x(d.h)).y0((d) => y(d.lo)).y1((d) => y(d.hi)).curve(curveMonotoneX)(rows)
  const mid = line().x((d) => x(d.h)).y((d) => y(d.mid)).curve(curveMonotoneX)(rows)
  const last = rows[rows.length - 1]
  return (
    <div className="chart" ref={ref} style={{ height }}>
      <svg width={width} height={height} role="img" aria-label={`${label} projection for the next 6 hours`}>
        <g transform={`translate(${m.l},${m.t})`}>
          {y.ticks(5).map((v) => (
            <g key={v} transform={`translate(0,${y(v)})`}><line x2={iw} className="grid" /><text x={-8} dy="0.32em" textAnchor="end" className="tick">{v}</text></g>
          ))}
          {comfort && <rect x={0} width={iw} y={y(comfort[1])} height={Math.max(0, y(comfort[0]) - y(comfort[1]))} className="comfort-band" />}
          {[0, 1, 2, 3, 4, 5, 6].map((hh) => <text key={hh} x={x(hh)} y={ih + 18} textAnchor="middle" className="tick">{hh === 0 ? 'now' : `+${hh}h`}</text>)}
          <g className="reveal-x">
            <path d={band} className="band" style={{ fill: color, opacity: 0.22 }} />
            <path d={mid} className="series draw" pathLength={1} style={{ stroke: color, strokeWidth: 2.4, strokeDasharray: undefined }} />
          </g>
          <circle cx={0} cy={y(now)} r={5} className="now-dot" />
          <text x={iw + 6} y={y(last.mid)} dy="0.32em" style={{ fill: color, fontFamily: 'var(--mono)', fontWeight: 600, fontSize: 13 }}>{last.mid.toFixed(0)}{unit}</text>
        </g>
      </svg>
    </div>
  )
}
