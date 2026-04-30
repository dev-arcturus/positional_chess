// High-level analysis API consumed by the UI.
// Shapes match the (deprecated) server endpoints so Board.jsx stays close
// to its original form: getTopMoves / getBestMove / explainMoveAt.

import engine from './engine';
import { uciToSan, makeMove, getSideToMove } from './chess';
import { explainMove } from './explainer';
import { quickExplain, explainPV } from './taglines';

const TOP_MOVES_DEPTH   = 12;  // panel — interactive, must be snappy
const BEST_MOVE_DEPTH   = 14;  // hint — one-shot click, can wait a bit
const EXPLAIN_DEPTH     = 14;  // explainer — needs accuracy for classification
const EXPLAIN_MULTIPV   = 5;   // top-5 candidates so the classifier can reason
                               // about "only move", second-best, etc.

function normalizeToWhite(score, turn) {
  return turn === 'w' ? score : -score;
}

function mateToWhite(mate, turn) {
  if (mate === null || mate === undefined) return null;
  return turn === 'w' ? mate : -mate;
}

async function ensureReady() {
  await engine.init();
}

export async function getTopMoves(fen, count = 10) {
  await ensureReady();
  const turn = getSideToMove(fen);
  const result = await engine.analyzeMultiPV(fen, Math.min(count, 10), TOP_MOVES_DEPTH);
  const moves = result.moves.map(m => {
    const evalCp = normalizeToWhite(m.score, turn);
    // Local, engine-free tagline for the move and the next couple of plies
    // of its PV. quickExplain is pure chess.js + geometry — fast enough to
    // run for every top move on every position change.
    const top = quickExplain(fen, m.move);
    const pvLine = explainPV(fen, m.pv, 3); // [{san, tagline}, …]
    return {
      rank: m.rank,
      move: m.move,
      san: uciToSan(fen, m.move),
      eval_cp: evalCp,
      eval_pawns: parseFloat((evalCp / 100).toFixed(2)),
      pv: m.pv.map(uci => uciToSan(fen, uci)).slice(0, 3).join(' '),
      isMate: m.mate !== null && m.mate !== undefined,
      mateIn: mateToWhite(m.mate, turn),
      tagline: top.tagline,
      motifs: top.motifs,
      pvLine,
    };
  });
  return {
    fen,
    eval_cp: normalizeToWhite(result.score ?? 0, turn),
    mate: mateToWhite(result.mate, turn),
    moves,
  };
}

export async function getBestMove(fen) {
  await ensureReady();
  const turn = getSideToMove(fen);
  const result = await engine.getBestMove(fen, BEST_MOVE_DEPTH);
  const from = result.bestMove.slice(0, 2);
  const to = result.bestMove.slice(2, 4);
  return {
    fen,
    bestMove: result.bestMove,
    san: uciToSan(fen, result.bestMove),
    from,
    to,
    eval_cp: normalizeToWhite(result.score ?? 0, turn),
    mate: mateToWhite(result.mate, turn),
    pv: result.pv.slice(0, 5).map(uci => uciToSan(fen, uci)),
  };
}

export async function explainMoveAt(fen, moveUCI) {
  await ensureReady();
  const turn = getSideToMove(fen);

  // Top-5 search at the explain depth gives us:
  //   - the engine's best move and 2nd-best (for "only-move" detection),
  //   - the played move's score for free if the player picked a top-5 move
  //     (one fewer engine call in the common case),
  //   - richer context for classification.
  const topRes = await engine.analyzeMultiPV(fen, EXPLAIN_MULTIPV, EXPLAIN_DEPTH);

  // Win-rate-before is approximated by the best move's score (the position's
  // value assuming optimal play). This is what Lichess-style classifiers use
  // and avoids a separate single-PV eval call.
  const evalBeforeWhite = normalizeToWhite(topRes.score ?? 0, turn);

  const from = moveUCI.slice(0, 2);
  const to = moveUCI.slice(2, 4);
  const promotion = moveUCI[4] || 'q';
  const newFen = makeMove(fen, from, to, promotion);
  if (!newFen) throw new Error('Invalid move for this position');
  const newTurn = getSideToMove(newFen);

  // Did the player play one of the top-5 moves? If so, reuse its score.
  // The MultiPV `score` is in mover's POV — i.e., the score of the position
  // *after* that move, expressed as how good it is for the original mover.
  // That's exactly the post-move eval we need for `evalAfter`.
  const playedTopEntry = topRes.moves.find(m => m.move === moveUCI);

  let evalAfterWhite;
  let mateAfter = null;
  if (playedTopEntry) {
    // Convert mover-POV → white POV.
    evalAfterWhite = moverScoreToWhite(playedTopEntry.score, turn);
    mateAfter = mateToWhite(playedTopEntry.mate, turn);
  } else {
    // Player played outside the top-5 — fall back to a separate eval.
    const evalAfterRes = await engine.evaluate(newFen, EXPLAIN_DEPTH);
    evalAfterWhite = normalizeToWhite(evalAfterRes.cp, newTurn);
    mateAfter = mateToWhite(evalAfterRes.mate, newTurn);
  }

  const explanation = explainMove(
    fen, newFen, moveUCI, evalBeforeWhite, evalAfterWhite,
    {
      topMoves: topRes.moves,
      mateAfter,
    },
  );

  return { fen, newFen, move: moveUCI, ...explanation };
}

function moverScoreToWhite(scoreMoverPOV, moverColor) {
  return moverColor === 'w' ? scoreMoverPOV : -scoreMoverPOV;
}

export { engine };
