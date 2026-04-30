// Position-level "heatmap" analyses, ported from the legacy server.
//
//   getPieceValues(fen)       — for each non-king piece, compute Δ-eval
//                                if the piece were removed. The bigger the
//                                drop, the more that piece is "doing" in
//                                this position.
//   streamDestinationValues   — for each legal destination of the moving
//                                piece, compute the piece's contextual
//                                worth IF moved there. Streams results
//                                back via a callback as each destination
//                                completes (so the UI can render labels
//                                progressively rather than waiting for
//                                the whole batch).
//
// These fire 16+ engine searches in a row, so we use a shallow
// HEATMAP_DEPTH (10) and lean heavily on the engine LRU cache. Repeat
// invocations on the same FEN are near-instant.

import { Chess } from 'chess.js';
import engine from './engine';
import {
  getPieces,
  removePiece,
  getSideToMove,
  getLegalDestinations,
  makeMove,
} from './chess';

const HEATMAP_DEPTH = 10;

// Mate-encoded scores from the engine are huge (≈ ±100,000 cp). Translate
// either side of the eval to a sane "owner-perspective cp" value where
// owner-mates → +1000 and owner-gets-mated → -1000. cp scores are clamped
// to ±1500 to defend against any latent mate-encoding bleed-through.
function ownerValue(evalRes, sideToMoveAtFen, ownerColor) {
  if (!evalRes) return 0;
  const cp = evalRes.cp ?? 0;
  const mate = evalRes.mate ?? null;
  // Engine reports from side-to-move's POV; normalize to white POV first.
  const whiteCp   = sideToMoveAtFen === 'w' ?  cp : -cp;
  const whiteMate = mate !== null
    ? (sideToMoveAtFen === 'w' ?  mate : -mate)
    : null;
  // Then to owner POV.
  const ownerCp   = ownerColor === 'w' ?  whiteCp : -whiteCp;
  const ownerMate = whiteMate !== null
    ? (ownerColor === 'w' ?  whiteMate : -whiteMate)
    : null;
  if (ownerMate !== null) {
    // Distinguish "owner mates" (+1000) from "owner gets mated" (-1000) but
    // ignore the mate distance — the heatmap just needs a magnitude to
    // reason about, not the exact ply count.
    return ownerMate > 0 ? 1000 : -1000;
  }
  return Math.max(-1500, Math.min(1500, ownerCp));
}

// Cap on |delta_cp| for display. 5 pawns is enough to convey "very
// important". Going higher (e.g. 15) makes every piece around a mating
// attack read identically and conveys no info.
const MAX_DELTA_CP = 500;

function clampDelta(cp) {
  if (cp > MAX_DELTA_CP) return MAX_DELTA_CP;
  if (cp < -MAX_DELTA_CP) return -MAX_DELTA_CP;
  return cp;
}

function normalizeToWhite(score, turn) {
  return turn === 'w' ? score : -score;
}

async function ensureReady() {
  await engine.init();
}

export async function getPieceValues(fen) {
  await ensureReady();
  const turn = getSideToMove(fen);
  const baseRes = await engine.evaluate(fen, HEATMAP_DEPTH);
  const baseEvalCp = normalizeToWhite(baseRes.cp, turn);

  const pieces = getPieces(fen);
  const results = [];
  for (const piece of pieces) {
    let deltaCp = 0;
    if (piece.type !== 'k') {
      const fenWithoutPiece = removePiece(fen, piece.square);
      const evalRes = await engine.evaluate(fenWithoutPiece, HEATMAP_DEPTH);
      // Use owner-relative values that fold mate scores into ±1000 so
      // mate-encoding doesn't blow up the delta.
      const baseOwner = ownerValue(baseRes, turn, piece.color);
      const removedOwner = ownerValue(evalRes, turn, piece.color);
      deltaCp = clampDelta(baseOwner - removedOwner);
    }
    results.push({
      ...piece,
      delta_cp: deltaCp,
      delta_pawns: parseFloat((deltaCp / 100).toFixed(2)),
    });
  }
  return { fen, eval_cp: baseEvalCp, pieces: results };
}

// For each legal destination, compute the moving piece's contextual worth
// at that destination — i.e., value_cp = baseEval(newFen) - eval(newFen
// minus piece on dest), from the piece's owner's POV. Two engine calls
// per destination instead of the 16 a full piece-values heatmap needs.
//
// Streams results: invokes `onResult({ dest, value_cp, value_pawns })`
// each time a destination completes. Returns a cancel function.
export function streamDestinationValues(fen, sourceSquare, onResult) {
  let cancelled = false;
  (async () => {
    await ensureReady();
    const piece = new Chess(fen).get(sourceSquare);
    if (!piece) return;
    const dests = getLegalDestinations(fen, sourceSquare);
    for (const dest of dests) {
      if (cancelled) break;
      const newFen = makeMove(fen, sourceSquare, dest);
      if (!newFen) continue;
      try {
        const newTurn = getSideToMove(newFen);
        const baseRes = await engine.evaluate(newFen, HEATMAP_DEPTH);
        if (cancelled) break;
        const fenWithoutPiece = removePiece(newFen, dest);
        const withoutRes = await engine.evaluate(fenWithoutPiece, HEATMAP_DEPTH);
        if (cancelled) break;
        const valueCp = clampDelta(
          ownerValue(baseRes, newTurn, piece.color)
          - ownerValue(withoutRes, newTurn, piece.color)
        );
        onResult({
          dest,
          value_cp: valueCp,
          value_pawns: parseFloat((valueCp / 100).toFixed(2)),
        });
      } catch {
        // Skip this destination on failure (e.g. illegal intermediate state)
      }
    }
  })();
  return () => { cancelled = true; };
}
