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
