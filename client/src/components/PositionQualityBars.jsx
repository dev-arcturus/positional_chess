import React from 'react';

// Position-strength bars across the heads of the static evaluator —
// space, piece activity, king safety, structure, threats, line control.
//
// **Not** material balance: that's already shown by the eval bar. These
// bars decompose the *non-material* component of the eval so the user
// can answer "why is the position good for white?" beyond the score.
//
// Each bar is bipolar: -100..+100, where +100 means "this category
// strongly favours white." We map directly from the explanation blob's
// per-head deltas (white − black) and rescale.
//
// Props:
//   explanation : the result of `explainPosition(fen)` — see
//                 engine-rs/src/explanation.rs::Explanation.

const HEAD_LABELS = [
  // [key in eval_breakdown, display label, scale (cp → 0..100)]
  // The scale is "what counts as a definitive lead in this category" —
  // anything past it pegs at ±100. Tuned by eyeballing typical game
  // positions in the analyzer.
  ['psqt_cp',        'Activity',     150],
  ['mobility_cp',    'Mobility',     150],
  ['king_safety_cp', 'King safety',  120],
  ['threats_cp',     'Threats',       80],
  ['pawns_cp',       'Structure',    100],
  ['imbalance_cp',   'Imbalance',     60],
];

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function ScoreBar({ label, value, max }) {
  // value > 0 → white side; value < 0 → black side. Bar fills outward
  // from a center divider, in white or dark zinc.
  const pct = clamp(value / max, -1, 1);
  const half = Math.abs(pct) * 50;
  const isWhite = pct >= 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px' }}>
      <span style={{
        width: '78px',
        color: '#a1a1aa',
        fontWeight: 600,
        letterSpacing: '0.02em',
      }}>{label}</span>
      <div style={{
        position: 'relative',
        flex: 1,
        height: '8px',
        backgroundColor: '#0f0f12',
        borderRadius: '999px',
        border: '1px solid #27272a',
        overflow: 'hidden',
      }}>
        {/* Center tick at 50% */}
        <div style={{
          position: 'absolute',
          left: '50%', top: 0, bottom: 0, width: '1px',
          backgroundColor: '#3f3f46',
        }} />
        {/* Fill */}
        <div style={{
          position: 'absolute',
          [isWhite ? 'left' : 'right']: '50%',
          top: 0, bottom: 0,
          width: `${half}%`,
          background: isWhite
            ? 'linear-gradient(90deg, #d4d4d8 0%, #ffffff 100%)'
            : 'linear-gradient(90deg, #18181b 0%, #3f3f46 100%)',
          transition: 'width 250ms ease-out',
        }} />
      </div>
      <span style={{
        width: '34px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '10px',
        color: isWhite ? '#e4e4e7' : '#a1a1aa',
        fontWeight: 700,
        textAlign: 'right',
        letterSpacing: '-0.02em',
      }}>
        {value > 0 ? '+' : ''}{(value / 100).toFixed(2)}
      </span>
    </div>
  );
}

export default function PositionQualityBars({ explanation }) {
  if (!explanation || !explanation.eval_breakdown) {
    return null;
  }
  const eb = explanation.eval_breakdown;

  return (
    <div style={{
      width: '100%',
      padding: '10px 14px',
      backgroundColor: '#0e0e10',
      border: '1px solid #27272a',
      borderRadius: '6px',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      backgroundImage: 'linear-gradient(180deg, #18181b 0%, #0e0e10 100%)',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: '2px',
        fontSize: '10px',
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: '#71717a',
        fontWeight: 700,
      }}>
        <span>Position quality</span>
        <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: '#52525b' }}>
          beyond material
        </span>
      </div>
      {HEAD_LABELS.map(([key, label, scale]) => (
        <ScoreBar key={key} label={label} value={eb[key] || 0} max={scale} />
      ))}
    </div>
  );
}
