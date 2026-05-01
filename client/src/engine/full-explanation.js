// Full explanation builder.
//
// Combines:
//   1. Static blob from the Rust analyzer (engine-rs).
//   2. Stockfish multi-PV results.
//   3. WASM-annotated motifs for each top move.
//   4. PV-walked plan extraction for the principal variation.
//
// Output: an augmented `Explanation` blob with new sections:
//   - `engine_attack_potential` — attached to king_safety; how easy is
//     it to attack the enemy king based on what fraction of the engine's
//     top moves target the king zone (or contain a tactical motif).
//   - `principal_plan` — the engine's PV walked move-by-move, each
//     annotated with its motifs and a one-line headline. Plus the
//     "key squares" (squares visited 2+ times) and a derived theme.
//   - extra `themes` synthesised from these signals.
//
// This is the LLM-ready blob: deeply structured, attribution-aware,
// suitable for prompting a model to write a paragraph about the
// position.

import engine from './engine';
import { explainPosition, analyzeMove, isReady as wasmReady } from './analyzer-rs';
import { getSideToMove } from './chess';

const PLAN_DEPTH = 14;
const PLAN_MULTIPV = 5;
const PLAN_PLIES = 6; // walk the principal variation up to this many plies

// Motif IDs that count as "targeting the king" — used to score how much
// the engine's preferred moves are king-attacking.
const KING_ATTACK_MOTIFS = new Set([
  'attacks_king', 'eyes_king_zone',
  'check', 'discovered_check', 'double_check',
  'greek_gift', 'back_rank_mate_threat', 'smothered_hint',
  'fork', 'pin', 'skewer', // tactics that often involve the king
  'sacrifice', 'decisive_combination',
]);

