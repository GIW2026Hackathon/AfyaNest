/**
 * AmmoniaGauge
 *
 * Displays a horizontal progress bar showing the current NH₃ concentration
 * with a large ppm value, colour-coded zones and a live simulation.
 *
 * Simulation behaviour
 * ─────────────────────
 *  0–60 s  : stable low reading (starts at SCALE.start, small noise)
 *  60 s+   : smooth upward drift until it reaches SCALE.max
 *
 * To swap in real sensor data later, pass a `livePpm` prop (number | null).
 * When `livePpm` is provided the simulation stops and the component renders
 * the real value instead — no other change is needed.
 *
 * Thresholds are configured once at the top of this file.
 */

import { useEffect, useRef, useState } from 'react';

// ─── Configurable thresholds & scale ────────────────────────────────────────
// Adjust these to match your validated poultry-house safety limits.

const THRESHOLDS = {
  warning: 20,   // ppm — amber zone starts here
  danger:  35,   // ppm — red zone starts here
};

const SCALE = {
  min:   0,    // bar left edge (ppm)
  max:   60,   // bar right edge (ppm)
  start: 2,    // simulation starting value (ppm)
};

// Simulation timing
const STABLE_DURATION_MS = 60_000;   // stay low for this long
const TICK_MS            = 250;      // update interval
const RISE_PER_TICK      = 0.08;     // ppm added per tick during rising phase
const NOISE_AMPLITUDE    = 0.12;     // random ±noise in both phases

// ─── Helpers ────────────────────────────────────────────────────────────────

function getZone(ppm) {
  if (ppm >= THRESHOLDS.danger)  return 'danger';
  if (ppm >= THRESHOLDS.warning) return 'warning';
  return 'normal';
}

const ZONE_COLOR = {
  normal:  '#16A34A',
  warning: '#EAB308',
  danger:  '#DC2626',
};

const ZONE_LABEL = {
  normal:  'NORMAL',
  warning: 'WARNING',
  danger:  'DANGER',
};

const ZONE_BG = {
  normal:  '#F0FDF4',
  warning: '#FEFCE8',
  danger:  '#FEF2F2',
};

const ZONE_BORDER = {
  normal:  '#BBF7D0',
  warning: '#FDE68A',
  danger:  '#FECACA',
};

