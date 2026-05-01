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
      {/* Only show the magnitude with a `+`; the bar's fill direction
          already encodes which side leads, so the sign is redundant
          (and the user explicitly didn't want minus signs). */}
      <span style={{
        width: '34px',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '10px',
        color: isWhite ? '#e4e4e7' : '#a1a1aa',
        fontWeight: 700,
        textAlign: 'right',
        letterSpacing: '-0.02em',
      }}>
        {Math.abs(value) >= 1 ? `+${(Math.abs(value) / 100).toFixed(2)}` : '0.00'}
      </span>
    </div>
  );
}

export default function PositionQualityBars({ explanation }) {
  if (!explanation || !explanation.eval_breakdown) {
    return null;
  }
  const eb = explanation.eval_breakdown;
  const attack = explanation.king_safety?.engine_attack_potential;
  const plan = explanation.principal_plan;

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

      {/* Engine-driven attack potential — shows the side-to-move's
          attacking chances against the enemy king as a horizontal bar
          with a label. Only fires when at least one of the engine's
          top moves targets the king (otherwise it would always be 0
          and the user wouldn't learn anything). */}
      {attack && attack.ratio > 0 && (
        <div style={{
          marginTop: '4px',
          paddingTop: '6px',
          borderTop: '1px dashed #27272a',
          display: 'flex', alignItems: 'center', gap: '8px',
          fontSize: '11px',
        }}>
          <span style={{
            width: '78px',
            color: '#a1a1aa',
            fontWeight: 600,
            letterSpacing: '0.02em',
          }}>Attack potential</span>
          <div style={{
            position: 'relative',
            flex: 1,
            height: '8px',
            backgroundColor: '#0f0f12',
            borderRadius: '999px',
            border: '1px solid #27272a',
            overflow: 'hidden',
          }}>
            <div style={{
              position: 'absolute',
              left: 0, top: 0, bottom: 0,
              width: `${Math.round(attack.ratio * 100)}%`,
              background: attack.attacking_side === 'white'
                ? 'linear-gradient(90deg, #fde68a 0%, #f59e0b 100%)'
                : 'linear-gradient(90deg, #818cf8 0%, #4338ca 100%)',
              transition: 'width 250ms ease-out',
            }} />
          </div>
          <span style={{
            width: '34px',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: '10px',
            color: '#e4e4e7',
            fontWeight: 700,
            textAlign: 'right',
          }}>
            {attack.moves_targeting_king}/{attack.total_moves}
          </span>
        </div>
      )}

      {/* GM-style narrative: a structured, multi-paragraph synthesis of
          the entire blob. This is the LLM-ready handoff — every claim is
          grounded in the structured blob above so an LLM can verify and
          embellish without inventing facts. */}
      {explanation.summary_text && (
        <details style={{
          marginTop: '6px',
          paddingTop: '6px',
          borderTop: '1px dashed #27272a',
        }}>
          <summary style={{
            cursor: 'pointer',
            fontSize: '10px',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: '#71717a',
            fontWeight: 700,
            outline: 'none',
            userSelect: 'none',
            paddingBottom: '6px',
          }}>
            Position summary
          </summary>
          <div style={{
            fontSize: '11px',
            color: '#d4d4d8',
            lineHeight: 1.55,
            whiteSpace: 'pre-wrap',
            maxHeight: '220px',
            overflowY: 'auto',
          }} className="thin-scroll">
            {explanation.summary_text}
          </div>
        </details>
      )}

      {/* Principal-plan one-liner. Engine-derived. */}
      {plan && plan.description && (
        <div style={{
          marginTop: '4px',
          paddingTop: '6px',
          borderTop: '1px dashed #27272a',
          fontSize: '11px',
          color: '#a1a1aa',
          display: 'flex',
          gap: '6px',
          flexDirection: 'column',
        }}>
          <div style={{
            color: '#52525b',
            fontSize: '9px',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            fontWeight: 700,
          }}>
            Engine plan {plan.depth ? `· depth ${plan.depth}` : ''}
          </div>
          <div style={{ color: '#d4d4d8' }}>{plan.description}</div>
          {plan.moves && plan.moves.length > 0 && (
            <div style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: '11px',
              color: '#a1a1aa',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '4px',
            }}>
              {plan.moves.map((m, i) => (
                <span key={i} style={{
                  padding: '1px 6px',
                  borderRadius: '4px',
                  backgroundColor: '#1f1f23',
                  border: '1px solid #27272a',
                  color: i === 0 ? '#a5b4fc' : '#a1a1aa',
                  fontWeight: i === 0 ? 700 : 500,
                }}>
                  {m.san}
                </span>
              ))}
            </div>
          )}
          {plan.key_squares && plan.key_squares.length > 0 && (
            <div style={{
              fontSize: '10px',
              color: '#71717a',
            }}>
              Key squares: <span style={{
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                color: '#a1a1aa',
              }}>{plan.key_squares.join(', ')}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