// Build the full blob asynchronously. Returns null if WASM isn't ready
// or the engine fails. Callers should fall back to the static blob.
export async function buildFullExplanation(fen, opts = {}) {
  if (!wasmReady() || !fen) return null;

  // ── Static layer ────────────────────────────────────────────────────
  const staticBlob = explainPosition(fen);
  if (!staticBlob || staticBlob.error) return staticBlob || null;

  // ── Engine layer ────────────────────────────────────────────────────
  let engineRes;
  try {
    engineRes = await engine.analyzeMultiPV(fen, PLAN_MULTIPV, opts.depth || PLAN_DEPTH);
  } catch {
    return staticBlob; // engine failed; static is still useful
  }
  if (!engineRes || !Array.isArray(engineRes.moves)) return staticBlob;

  // ── Annotate each top move with motifs ──────────────────────────────
  const annotatedMoves = engineRes.moves.map(m => {
    const result = analyzeMove(fen, m.move);
    const motifIds = (result?.motifs || []).map(x => x.id);
    return {
      uci: m.move,
      san: result?.san || m.move,
      score: m.score,
      mate: m.mate,
      motifs: motifIds,
      // Targets-king flag: any motif that's a king-attack signal.
      targetsKing: motifIds.some(id => KING_ATTACK_MOTIFS.has(id)),
      headline: result?.motifs?.[0]?.phrase || null,
    };
  });

  // ── Engine-driven attack potential ──────────────────────────────────
  const targeters = annotatedMoves.filter(m => m.targetsKing).length;
  const total = annotatedMoves.length || 1;
  const ratio = targeters / total;
  const stm = getSideToMove(fen);
  const attackingSide = stm === 'w' ? 'white' : 'black';
  const defendingSide = stm === 'w' ? 'black' : 'white';
  const attackPotential = {
    attacking_side: attackingSide,
    defending_side: defendingSide,
    moves_targeting_king: targeters,
    total_moves: total,
    ratio,
    summary: ratio >= 0.6
      ? `Strong attack potential against the ${defendingSide} king (${targeters}/${total} engine moves target the king)`
      : ratio >= 0.3
      ? `Some attack potential against the ${defendingSide} king`
      : `Low king-attack potential — engine prefers positional play`,
  };

  // Augment the static king_safety section with this signal.
  staticBlob.king_safety.engine_attack_potential = attackPotential;

  // ── Plan extraction: walk the principal variation ───────────────────
  const principalPv = (engineRes.moves[0] && engineRes.moves[0].pv) || [];
  const planSteps = [];
  let curFen = fen;
  for (let i = 0; i < Math.min(principalPv.length, PLAN_PLIES); i++) {
    const uci = principalPv[i];
    if (!uci) break;
    const result = analyzeMove(curFen, uci);
    if (!result) break;
    planSteps.push({
      uci,
      san: result.san,
      motifs: (result.motifs || []).map(m => m.id),
      headline: result.motifs?.[0]?.phrase || null,
      to: uci.slice(2, 4),
      from: uci.slice(0, 2),
    });
    if (!result.fen_after) break;
    curFen = result.fen_after;
  }

  // Key squares: any square visited (or arrived at) ≥ 2 times in the PV.
  const squareVisits = new Map();
  planSteps.forEach(step => {
    [step.from, step.to].forEach(sq => {
      squareVisits.set(sq, (squareVisits.get(sq) || 0) + 1);
    });
  });
  const keySquares = [...squareVisits.entries()]
    .filter(([, n]) => n >= 2)
    .map(([sq]) => sq)
    .sort();

  // Theme inference: which motif category dominates?
  const motifFreq = new Map();
  planSteps.forEach(step => {
    step.motifs.forEach(m => motifFreq.set(m, (motifFreq.get(m) || 0) + 1));
  });
  const topMotif = [...motifFreq.entries()]
    .sort((a, b) => b[1] - a[1])[0]?.[0];
  let planTheme = null;
  if (topMotif) {
    if (KING_ATTACK_MOTIFS.has(topMotif)) {
      planTheme = `kingside_attack_${attackingSide}`;
    } else if (['simplifies', 'queen_trade', 'piece_trade', 'trades_into_endgame'].includes(topMotif)) {
      planTheme = 'simplification';
    } else if (['outpost', 'centralizes', 'activates', 'knight_invasion', 'rook_lift'].includes(topMotif)) {
      planTheme = 'piece_activity';
    } else if (['passed_pawn', 'pawn_breakthrough', 'promotion'].includes(topMotif)) {
      planTheme = 'pawn_advance';
    } else if (['pin', 'skewer', 'fork', 'discovered_check', 'sacrifice', 'greek_gift'].includes(topMotif)) {
      planTheme = 'tactics';
    } else {
      planTheme = topMotif.replace(/_/g, '_');
    }
  }

  staticBlob.principal_plan = {
    eval_cp: engineRes.score ?? 0,
    eval_mate: engineRes.mate ?? null,
    depth: opts.depth || PLAN_DEPTH,
    moves: planSteps,
    key_squares: keySquares,
    theme: planTheme,
    description: planTheme
      ? planTheme === 'kingside_attack_white'
        ? "White's plan is a kingside attack."
        : planTheme === 'kingside_attack_black'
        ? "Black's plan is a kingside attack."
        : planTheme === 'simplification'
        ? "The engine plans simplification through trades."
        : planTheme === 'piece_activity'
        ? "The engine improves piece activity."
        : planTheme === 'pawn_advance'
        ? "The engine plans a pawn advance / promotion."
        : planTheme === 'tactics'
        ? "The engine sees a concrete tactical sequence."
        : `The engine's plan: ${planTheme.replace(/_/g, ' ')}.`
      : null,
  };

  staticBlob.engine_top_moves = annotatedMoves;

  // ── GM-style narrative ──────────────────────────────────────────────
  // Compose a structured paragraph from the now-complete blob. This is
  // the LLM-ready handoff: a baseline narrative an LLM can refine.
  staticBlob.summary_text = composeNarrative(staticBlob);

  // ── New themes ──────────────────────────────────────────────────────
  if (ratio >= 0.6) {
    staticBlob.themes.push({
      id: 'engine_attack_potential',
      side: attackingSide,
      strength: Math.round(ratio * 100),
      description: attackPotential.summary,
    });
  }
  if (planTheme) {
    staticBlob.themes.push({
      id: 'engine_plan',
      side: attackingSide,
      strength: 60,
      description: staticBlob.principal_plan.description || `Plan: ${planTheme}`,
    });
  }

  return staticBlob;
}

// ───────────────────────────────────────────────────────────────────────────
// composeNarrative — synthesise a GM-style paragraph from the blob.
//
// The output is a multi-line string. Each "paragraph" is one structural
// observation: verdict, material, king safety, activity, structure,
// tactics, plan. Empty sections are skipped.
//
// This is intentionally formulaic — it's the *baseline* an LLM would
// enhance. We ground every claim in the blob so an LLM can verify and
// embellish without inventing facts.
// ───────────────────────────────────────────────────────────────────────────

function pawns(cp) { return (cp / 100).toFixed(2); }
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

