// Position-level "heatmap" analyses, ported from the legacy server.
//
//   getPieceValues(fen)       — for each non-king piece, compute Δ-eval
//                                if the piece were removed. The bigger the
//                                drop, the more that piece is "doing" in
//                                this position.
//   getMobility(fen, square)  — for each legal destination of the piece on
//                                `square`, compute Δ-eval after the move.
//                                Color-codes "where can this piece usefully
//                                go?"
//
// These can fire 16+ engine searches in a row, so we use a shallow
// HEATMAP_DEPTH (10) and lean heavily on the engine LRU cache. Repeat
// invocations on the same FEN are near-instant.

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

export async function getMobility(fen, square) {
  await ensureReady();
  const turn = getSideToMove(fen);
  const baseRes = await engine.evaluate(fen, HEATMAP_DEPTH);
  const baseEvalCp = normalizeToWhite(baseRes.cp, turn);

  const destinations = getLegalDestinations(fen, square);
  const moves = [];
  for (const to of destinations) {
    const newFen = makeMove(fen, square, to);
    if (!newFen) continue;
    const newTurn = getSideToMove(newFen);
    const evalRes = await engine.evaluate(newFen, HEATMAP_DEPTH);
    const newEvalCp = normalizeToWhite(evalRes.cp, newTurn);
    // Δ from the moving player's POV.
    const delta = turn === 'w'
      ? newEvalCp - baseEvalCp
      : baseEvalCp - newEvalCp;
    moves.push({
      square: to,
      delta_cp: delta,
      delta_pawns: parseFloat((delta / 100).toFixed(2)),
    });
  }
  return { fen, source_square: square, eval_cp: baseEvalCp, moves };
}