/** Clamp a value between lo and hi */
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/** Map ppm → 0–100 % width for the progress bar */
function toPercent(ppm) {
  return clamp(((ppm - SCALE.min) / (SCALE.max - SCALE.min)) * 100, 0, 100);
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * @param {{ livePpm?: number | null, className?: string }} props
 *   livePpm — real sensor value in ppm; when supplied the simulation halts.
 */
export default function AmmoniaGauge({ livePpm = null, className = '' }) {
  const [simPpm, setSimPpm]     = useState(SCALE.start);
  const startTimeRef            = useRef(Date.now());
  const currentPpmRef           = useRef(SCALE.start);
  const timerRef                = useRef(null);

  // Run simulation only when no live value is provided
  useEffect(() => {
    if (livePpm !== null) return; // real data takes over

    startTimeRef.current  = Date.now();
    currentPpmRef.current = SCALE.start;
    setSimPpm(SCALE.start);

    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      const noise   = (Math.random() - 0.5) * 2 * NOISE_AMPLITUDE;

      let next;
      if (elapsed < STABLE_DURATION_MS) {
        // Stable low phase — tiny noise only
        next = clamp(currentPpmRef.current + noise, SCALE.min, THRESHOLDS.warning - 0.1);
      } else {
        // Rising phase — add drift plus noise
        next = currentPpmRef.current + RISE_PER_TICK + noise;
        if (next >= SCALE.max) {
          // Reset to start once it hits the ceiling (loop for continuous demo)
          next = SCALE.start;
          startTimeRef.current = Date.now();
        }
      }

      currentPpmRef.current = next;
      setSimPpm(parseFloat(next.toFixed(1)));
    }, TICK_MS);

    return () => clearInterval(timerRef.current);
  }, [livePpm]);

  const displayPpm = livePpm !== null ? livePpm : simPpm;
  const isLive     = livePpm !== null;
  const zone       = getZone(displayPpm);
  const barWidth   = toPercent(displayPpm);
  const barColor   = ZONE_COLOR[zone];
  const zoneBg     = ZONE_BG[zone];
  const zoneBorder = ZONE_BORDER[zone];

  // Zone marker positions as % of bar width
  const warnPct   = toPercent(THRESHOLDS.warning);
  const dangerPct = toPercent(THRESHOLDS.danger);

  return (
    <div className={`nh3-gauge ${className}`} role="region" aria-label="Ammonia concentration gauge">

      {/* ── Header row ── */}
      <div className="nh3-gauge__header">
        <div>
          <div className="nh3-gauge__sublabel">AMMONIA CONCENTRATION (NH₃)</div>
          <div className="nh3-gauge__value" style={{ color: barColor }}>
            {displayPpm.toFixed(1)}
            <span className="nh3-gauge__unit">ppm</span>
          </div>
        </div>

        <div className="nh3-gauge__status-block" style={{ background: zoneBg, border: `1px solid ${zoneBorder}` }}>
          <div className="nh3-gauge__status-dot" style={{ background: barColor }} />
          <span className="nh3-gauge__status-text" style={{ color: barColor }}>
            {ZONE_LABEL[zone]}
          </span>
          {!isLive && (
            <span className="nh3-gauge__sim-pill">SIMULATED</span>
          )}
        </div>
      </div>

      {/* ── Progress bar ── */}
      <div className="nh3-gauge__bar-wrap" aria-label={`${displayPpm.toFixed(1)} ppm, ${ZONE_LABEL[zone]}`}>
        {/* Track */}
        <div className="nh3-gauge__track">
          {/* Filled portion */}
          <div
            className="nh3-gauge__fill"
            style={{ width: `${barWidth}%`, background: barColor }}
          />
          {/* Warning threshold marker */}
          <div
            className="nh3-gauge__marker"
            style={{ left: `${warnPct}%`, borderColor: ZONE_COLOR.warning }}
            aria-hidden="true"
          >
            <div className="nh3-gauge__marker-line" style={{ background: ZONE_COLOR.warning }} />
          </div>
          {/* Danger threshold marker */}
          <div
            className="nh3-gauge__marker"
            style={{ left: `${dangerPct}%`, borderColor: ZONE_COLOR.danger }}
            aria-hidden="true"
          >
            <div className="nh3-gauge__marker-line" style={{ background: ZONE_COLOR.danger }} />
          </div>
        </div>

        {/* Scale labels */}
        <div className="nh3-gauge__scale">
          <span>{SCALE.min} ppm</span>
          <span>{SCALE.max} ppm</span>
        </div>
      </div>

      {/* ── Zone legend ── */}
      <div className="nh3-gauge__legend" aria-label="Concentration zones">
        <div className="nh3-gauge__zone nh3-gauge__zone--normal">
          <span className="nh3-gauge__zone-swatch" style={{ background: ZONE_COLOR.normal }} />
          <span>Normal</span>
          <span className="nh3-gauge__zone-range">&lt; {THRESHOLDS.warning} ppm</span>
        </div>
        <div className="nh3-gauge__zone nh3-gauge__zone--warning">
          <span className="nh3-gauge__zone-swatch" style={{ background: ZONE_COLOR.warning }} />
          <span>Warning</span>
          <span className="nh3-gauge__zone-range">{THRESHOLDS.warning}–{THRESHOLDS.danger} ppm</span>
        </div>
        <div className="nh3-gauge__zone nh3-gauge__zone--danger">
          <span className="nh3-gauge__zone-swatch" style={{ background: ZONE_COLOR.danger }} />
          <span>Danger</span>
          <span className="nh3-gauge__zone-range">&gt; {THRESHOLDS.danger} ppm</span>
        </div>
      </div>

    </div>
  );
}
