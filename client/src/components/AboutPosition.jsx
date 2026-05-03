import React, { useState } from 'react';

// "About this position" — concrete-facts panel, replacing the
// numbers-and-bars version the user (rightly) called crappy UX.
//
// Show, don't tell. Instead of "Piece mobility +0.90 / Material +0.82",
// surface the WHAT:
//
//   • White has the bishop pair in an open position
//   • Black's king is exposed on the d-file (open file with our rook)
//   • White's knight on f5 is an outpost
//   • Black has an isolated d-pawn
//   • White's rook is on the 7th rank
//   • Connected rooks on the back rank
//
// The facts are extracted from the structured ExplanationBlob the Rust
// analyzer already produces — material/pawn_structure/king_safety/
// activity/line_control/tactics/themes — and ranked by how strong the
// signal actually is. We don't hard-code 4 categories; we generalise
// over the whole blob and pull whatever fires meaningfully.
//
// Default: top 5 facts as a flat bullet list. Click ▾ to expand into
// the full structured detail (every fact, plus the GM narrative,
// engine plan, and Copy-JSON for LLM hand-off).

function fileLetter(sq) {
  return sq && typeof sq === 'string' ? sq[0] : '?';
}

// Each fact is `{ side, importance, text }`. We pull these from the
// blob and sort by importance descending. Importance is rough — high
// for game-changing structure (passed pawn, IQP), medium for piece
// activity, low for cosmetic.
function extractFacts(blob) {
  const facts = [];
  if (!blob) return facts;

  // ── Material / piece-mix ─────────────────────────────────────────
  const mat = blob.material || {};
  if (mat.bishop_pair_white && !mat.bishop_pair_black) {
    facts.push({ side: 'white', importance: 60, text: 'White has the bishop pair' });
  }
  if (mat.bishop_pair_black && !mat.bishop_pair_white) {
    facts.push({ side: 'black', importance: 60, text: 'Black has the bishop pair' });
  }
  if (mat.opposite_color_bishops) {
    facts.push({ side: 'both', importance: 50, text: 'Opposite-coloured bishops on the board' });
  }
  if (Math.abs(mat.material_delta_cp || 0) >= 100) {
    const pawns = (Math.abs(mat.material_delta_cp) / 100).toFixed(1);
    const side = mat.material_delta_cp > 0 ? 'White' : 'Black';
    facts.push({
      side: side.toLowerCase(),
      importance: Math.min(95, 60 + Math.round(Math.abs(mat.material_delta_cp) / 50)),
      text: `${side} is up ${pawns} ${pawns === '1.0' ? 'pawn' : 'pawns'} of material`,
    });
  }

  // ── Pawn structure ───────────────────────────────────────────────
  const ps = blob.pawn_structure || {};
  if (ps.iqp_white) {
    facts.push({ side: 'black', importance: 55, text: 'White has an isolated d-pawn (IQP)' });
  }
  if (ps.iqp_black) {
    facts.push({ side: 'white', importance: 55, text: 'Black has an isolated d-pawn (IQP)' });
  }
  if (ps.hanging_pawns_white) {
    facts.push({ side: 'black', importance: 50, text: 'White has hanging pawns (no flank support)' });
  }
  if (ps.hanging_pawns_black) {
    facts.push({ side: 'white', importance: 50, text: 'Black has hanging pawns (no flank support)' });
  }
  if (ps.light_complex_weak) {
    const cap = ps.light_complex_weak.charAt(0).toUpperCase() + ps.light_complex_weak.slice(1);
    facts.push({
      side: ps.light_complex_weak === 'white' ? 'black' : 'white',
      importance: 65,
      text: `${cap}'s light squares are weak`,
    });
  }
  if (ps.dark_complex_weak) {
    const cap = ps.dark_complex_weak.charAt(0).toUpperCase() + ps.dark_complex_weak.slice(1);
    facts.push({
      side: ps.dark_complex_weak === 'white' ? 'black' : 'white',
      importance: 65,
      text: `${cap}'s dark squares are weak`,
    });
  }
  for (const sq of ps.white?.passed || []) {
    facts.push({ side: 'white', importance: 70, text: `White has a passed pawn on ${sq}` });
  }
  for (const sq of ps.black?.passed || []) {
    facts.push({ side: 'black', importance: 70, text: `Black has a passed pawn on ${sq}` });
  }
  for (const sq of ps.white?.isolated || []) {
    facts.push({ side: 'black', importance: 35, text: `White's pawn on ${sq} is isolated` });
  }
  for (const sq of ps.black?.isolated || []) {
    facts.push({ side: 'white', importance: 35, text: `Black's pawn on ${sq} is isolated` });
  }
  for (const sq of ps.white?.backward || []) {
    facts.push({ side: 'black', importance: 35, text: `White's pawn on ${sq} is backward` });
  }
  for (const sq of ps.black?.backward || []) {
    facts.push({ side: 'white', importance: 35, text: `Black's pawn on ${sq} is backward` });
  }

  // ── Activity ─────────────────────────────────────────────────────
  const act = blob.activity || {};
  for (const o of act.white?.outposts || []) {
    facts.push({
      side: 'white', importance: 55,
      text: `White's ${o.piece} on ${o.square} is an outpost`,
    });
  }
  for (const o of act.black?.outposts || []) {
    facts.push({
      side: 'black', importance: 55,
      text: `Black's ${o.piece} on ${o.square} is an outpost`,
    });
  }
  if (act.white?.bad_bishop) {
    facts.push({
      side: 'black', importance: 40,
      text: `White's bishop on ${act.white.bad_bishop} is hemmed in by its own pawns`,
    });
  }
  if (act.black?.bad_bishop) {
    facts.push({
      side: 'white', importance: 40,
      text: `Black's bishop on ${act.black.bad_bishop} is hemmed in by its own pawns`,
    });
  }
  for (const d of act.white?.long_diagonals_controlled || []) {
    facts.push({ side: 'white', importance: 45, text: `White controls the long ${d} diagonal` });
  }
  for (const d of act.black?.long_diagonals_controlled || []) {
    facts.push({ side: 'black', importance: 45, text: `Black controls the long ${d} diagonal` });
  }

  // Mobility delta — only if meaningful gap (≥10 squares).
  const mw = act.white?.total_mobility || 0;
  const mb = act.black?.total_mobility || 0;
  if (Math.abs(mw - mb) >= 10) {
    const side = mw > mb ? 'White' : 'Black';
    facts.push({
      side: side.toLowerCase(), importance: 35,
      text: `${side}'s pieces have ${Math.max(mw, mb) - Math.min(mw, mb)} more squares of mobility`,
    });
  }

  // Space — squares attacked in enemy half.
  const sw = act.white?.squares_in_enemy_half || 0;
  const sb = act.black?.squares_in_enemy_half || 0;
  if (Math.abs(sw - sb) >= 8) {
    const side = sw > sb ? 'White' : 'Black';
    facts.push({
      side: side.toLowerCase(), importance: 35,
      text: `${side} controls more space in the enemy half`,
    });
  }

  // ── Line control ─────────────────────────────────────────────────
  const lc = blob.line_control || {};
  for (const f of lc.open_files || []) {
    if (f.controlling_side) {
      const cap = f.controlling_side.charAt(0).toUpperCase() + f.controlling_side.slice(1);
      facts.push({
        side: f.controlling_side, importance: 50,
        text: `${cap} controls the open ${f.file}-file`,
      });
    }
  }
  if (lc.long_diagonal_a1h8 && !act.white?.long_diagonals_controlled?.includes('a1-h8') && !act.black?.long_diagonals_controlled?.includes('a1-h8')) {
    const cap = lc.long_diagonal_a1h8.charAt(0).toUpperCase() + lc.long_diagonal_a1h8.slice(1);
    facts.push({ side: lc.long_diagonal_a1h8, importance: 40, text: `${cap} eyes the long a1-h8 diagonal` });
  }
  if (lc.long_diagonal_h1a8 && !act.white?.long_diagonals_controlled?.includes('h1-a8') && !act.black?.long_diagonals_controlled?.includes('h1-a8')) {
    const cap = lc.long_diagonal_h1a8.charAt(0).toUpperCase() + lc.long_diagonal_h1a8.slice(1);
    facts.push({ side: lc.long_diagonal_h1a8, importance: 40, text: `${cap} eyes the long h1-a8 diagonal` });
  }
  if (lc.seventh_rank_dominant) {
    const cap = lc.seventh_rank_dominant.charAt(0).toUpperCase() + lc.seventh_rank_dominant.slice(1);
    const rank = lc.seventh_rank_dominant === 'white' ? '7th' : '2nd';
    facts.push({
      side: lc.seventh_rank_dominant, importance: 60,
      text: `${cap} has rook(s) on the ${rank} rank — pigs on the ${rank}`,
    });
  }

  // ── King safety ──────────────────────────────────────────────────
  const ks = blob.king_safety || {};
  for (const f of ks.white?.open_files_to_king || []) {
    facts.push({
      side: 'black', importance: 60,
      text: `White's king is exposed on the ${f}-file`,
    });
  }
  for (const f of ks.black?.open_files_to_king || []) {
    facts.push({
      side: 'white', importance: 60,
      text: `Black's king is exposed on the ${f}-file`,
    });
  }
  if ((ks.white?.attacker_count || 0) >= 3) {
    facts.push({
      side: 'black', importance: 70,
      text: `White's king is under attack — ${ks.white.attacker_count} enemy pieces in the king zone`,
    });
  }
  if ((ks.black?.attacker_count || 0) >= 3) {
    facts.push({
      side: 'white', importance: 70,
      text: `Black's king is under attack — ${ks.black.attacker_count} enemy pieces in the king zone`,
    });
  }

  // Engine attack potential — high signal when ≥0.5.
  const eap = ks.engine_attack_potential;
  if (eap && eap.ratio >= 0.5) {
    const side = eap.attacking_side;
    const cap = side.charAt(0).toUpperCase() + side.slice(1);
    facts.push({
      side, importance: 75,
      text: `${cap} has strong attacking chances — ${eap.moves_targeting_king} of the engine's top ${eap.total_moves} moves target the enemy king`,
    });
  }

  // ── Tactics (immediate) ──────────────────────────────────────────
  const tac = blob.tactics || {};
  for (const h of tac.hanging_white || []) {
    facts.push({
      side: 'black', importance: 90,
      text: `White's ${h.role} on ${h.square} is hanging`,
    });
  }
  for (const h of tac.hanging_black || []) {
    facts.push({
      side: 'white', importance: 90,
      text: `Black's ${h.role} on ${h.square} is hanging`,
    });
  }
  for (const p of tac.pinned_pieces || []) {
    facts.push({
      side: 'both', importance: 60,
      text: `${p.role} on ${p.square} is pinned${p.absolute ? ' to the king' : ''}`,
    });
  }

  // Sort by importance descending, then dedupe by text.
  const seen = new Set();
  return facts
    .sort((a, b) => b.importance - a.importance)
    .filter(f => {
      if (seen.has(f.text)) return false;
      seen.add(f.text);
      return true;
    });
}

