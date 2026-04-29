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
      // Removing a piece can produce technically illegal positions (e.g. king
      // exposed to check), but Stockfish will still evaluate them, which is
      // fine for relative-value scoring.
      const evalRes = await engine.evaluate(fenWithoutPiece, HEATMAP_DEPTH);
      const evalWithout = normalizeToWhite(evalRes.cp, turn);
      // Δ from this piece's owner's POV: positive = "this piece helps me"
      deltaCp = piece.color === 'w'
        ? baseEvalCp - evalWithout
        : evalWithout - baseEvalCp;
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
        const baseCp = normalizeToWhite(baseRes.cp, newTurn);

        const fenWithoutPiece = removePiece(newFen, dest);
        const withoutRes = await engine.evaluate(fenWithoutPiece, HEATMAP_DEPTH);
        if (cancelled) break;
        const withoutCp = normalizeToWhite(withoutRes.cp, newTurn);

        const valueCp = piece.color === 'w'
          ? baseCp - withoutCp
          : withoutCp - baseCp;
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
