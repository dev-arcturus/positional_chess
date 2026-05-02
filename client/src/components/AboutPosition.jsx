import React, { useState } from 'react';

// "About this position" — the small, calm replacement for the busy
// PositionQualityBars / engine-plan / captured-strips set that the user
// (rightly) called out as visual clutter.
//
// First-principles design:
//
//   1. A single visible line by default: the verdict (e.g. "White is
//      better, +0.7"), and one driving reason ("piece activity").
//   2. Click ▾ to expand into the full structured detail: eval
//      breakdown by HCE head, top themes, engine plan, GM narrative.
//   3. Restraint with colour. Monochrome zinc by default; numbers are
//      monospace; semantic colour only on the verdict diff (green for
//      whoever's ahead, red when sharply losing).
//   4. Whitespace, single-column. No bars, no gradients, no decorated
//      pills. The information IS the design.
//
// Props:
//   explanation : the result of `buildFullExplanation(fen)` —
//                 includes eval_breakdown, themes, principal_plan,
//                 summary_text, etc.

const HEAD_LABELS = {
  psqt_cp:        'Piece placement',
  mobility_cp:    'Piece mobility',
  king_safety_cp: 'King safety',
  threats_cp:     'Threats',
  pawns_cp:       'Pawn structure',
  imbalance_cp:   'Imbalance',
  material_cp:    'Material',
};

function pawns(cp) {
  return (cp / 100).toFixed(2);
}

// Pick the leading non-material reason from the eval breakdown — i.e.
// which non-material head accounts for the largest absolute share of
// the total non-material delta. Reads "this is what's driving the
// score, beyond raw material."
function leadingDriver(breakdown) {
  if (!breakdown) return null;
  const heads = ['psqt_cp', 'mobility_cp', 'king_safety_cp', 'threats_cp', 'pawns_cp', 'imbalance_cp'];
  let best = null;
  let bestAbs = 0;
  for (const k of heads) {
    const v = breakdown[k] || 0;
    if (Math.abs(v) > bestAbs) {
      bestAbs = Math.abs(v);
      best = { key: k, value: v };
    }
  }
  if (!best || Math.abs(best.value) < 25) return null;
  return best;
}

// One-line verdict. "Equal." / "White is slightly better." / "Black
// has a winning advantage." Pure text — colour only on the side name.
function verdictText(cp) {
  if (Math.abs(cp) < 25) return { side: null, text: 'Roughly equal' };
  const side = cp > 0 ? 'White' : 'Black';
  const m = Math.abs(cp);
  if (m < 75)  return { side, text: 'has a slight edge' };
  if (m < 200) return { side, text: 'is better' };
  if (m < 500) return { side, text: 'has a winning advantage' };
  return { side, text: 'is clearly winning' };
}

