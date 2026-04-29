const express = require('express');
const router = express.Router();
const engine = require('./engine');
const chess = require('./chess');
const explainer = require('./explainer');

function normalizeToWhite(score, turn) {
  return turn === 'w' ? score : -score;
}

function mateToWhite(mate, turn) {
  if (mate === null || mate === undefined) return null;
  return turn === 'w' ? mate : -mate;
}

function validateFen(req, res) {
  const { fen } = req.body || {};
  if (!fen || typeof fen !== 'string') {
    res.status(400).json({ error: 'FEN is required (string)' });
    return null;
  }
  if (!chess.isValidFen(fen)) {
    res.status(400).json({ error: 'Invalid FEN string' });
    return null;
  }
  return fen;
}

function squareValid(s) {
  return typeof s === 'string' && /^[a-h][1-8]$/.test(s);
}

function handleError(res, label, err) {
  console.error(`[${label}]`, err);
  const status = /timed out|aborted/i.test(err.message) ? 504 : 500;
  res.status(status).json({ error: `${label} failed`, message: err.message });
}

// Shared logic for /piece-values and /heatmap/current.
async function computePieceValues(fen) {
  const turn = chess.getSideToMove(fen);
  const baseRes = await engine.evaluate(fen);
  const baseEvalCp = normalizeToWhite(baseRes.cp, turn);
  const pieces = chess.getPieces(fen);
  const results = [];
  for (const piece of pieces) {
    let deltaCp = 0;
    if (piece.type !== 'k') {
      const fenWithoutPiece = chess.removePiece(fen, piece.square);
      const evalRes = await engine.evaluate(fenWithoutPiece);
      const evalWithout = normalizeToWhite(evalRes.cp, turn);
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
  return { baseEvalCp, pieces: results, turn };
}

router.post('/eval', async (req, res) => {
  const fen = validateFen(req, res);
  if (!fen) return;
  try {
    const turn = chess.getSideToMove(fen);
    const r = await engine.evaluate(fen);
    res.json({
      eval_cp: normalizeToWhite(r.cp, turn),
      mate: mateToWhite(r.mate, turn),
      status: chess.gameStatus(fen),
    });
  } catch (err) {
    handleError(res, 'Evaluation', err);
  }
});

router.post('/piece-values', async (req, res) => {
  const fen = validateFen(req, res);
  if (!fen) return;
  try {
    const { baseEvalCp, pieces } = await computePieceValues(fen);
    res.json({ fen, eval_cp: baseEvalCp, pieces });
  } catch (err) {
    handleError(res, 'Piece value calculation', err);
  }
});

router.post('/heatmap/current', async (req, res) => {
  const fen = validateFen(req, res);
  if (!fen) return;
  try {
    const { baseEvalCp, pieces } = await computePieceValues(fen);
    const grid = Array(8).fill(null).map(() => Array(8).fill(null));
    for (const p of pieces) {
      const col = p.square.charCodeAt(0) - 'a'.charCodeAt(0);
      const row = 8 - parseInt(p.square[1]);
      grid[row][col] = p.delta_cp;
    }
    res.json({ fen, eval_cp: baseEvalCp, grid, pieces });
  } catch (err) {
    handleError(res, 'Heatmap calculation', err);
  }
});

router.post('/heatmap/mobility', async (req, res) => {
  const fen = validateFen(req, res);
  if (!fen) return;
  const { square } = req.body;
  if (!squareValid(square)) {
    return res.status(400).json({ error: 'Valid square (e.g. "e4") is required' });
  }
  try {
    const turn = chess.getSideToMove(fen);
    const baseRes = await engine.evaluate(fen);
    const baseEvalCp = normalizeToWhite(baseRes.cp, turn);
    const destinations = chess.getLegalDestinations(fen, square);
    const grid = Array(8).fill(null).map(() => Array(8).fill(null));
    const moveValues = [];
    for (const to of destinations) {
      const newFen = chess.makeMove(fen, square, to);
      if (!newFen) continue;
      const newTurn = chess.getSideToMove(newFen);
      const evalRes = await engine.evaluate(newFen);
      const newEvalCp = normalizeToWhite(evalRes.cp, newTurn);
      const delta = turn === 'w' ? newEvalCp - baseEvalCp : baseEvalCp - newEvalCp;
      const col = to.charCodeAt(0) - 'a'.charCodeAt(0);
      const row = 8 - parseInt(to[1]);
      grid[row][col] = delta;
      moveValues.push({
        square: to,
        delta_cp: delta,
        delta_pawns: parseFloat((delta / 100).toFixed(2)),
      });
    }
    res.json({ fen, source_square: square, eval_cp: baseEvalCp, grid, moves: moveValues });
  } catch (err) {
    handleError(res, 'Mobility heatmap calculation', err);
  }
});

router.post('/heatmap/preview', async (req, res) => {
  const fen = validateFen(req, res);
  if (!fen) return;
  const { from, to } = req.body;
  if (!squareValid(from) || !squareValid(to)) {
    return res.status(400).json({ error: 'Valid from/to squares are required' });
  }
  try {
    const newFen = chess.makeMove(fen, from, to);
    if (!newFen) return res.status(400).json({ error: 'Invalid move for this position' });

    const before = await computePieceValues(fen);
    const after = await computePieceValues(newFen);

    const valuesBefore = {};
    for (const p of before.pieces) valuesBefore[p.square] = p.delta_cp;

    const results = after.pieces.map(p => {
      const squareBefore = p.square === to ? from : p.square;
      const valueBefore = valuesBefore[squareBefore] ?? 0;
      const change = p.delta_cp - valueBefore;
      return {
        ...p,
        delta_cp: change,
        delta_pawns: parseFloat((change / 100).toFixed(2)),
        value_before: parseFloat((valueBefore / 100).toFixed(2)),
        value_after: parseFloat((p.delta_cp / 100).toFixed(2)),
      };
    });

    res.json({ fen: newFen, eval_cp: after.baseEvalCp, pieces: results });
  } catch (err) {
    handleError(res, 'Preview calculation', err);
  }
});

router.post('/top-moves', async (req, res) => {
  const fen = validateFen(req, res);
  if (!fen) return;
  const { count = 10 } = req.body;
  const reqCount = Number(count);
  if (!Number.isInteger(reqCount) || reqCount < 1 || reqCount > 10) {
    return res.status(400).json({ error: 'count must be an integer in [1, 10]' });
  }
  try {
    const turn = chess.getSideToMove(fen);
    const result = await engine.analyzeMultiPV(fen, reqCount, 12);
    const moves = result.moves.map(m => {
      const evalCp = normalizeToWhite(m.score, turn);
      return {
        rank: m.rank,
        move: m.move,
        san: chess.uciToSan(fen, m.move),
        eval_cp: evalCp,
        eval_pawns: parseFloat((evalCp / 100).toFixed(2)),
        pv: m.pv.map(uci => chess.uciToSan(fen, uci)).slice(0, 3).join(' '),
        isMate: m.mate !== null && m.mate !== undefined,
        mateIn: mateToWhite(m.mate, turn),
      };
    });
    res.json({
      fen,
      eval_cp: normalizeToWhite(result.score ?? 0, turn),
      mate: mateToWhite(result.mate, turn),
      moves,
    });
  } catch (err) {
    handleError(res, 'Top moves calculation', err);
  }
});

router.post('/best-move', async (req, res) => {
  const fen = validateFen(req, res);
  if (!fen) return;
  try {
    const turn = chess.getSideToMove(fen);
    const result = await engine.getBestMove(fen, 14);
    const from = result.bestMove.slice(0, 2);
    const to = result.bestMove.slice(2, 4);
    res.json({
      fen,
      bestMove: result.bestMove,
      san: chess.uciToSan(fen, result.bestMove),
      from,
      to,
      eval_cp: normalizeToWhite(result.score ?? 0, turn),
      mate: mateToWhite(result.mate, turn),
      pv: result.pv.slice(0, 5).map(uci => chess.uciToSan(fen, uci)),
    });
  } catch (err) {
    handleError(res, 'Best move calculation', err);
  }
});

router.post('/explain-move', async (req, res) => {
  const fen = validateFen(req, res);
  if (!fen) return;
  const { move } = req.body;
  if (!move || typeof move !== 'string' || move.length < 4) {
    return res.status(400).json({ error: 'move (UCI string, e.g. "e2e4") is required' });
  }
  try {
    const turn = chess.getSideToMove(fen);

    // Parallel: eval before, top-2 (for brilliant detection)
    const [evalBeforeRes, topRes] = await Promise.all([
      engine.evaluate(fen, 12),
      engine.analyzeMultiPV(fen, 2, 12),
    ]);
    const evalBeforeNorm = normalizeToWhite(evalBeforeRes.cp, turn);

    const from = move.slice(0, 2);
    const to = move.slice(2, 4);
    const promotion = move[4] || 'q';
    const newFen = chess.makeMove(fen, from, to, promotion);
    if (!newFen) return res.status(400).json({ error: 'Invalid move for this position' });

    const newTurn = chess.getSideToMove(newFen);
    const evalAfterRes = await engine.evaluate(newFen, 12);
    const evalAfterNorm = normalizeToWhite(evalAfterRes.cp, newTurn);

    const explanation = explainer.explainMove(
      fen, newFen, move, evalBeforeNorm, evalAfterNorm,
      {
        topMoves: topRes.moves,
        mateAfter: mateToWhite(evalAfterRes.mate, newTurn),
      },
    );

    res.json({ fen, newFen, move, ...explanation });
  } catch (err) {
    handleError(res, 'Move explanation', err);
  }
});

module.exports = router;
