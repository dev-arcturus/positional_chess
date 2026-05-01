// Thin JS wrapper around the Rust/WASM motif analyzer.
//
// The WASM module is initialised lazily — `ensureReady()` triggers a fetch
// + instantiate. Until that promise resolves, `analyzeMove()` returns null
// so callers can fall back to the legacy JS detectors.
//
// The Rust analyzer returns a JSON-ish object:
//   { san, fen_after, motifs: [{id, phrase, priority}], terminal? }
// Phrases are pre-rendered ("Pins the knight to the queen", etc.) and
// motifs are NOT pre-sorted. Composition (priority sort + combined phrases
// like "Captures with check") happens in `composeTagline()`.

import init, {
  analyze as wasmAnalyze,
  analyze_pv as wasmAnalyzePv,
  evaluate_fen as wasmEvaluateFen,
  piece_contributions as wasmPieceContributions,
  piece_value_at as wasmPieceValueAt,
  version as wasmVersion,
} from './wasm-rs/engine_rs.js';

let ready = false;
let initPromise = null;

export function ensureReady() {
  if (ready) return Promise.resolve(true);
  if (!initPromise) {
    initPromise = init()
      .then(() => {
        ready = true;
        try { console.log('[engine-rs]', wasmVersion()); } catch { /* ignore */ }
        return true;
      })
      .catch((err) => {
        console.error('[engine-rs] init failed:', err);
        ready = false;
        return false;
      });
  }
  return initPromise;
}

export function isReady() {
  return ready;
}

/** Analyze a single move. Returns the raw Rust object, or null if WASM
 *  isn't ready yet (caller should fall back to JS detectors). */
export function analyzeMove(fenBefore, moveUci) {
  if (!ready) return null;
  try {
    const result = wasmAnalyze(fenBefore, moveUci);
    if (!result || result.error) return null;
    return result;
  } catch (e) {
    console.warn('[engine-rs] analyze failed:', e);
    return null;
  }
}

/** Analyze a sequence of UCI moves. Returns array or null. */
export function analyzePv(startFen, ucis, plies = 3) {
  if (!ready) return null;
  try {
    const arr = wasmAnalyzePv(startFen, ucis, plies);
    if (!Array.isArray(arr)) return null;
    return arr;
  } catch (e) {
    console.warn('[engine-rs] analyze_pv failed:', e);
    return null;
  }
}

// Compose a tagline from a Rust analysis result. Mirrors the JS taglines
// composer (`combinedPhrase`, two-motif join) but operates on the
// pre-rendered Rust phrases.
export function composeTagline(rustResult) {
  if (!rustResult || !rustResult.motifs) {
    return { san: rustResult?.san || '', motifs: [], tagline: '', fenAfter: rustResult?.fen_after || '' };
  }

  const motifs = rustResult.motifs.slice().sort((a, b) => a.priority - b.priority);
  const motifIds = motifs.map(m => m.id);
  const phraseFor = (id) => {
    const m = motifs.find(x => x.id === id);
    return m && m.phrase ? m.phrase : null;
  };

  // Special combinations that read more naturally.
  let combo = null;
  const has = (id) => motifIds.includes(id);
  if (has('castles_kingside') && has('connects_rooks')) {
    combo = 'Castles kingside, connecting the rooks';
  } else if (has('castles_queenside') && has('connects_rooks')) {
    combo = 'Castles queenside, connecting the rooks';
  } else if (has('capture') && has('discovered_check')) {
    combo = `${phraseFor('capture')} with discovered check`;
  } else if (has('capture') && has('check')) {
    combo = `${phraseFor('capture')} with check`;
  } else if (has('outpost') && has('attacks_pawn')) {
    combo = `${phraseFor('outpost')}, ${phraseFor('attacks_pawn').toLowerCase()}`;
  } else if (has('removes_defender') && has('threatens')) {
    combo = `${phraseFor('removes_defender')}, leaving it hanging`;
  } else if (has('fork') && has('check')) {
    combo = `${phraseFor('fork')} with check`;
  }

  // Drop empty / utility-only motifs (develops, connects_rooks) from final phrase.
  const visible = motifs.filter(m => m.phrase && m.phrase.length > 0);

  let tagline;
  if (combo) {
    tagline = combo;
  } else if (visible.length === 0) {
    tagline = '';
  } else if (visible.length === 1) {
    tagline = visible[0].phrase;
  } else {
    tagline = visible.slice(0, 2).map(m => m.phrase).join(', ');
  }

  return {
    san: rustResult.san,
    motifs: motifIds,
    tagline,
    fenAfter: rustResult.fen_after,
  };
}

// Static evaluation of a FEN. Returns `{ phase, white, black, final_cp }`
// where each side has a per-head breakdown (material/psqt/mobility/pawns/
// king_safety/threats/imbalance), each tapered to mg+eg.
export function evaluateFen(fen) {
  if (!ready) return null;
  try {
    const r = wasmEvaluateFen(fen);
    if (!r || r.error) return null;
    return r;
  } catch (e) {
    console.warn('[engine-rs] evaluate_fen failed:', e);
    return null;
  }
}

// All non-king pieces' contribution to the static evaluation. Each entry:
//   { square, color, role, value_cp, material, psqt, mobility, pawns,
//     king_safety, threats, imbalance }
// `value_cp` is side-relative (positive = good for piece's owner).
export function pieceContributionsForFen(fen) {
  if (!ready) return null;
  try {
    const r = wasmPieceContributions(fen);
    if (!Array.isArray(r)) return null;
    return r;
  } catch (e) {
    console.warn('[engine-rs] piece_contributions failed:', e);
    return null;
  }
}

// Single-piece contribution. Same shape as one entry from pieceContributionsForFen.
export function pieceValueAt(fen, square) {
  if (!ready) return null;
  try {
    const r = wasmPieceValueAt(fen, square);
    if (!r || r.error) return null;
    return r;
  } catch (e) {
    console.warn('[engine-rs] piece_value_at failed:', e);
    return null;
  }
}

// Kick off init eagerly so the first call has a good chance of being warm.
ensureReady();