export default function AboutPosition({ explanation }) {
  const [expanded, setExpanded] = useState(false);
  if (!explanation || !explanation.eval_breakdown) {
    return null;
  }

  const eb = explanation.eval_breakdown;
  const cp = explanation.eval_cp ?? 0;
  const v = verdictText(cp);
  const driver = leadingDriver(eb);
  const plan = explanation.principal_plan;
  const themes = (explanation.themes || []).slice().sort((a, b) => b.strength - a.strength);

  // Collapsed-state one-liner.
  // E.g. "White is slightly better; piece mobility leads."
  const headline = (
    <div style={{
      fontSize: '13px',
      lineHeight: 1.5,
      color: '#d4d4d8',
    }}>
      {v.side && (
        <span style={{ color: '#fafafa', fontWeight: 600 }}>{v.side}</span>
      )}
      {v.side && ' '}
      <span>{v.text}</span>
      {Math.abs(cp) >= 25 && (
        <span style={{
          color: '#71717a',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          marginLeft: 6,
          fontSize: '12px',
        }}>
          ({cp > 0 ? '+' : ''}{pawns(cp)})
        </span>
      )}
      {driver && (
        <>
          <span style={{ color: '#52525b' }}> · </span>
          <span style={{ color: '#a1a1aa' }}>
            {(HEAD_LABELS[driver.key] || driver.key).toLowerCase()} leads
          </span>
        </>
      )}
    </div>
  );

  return (
    <div style={{
      borderBottom: '1px solid #27272a',
      padding: '12px 14px',
    }}>
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          padding: 0,
          margin: 0,
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          color: 'inherit',
        }}
      >
        {headline}
        <span style={{
          marginLeft: 8,
          color: '#52525b',
          fontSize: '14px',
          transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
          transition: 'transform 120ms ease',
          flexShrink: 0,
        }}>
          ▾
        </span>
      </button>

      {expanded && (
        <div style={{
          marginTop: '10px',
          paddingTop: '10px',
          borderTop: '1px solid #27272a',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          fontSize: '12px',
          color: '#a1a1aa',
          lineHeight: 1.55,
        }}>
          {/* Eval breakdown — clean two-column list, no bars. */}
          <section>
            <SectionTitle>Eval breakdown</SectionTitle>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto auto', columnGap: '12px', rowGap: '3px' }}>
              {Object.entries(HEAD_LABELS)
                .map(([k, label]) => [k, label, eb[k] || 0])
                .sort((a, b) => Math.abs(b[2]) - Math.abs(a[2]))
                .filter(([, , val]) => Math.abs(val) >= 5)
                .map(([k, label, val]) => (
                  <React.Fragment key={k}>
                    <span style={{ color: '#71717a' }}>{label}</span>
                    <span style={{
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      color: val > 0 ? '#86efac' : (val < 0 ? '#fca5a5' : '#a1a1aa'),
                      textAlign: 'right',
                      fontVariantNumeric: 'tabular-nums',
                    }}>
                      {val > 0 ? '+' : ''}{pawns(val)}
                    </span>
                  </React.Fragment>
                ))}
            </div>
          </section>

          {/* Themes — top 3 by strength. */}
          {themes.length > 0 && (
            <section>
              <SectionTitle>Themes</SectionTitle>
              <ul style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: '4px',
              }}>
                {themes.slice(0, 3).map((t, i) => (
                  <li key={i} style={{ color: '#d4d4d8' }}>
                    {t.description}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Engine plan — a single line, plain text, no chips. */}
          {plan && plan.moves && plan.moves.length > 0 && (
            <section>
              <SectionTitle>Engine plan {plan.depth ? `· depth ${plan.depth}` : ''}</SectionTitle>
              <div style={{
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                color: '#d4d4d8',
              }}>
                {plan.moves.map(m => m.san).join('  ')}
              </div>
              {plan.description && (
                <div style={{ marginTop: '4px', color: '#a1a1aa' }}>
                  {plan.description}
                </div>
              )}
            </section>
          )}

          {/* Full GM-style narrative — copyable. */}
          {explanation.summary_text && (
            <section>
              <div style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: '8px',
                marginBottom: '4px',
              }}>
                <SectionTitle inline>Position summary</SectionTitle>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    try { navigator.clipboard.writeText(JSON.stringify(explanation, null, 2)); } catch { /* ignore */ }
                  }}
                  title="Copy the full structured explanation as JSON (paste into ChatGPT/Claude for a richer write-up)"
                  style={{
                    padding: '2px 8px',
                    fontSize: '10px',
                    fontWeight: 600,
                    backgroundColor: 'transparent',
                    color: '#71717a',
                    border: '1px solid #27272a',
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                >
                  Copy JSON
                </button>
              </div>
              <div style={{
                color: '#a1a1aa',
                whiteSpace: 'pre-wrap',
                maxHeight: '220px',
                overflowY: 'auto',
                paddingRight: '6px',
              }} className="thin-scroll">
                {explanation.summary_text}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function SectionTitle({ children, inline }) {
  return (
    <div style={{
      fontSize: '9px',
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      fontWeight: 700,
      color: '#52525b',
      marginBottom: inline ? 0 : '4px',
    }}>
      {children}
    </div>
  );
}
