// High-level analysis API consumed by the UI.
// Shapes match the (deprecated) server endpoints so Board.jsx stays
// almost unchanged: getTopMoves / getBestMove / explainMoveAt.

import engine from './engine';
import { uciToSan, makeMove, getSideToMove } from './chess';
import { explainMove } from './explainer';

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
  const result = await engine.analyzeMultiPV(fen, Math.min(count, 10), 12);
  const moves = result.moves.map(m => {
    const evalCp = normalizeToWhite(m.score, turn);
    return {
      rank: m.rank,
      move: m.move,
      san: uciToSan(fen, m.move),
      eval_cp: evalCp,
      eval_pawns: parseFloat((evalCp / 100).toFixed(2)),
      pv: m.pv.map(uci => uciToSan(fen, uci)).slice(0, 3).join(' '),
      isMate: m.mate !== null && m.mate !== undefined,
      mateIn: mateToWhite(m.mate, turn),
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
  const result = await engine.getBestMove(fen, 14);
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

  const [evalBeforeRes, topRes] = await Promise.all([
    engine.evaluate(fen, 12),
    engine.analyzeMultiPV(fen, 2, 12),
  ]);
  const evalBeforeNorm = normalizeToWhite(evalBeforeRes.cp, turn);

  const from = moveUCI.slice(0, 2);
  const to = moveUCI.slice(2, 4);
  const promotion = moveUCI[4] || 'q';
  const newFen = makeMove(fen, from, to, promotion);
  if (!newFen) throw new Error('Invalid move for this position');

  const newTurn = getSideToMove(newFen);
  const evalAfterRes = await engine.evaluate(newFen, 12);
  const evalAfterNorm = normalizeToWhite(evalAfterRes.cp, newTurn);

  const explanation = explainMove(
    fen, newFen, moveUCI, evalBeforeNorm, evalAfterNorm,
    {
      topMoves: topRes.moves,
      mateAfter: mateToWhite(evalAfterRes.mate, newTurn),
    },
  );
  return { fen, newFen, move: moveUCI, ...explanation };
}

export { engine };