function composeNarrative(blob) {
  const lines = [];
  const stm = blob.side_to_move; // "white" / "black"
  const evalCp = blob.eval_cp;
  const verdict = blob.verdict || '';

  // ── 1. Verdict opening ─────────────────────────────────────────────
  if (Math.abs(evalCp) < 25) {
    lines.push("The position is roughly equal.");
  } else {
    const side = evalCp > 0 ? "White" : "Black";
    const mag = Math.abs(evalCp);
    const adj = mag < 75  ? "a slight edge"
              : mag < 200 ? "a clear edge"
              : mag < 500 ? "a winning advantage"
              : "a decisive advantage";
    lines.push(`${side} has ${adj} of ${pawns(mag)} (engine eval ${evalCp > 0 ? '+' : ''}${pawns(evalCp)}). ${cap(stm)} to move.`);
  }

  // ── 2. Leading factor + breakdown ──────────────────────────────────
  const leading = (blob.themes || [])
    .filter(t => t.id !== 'leading_factor')
    .sort((a, b) => b.strength - a.strength)[0];
  if (leading) {
    lines.push(`The leading factor: ${leading.description.toLowerCase()}.`);
  }

  // Eval breakdown — name the heads with the biggest contribution.
  if (blob.eval_breakdown) {
    const eb = blob.eval_breakdown;
    const heads = [
      ['psqt_cp',        'piece placement'],
      ['mobility_cp',    'piece mobility'],
      ['king_safety_cp', 'king safety'],
      ['threats_cp',     'threat creation'],
      ['pawns_cp',       'pawn structure'],
      ['imbalance_cp',   'imbalance (e.g. bishop pair)'],
    ];
    const ranked = heads
      .map(([k, n]) => ({ key: k, name: n, value: eb[k] || 0 }))
      .filter(x => Math.abs(x.value) >= 30)
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    if (ranked.length > 0) {
      const phr = ranked.slice(0, 2).map(r =>
        `${r.value > 0 ? 'White' : 'Black'} ${r.name} (${r.value > 0 ? '+' : ''}${pawns(r.value)})`
      );
      lines.push(`The score breaks down to: ${phr.join('; ')}.`);
    }
  }

  // ── 3. Material ─────────────────────────────────────────────────────
  if (blob.material) {
    const m = blob.material;
    const mat_lines = [];
    if (Math.abs(m.material_delta_cp) >= 100) {
      const side = m.material_delta_cp > 0 ? "White" : "Black";
      mat_lines.push(`${side} is ahead in material (${pawns(Math.abs(m.material_delta_cp))} pawns).`);
    } else {
      mat_lines.push("Material is roughly even.");
    }
    if (m.bishop_pair_white && !m.bishop_pair_black) mat_lines.push("White holds the bishop pair.");
    if (m.bishop_pair_black && !m.bishop_pair_white) mat_lines.push("Black holds the bishop pair.");
    if (m.opposite_color_bishops) mat_lines.push("Opposite-coloured bishops on the board (drawish in pure endings; sharp with extra attackers).");
    lines.push(mat_lines.join(' '));
  }

  // ── 4. King safety ─────────────────────────────────────────────────
  if (blob.king_safety) {
    const ks = blob.king_safety;
    const ks_lines = [];
    const dw = ks.white?.danger_score || 0;
    const db = ks.black?.danger_score || 0;
    if (Math.abs(dw - db) >= 80) {
      const safer = dw < db ? 'white' : 'black';
      const exposed = safer === 'white' ? 'black' : 'white';
      ks_lines.push(`${cap(safer)}'s king is meaningfully safer than ${cap(exposed)}'s.`);
    }
    if (ks.white?.open_files_to_king?.length) {
      ks_lines.push(`White's king is exposed on the ${ks.white.open_files_to_king.join('-, ')}-file(s).`);
    }
    if (ks.black?.open_files_to_king?.length) {
      ks_lines.push(`Black's king is exposed on the ${ks.black.open_files_to_king.join('-, ')}-file(s).`);
    }
    if (ks.white?.attacker_count >= 3) {
      ks_lines.push(`White has ${ks.white.attacker_count} pieces in the black king's zone.`);
    }
    if (ks.black?.attacker_count >= 3) {
      ks_lines.push(`Black has ${ks.black.attacker_count} pieces in the white king's zone.`);
    }
    if (ks.engine_attack_potential && ks.engine_attack_potential.ratio >= 0.4) {
      ks_lines.push(ks.engine_attack_potential.summary + '.');
    }
    if (ks_lines.length) lines.push(ks_lines.join(' '));
  }

  // ── 5. Activity / space ─────────────────────────────────────────────
  if (blob.activity) {
    const a = blob.activity;
    const a_lines = [];
    const mw = a.white?.total_mobility || 0;
    const mb = a.black?.total_mobility || 0;
    if (Math.abs(mw - mb) >= 8) {
      const side = mw > mb ? 'White' : 'Black';
      a_lines.push(`${side} has more piece activity (${Math.max(mw, mb)} vs ${Math.min(mw, mb)} squares of mobility).`);
    }
    const sw = a.white?.squares_in_enemy_half || 0;
    const sb = a.black?.squares_in_enemy_half || 0;
    if (Math.abs(sw - sb) >= 6) {
      const side = sw > sb ? 'White' : 'Black';
      a_lines.push(`${side} controls more space in the enemy half.`);
    }
    if ((a.white?.outposts?.length || 0) > 0) {
      a_lines.push(`White has outposts on ${a.white.outposts.map(o => `${o.piece}/${o.square}`).join(', ')}.`);
    }
    if ((a.black?.outposts?.length || 0) > 0) {
      a_lines.push(`Black has outposts on ${a.black.outposts.map(o => `${o.piece}/${o.square}`).join(', ')}.`);
    }
    if (a.white?.bad_bishop) a_lines.push(`White's bishop on ${a.white.bad_bishop} is hemmed in by its own pawns.`);
    if (a.black?.bad_bishop) a_lines.push(`Black's bishop on ${a.black.bad_bishop} is hemmed in by its own pawns.`);
    if (a_lines.length) lines.push(a_lines.join(' '));
  }

  // ── 6. Pawn structure ──────────────────────────────────────────────
  if (blob.pawn_structure) {
    const ps = blob.pawn_structure;
    const ps_lines = [];
    if (ps.iqp_white && !ps.iqp_black) ps_lines.push("White has an isolated queen pawn — long-term weakness in exchange for active piece play.");
    if (ps.iqp_black && !ps.iqp_white) ps_lines.push("Black has an isolated queen pawn — long-term weakness in exchange for active piece play.");
    if (ps.hanging_pawns_white) ps_lines.push("White has hanging pawns (a c+d or d+e pawn pair without flanking support).");
    if (ps.hanging_pawns_black) ps_lines.push("Black has hanging pawns.");
    if (ps.light_complex_weak) ps_lines.push(`${cap(ps.light_complex_weak)}'s light squares are weak.`);
    if (ps.dark_complex_weak)  ps_lines.push(`${cap(ps.dark_complex_weak)}'s dark squares are weak.`);
    if (ps.white?.passed?.length) ps_lines.push(`White has passed pawns: ${ps.white.passed.join(', ')}.`);
    if (ps.black?.passed?.length) ps_lines.push(`Black has passed pawns: ${ps.black.passed.join(', ')}.`);
    if (ps.white?.isolated?.length) ps_lines.push(`White isolated: ${ps.white.isolated.join(', ')}.`);
    if (ps.black?.isolated?.length) ps_lines.push(`Black isolated: ${ps.black.isolated.join(', ')}.`);
    if (ps_lines.length) lines.push(ps_lines.join(' '));
  }

  // ── 7. Line control ────────────────────────────────────────────────
  if (blob.line_control) {
    const lc = blob.line_control;
    const l_lines = [];
    const controlled = (lc.open_files || []).filter(f => f.controlling_side);
    if (controlled.length) {
      const phr = controlled.map(f => `${cap(f.controlling_side)} controls the ${f.file}-file`);
      l_lines.push(phr.join('; ') + '.');
    }
    if (lc.long_diagonal_a1h8) l_lines.push(`${cap(lc.long_diagonal_a1h8)} controls the long a1-h8 diagonal.`);
    if (lc.long_diagonal_h1a8) l_lines.push(`${cap(lc.long_diagonal_h1a8)} controls the long h1-a8 diagonal.`);
    if (lc.seventh_rank_dominant) l_lines.push(`${cap(lc.seventh_rank_dominant)} has rook(s) on the seventh — pigs on the 7th.`);
    if (l_lines.length) lines.push(l_lines.join(' '));
  }

  // ── 8. Tactics ─────────────────────────────────────────────────────
  if (blob.tactics) {
    const t = blob.tactics;
    const t_lines = [];
    if (t.hanging_white?.length) {
      t_lines.push(`White has hanging material: ${t.hanging_white.map(h => `${h.role} on ${h.square}`).join(', ')}.`);
    }
    if (t.hanging_black?.length) {
      t_lines.push(`Black has hanging material: ${t.hanging_black.map(h => `${h.role} on ${h.square}`).join(', ')}.`);
    }
    if (t.pinned_pieces?.length) {
      const phr = t.pinned_pieces.map(p =>
        `${p.role} on ${p.square} pinned${p.absolute ? ' absolutely to the king' : ''}`
      );
      t_lines.push(phr.join('; ') + '.');
    }
    if (t_lines.length) lines.push(t_lines.join(' '));
  }

  // ── 9. Engine plan ─────────────────────────────────────────────────
  if (blob.principal_plan && blob.principal_plan.description) {
    const p = blob.principal_plan;
    let txt = p.description;
    if (p.moves && p.moves.length > 0) {
      const sans = p.moves.map(m => m.san).join(' ');
      txt += ` Engine PV: ${sans}.`;
    }
    if (p.key_squares && p.key_squares.length > 0) {
      txt += ` Key squares: ${p.key_squares.join(', ')}.`;
    }
    lines.push(txt);
  }

  return lines.join('\n\n');
}

export { composeNarrative };