function verdictText(cp) {
  if (Math.abs(cp) < 25) return { side: null, text: 'Roughly equal' };
  const side = cp > 0 ? 'White' : 'Black';
  const m = Math.abs(cp);
  if (m < 75)  return { side, text: 'has a slight edge' };
  if (m < 200) return { side, text: 'is better' };
  if (m < 500) return { side, text: 'has a winning advantage' };
  return { side, text: 'is clearly winning' };
}

// Detect mate: either the principal_plan says so, or the eval_cp is in the
// mate-encoded range Stockfish uses (close to ±32000). When there's a
// forced mate on the board, every "open file" / "more mobility" fact is
// noise — the mate is the position. Surface it; suppress the rest.
function mateInN(explanation) {
  // Engine-augmented blob carries explicit mate info.
  const m = explanation?.principal_plan?.eval_mate;
  if (m !== null && m !== undefined && m !== 0) return m;
  // Static blob may have eval_cp at ±10000 ish if a terminal-state branch
  // ran. Be conservative — only treat |cp| ≥ 9000 as effective mate.
  const cp = explanation?.eval_cp ?? 0;
  if (Math.abs(cp) >= 9000) return cp > 0 ? 1 : -1;
  return null;
}

const FACT_COUNT_DEFAULT = 5;

export default function AboutPosition({ explanation }) {
  const [expanded, setExpanded] = useState(false);
  if (!explanation) return null;

  const cp = explanation.eval_cp ?? 0;
  const v = verdictText(cp);
  const facts = extractFacts(explanation);
  const visible = facts.slice(0, FACT_COUNT_DEFAULT);
  const remaining = facts.length - visible.length;
  const plan = explanation.principal_plan;

  return (
    <div style={{
      borderBottom: '1px solid #27272a',
      padding: '12px 14px',
    }}>
      {/* Verdict line — single, calm, no numbers (just a side name). */}
      <div style={{ fontSize: '13px', lineHeight: 1.5, color: '#d4d4d8', marginBottom: visible.length ? '8px' : 0 }}>
        {v.side && (
          <span style={{ color: '#fafafa', fontWeight: 600 }}>{v.side}</span>
        )}
        {v.side && ' '}
        <span>{v.text}</span>
        {v.side === null && <span>; {explanation.side_to_move === 'white' ? 'White' : 'Black'} to move.</span>}
      </div>

      {/* Concrete facts — bullet list, no numbers, no pills. */}
      {visible.length > 0 && (
        <ul style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
          fontSize: '12px',
          lineHeight: 1.5,
        }}>
          {visible.map((f, i) => (
            <Fact key={i} fact={f} />
          ))}
        </ul>
      )}

      {/* Expand control — only when there's more to show. */}
      {(remaining > 0 || plan?.description || explanation.summary_text) && (
        <button
          onClick={() => setExpanded(e => !e)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            marginTop: '8px',
            padding: 0,
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            fontSize: '11px',
            color: '#71717a',
            fontWeight: 600,
          }}
        >
          <span style={{
            display: 'inline-block',
            transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
            transition: 'transform 120ms ease',
            fontSize: '12px',
            lineHeight: 1,
          }}>▾</span>
          {expanded ? 'less' : (remaining > 0 ? `${remaining} more · plan · narrative` : 'plan · narrative')}
        </button>
      )}

      {expanded && (
        <div style={{
          marginTop: '8px',
          paddingTop: '8px',
          borderTop: '1px solid #27272a',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          fontSize: '12px',
          color: '#a1a1aa',
          lineHeight: 1.55,
        }}>
          {/* Remaining facts (everything beyond the top 5). */}
          {remaining > 0 && (
            <ul style={{
              listStyle: 'none', padding: 0, margin: 0,
              display: 'flex', flexDirection: 'column', gap: '4px',
            }}>
              {facts.slice(FACT_COUNT_DEFAULT).map((f, i) => (
                <Fact key={i} fact={f} muted />
              ))}
            </ul>
          )}

          {/* Engine plan — plain SAN, no chips. */}
          {plan && plan.moves?.length > 0 && (
            <section>
              <SectionTitle>Engine plan{plan.depth ? ` · depth ${plan.depth}` : ''}</SectionTitle>
              <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: '#d4d4d8' }}>
                {plan.moves.map(m => m.san).join('  ')}
              </div>
              {plan.description && (
                <div style={{ marginTop: '4px', color: '#a1a1aa' }}>{plan.description}</div>
              )}
            </section>
          )}

          {/* Full GM narrative + Copy-JSON for LLM hand-off. */}
          {explanation.summary_text && (
            <section>
              <div style={{
                display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                marginBottom: '4px',
              }}>
                <SectionTitle inline>Full summary</SectionTitle>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    try { navigator.clipboard.writeText(JSON.stringify(explanation, null, 2)); } catch { /* ignore */ }
                  }}
                  title="Copy the full structured explanation as JSON"
                  style={{
                    padding: '2px 8px', fontSize: '10px', fontWeight: 600,
                    backgroundColor: 'transparent', color: '#71717a',
                    border: '1px solid #27272a', borderRadius: '4px', cursor: 'pointer',
                  }}
                >
                  Copy JSON
                </button>
              </div>
              <div style={{
                color: '#a1a1aa', whiteSpace: 'pre-wrap',
                maxHeight: '220px', overflowY: 'auto', paddingRight: '6px',
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

function Fact({ fact, muted }) {
  // Subtle side-cue: a 2-pixel left bar tinted by who benefits. White
  // (light gray), black (dark gray), both (mid). No bold colour — the
  // claim itself is the signal, not the bar.
  const cue = fact.side === 'white' ? '#a1a1aa' :
              fact.side === 'black' ? '#3f3f46' :
              '#52525b';
  return (
    <li style={{
      display: 'flex',
      gap: '8px',
      alignItems: 'flex-start',
      paddingLeft: '2px',
    }}>
      <span style={{
        flexShrink: 0,
        width: '2px',
        height: '14px',
        marginTop: '3px',
        backgroundColor: cue,
        borderRadius: '1px',
      }} />
      <span style={{ color: muted ? '#71717a' : '#d4d4d8' }}>
        {fact.text}
      </span>
    </li>
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
