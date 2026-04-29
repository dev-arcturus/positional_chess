const express = require('express');
const router = express.Router();
const engine = require('./engine');
const chess = require('./chess');

// Helper to normalize score to White's perspective always
function normalizeToWhite(score, turn) {
  return turn === 'w' ? score : -score;
}

router.post('/eval', async (req, res) => {
  try {
    const { fen } = req.body;
    if (!fen) return res.status(400).json({ error: 'FEN is required' });

    const turn = chess.getSideToMove(fen);
    const score = await engine.evaluate(fen);
    const evalCp = normalizeToWhite(score, turn);

    res.json({ eval_cp: evalCp });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Evaluation failed' });
  }
});

router.post('/piece-values', async (req, res) => {
  try {
    const { fen } = req.body;
    if (!fen) return res.status(400).json({ error: 'FEN is required' });

    const turn = chess.getSideToMove(fen);
    const baseScore = await engine.evaluate(fen);
    const baseEvalCp = normalizeToWhite(baseScore, turn);
    const pieces = chess.getPieces(fen);
    const results = [];

    for (const piece of pieces) {
      let deltaCp = 0;
      if (piece.type === 'k') {
        deltaCp = 0;
      } else {
        const fenWithoutPiece = chess.removePiece(fen, piece.square);
        const scoreWithout = await engine.evaluate(fenWithoutPiece);
        const evalWithout = normalizeToWhite(scoreWithout, turn);
        // Value from the piece owner's perspective
        deltaCp = piece.color === 'w'
          ? baseEvalCp - evalWithout
          : evalWithout - baseEvalCp;
      }

      results.push({
        ...piece,
        delta_cp: deltaCp,
        delta_pawns: parseFloat((deltaCp / 100).toFixed(2))
      });
    }

    res.json({
      fen,
      eval_cp: baseEvalCp,
      pieces: results
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Piece value calculation failed' });
  }
});

router.post('/heatmap/current', async (req, res) => {
  try {
    const { fen } = req.body;
    if (!fen) return res.status(400).json({ error: 'FEN is required' });

    const turn = chess.getSideToMove(fen);
    const baseScore = await engine.evaluate(fen);
    const baseEvalCp = normalizeToWhite(baseScore, turn);
    const pieces = chess.getPieces(fen);
    const results = [];

    for (const piece of pieces) {
      let deltaCp = 0;
      if (piece.type === 'k') {
        deltaCp = 0;
      } else {
        const fenWithoutPiece = chess.removePiece(fen, piece.square);
        const scoreWithout = await engine.evaluate(fenWithoutPiece);
        const evalWithout = normalizeToWhite(scoreWithout, turn);
        // Value from the piece owner's perspective (positive = good for owner)
        deltaCp = piece.color === 'w'
          ? baseEvalCp - evalWithout
          : evalWithout - baseEvalCp;
      }
      results.push({
        ...piece,
        delta_cp: deltaCp,
        delta_pawns: parseFloat((deltaCp / 100).toFixed(2))
      });
    }

    const grid = Array(8).fill(null).map(() => Array(8).fill(null));
    results.forEach(p => {
      const col = p.square.charCodeAt(0) - 'a'.charCodeAt(0);
      const row = 8 - parseInt(p.square[1]);
      grid[row][col] = p.delta_cp;
    });

    res.json({
      fen,
      eval_cp: baseEvalCp,
      grid,
      pieces: results
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Heatmap calculation failed' });
  }
});

// Mobility heatmap - from the moving player's perspective
router.post('/heatmap/mobility', async (req, res) => {
  try {
    const { fen, square } = req.body;
    if (!fen || !square) return res.status(400).json({ error: 'FEN and square are required' });

    const turn = chess.getSideToMove(fen);
    const baseScore = await engine.evaluate(fen);
    const baseEvalCp = normalizeToWhite(baseScore, turn);

    const legalMoves = chess.getLegalMoves(fen, square);
    const grid = Array(8).fill(null).map(() => Array(8).fill(null));
    const moveValues = [];

    for (const move of legalMoves) {
      const newFen = chess.makeMove(fen, square, move.to);
      if (newFen) {
        const newTurn = chess.getSideToMove(newFen);
        const newScore = await engine.evaluate(newFen);
        const newEvalCp = normalizeToWhite(newScore, newTurn);

        // Delta from moving player's perspective
        // If White moved: positive delta = good for White
        // If Black moved: we want positive delta = good for Black
        let delta;
        if (turn === 'w') {
          delta = newEvalCp - baseEvalCp;
        } else {
          delta = baseEvalCp - newEvalCp; // Flip for black's perspective
        }

        const col = move.to.charCodeAt(0) - 'a'.charCodeAt(0);
        const row = 8 - parseInt(move.to[1]);
        grid[row][col] = delta;

        moveValues.push({
          square: move.to,
          delta_cp: delta,
          delta_pawns: parseFloat((delta / 100).toFixed(2))
        });
      }
    }

    res.json({
      fen,
      source_square: square,
      eval_cp: baseEvalCp,
      grid,
      moves: moveValues
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Mobility heatmap calculation failed' });
  }
});

// Preview - show RELATIVE change in each piece's value after a hypothetical move
router.post('/heatmap/preview', async (req, res) => {
  try {
    const { fen, from, to } = req.body;
    if (!fen || !from || !to) return res.status(400).json({ error: 'FEN, from, and to are required' });

    // Get piece values BEFORE the move
    const turnBefore = chess.getSideToMove(fen);
    const baseScoreBefore = await engine.evaluate(fen);
    const baseEvalBefore = normalizeToWhite(baseScoreBefore, turnBefore);
    const piecesBefore = chess.getPieces(fen);

    const valuesBefore = {};
    for (const piece of piecesBefore) {
      if (piece.type === 'k') {
        valuesBefore[piece.square] = 0;
      } else {
        const fenWithout = chess.removePiece(fen, piece.square);
        const scoreWithout = await engine.evaluate(fenWithout);
        const evalWithout = normalizeToWhite(scoreWithout, turnBefore);
        valuesBefore[piece.square] = piece.color === 'w'
          ? baseEvalBefore - evalWithout
          : evalWithout - baseEvalBefore;
      }
    }

    // Make the move
    const newFen = chess.makeMove(fen, from, to);
    if (!newFen) {
      return res.status(400).json({ error: 'Invalid move' });
    }

    // Get piece values AFTER the move
    const turnAfter = chess.getSideToMove(newFen);
    const baseScoreAfter = await engine.evaluate(newFen);
    const baseEvalAfter = normalizeToWhite(baseScoreAfter, turnAfter);
    const piecesAfter = chess.getPieces(newFen);

    const results = [];
    for (const piece of piecesAfter) {
      let valueAfter = 0;
      if (piece.type !== 'k') {
        const fenWithout = chess.removePiece(newFen, piece.square);
        const scoreWithout = await engine.evaluate(fenWithout);
        const evalWithout = normalizeToWhite(scoreWithout, turnAfter);
        valueAfter = piece.color === 'w'
          ? baseEvalAfter - evalWithout
          : evalWithout - baseEvalAfter;
      }

      // Find the piece's previous value (it may have moved)
      // The piece that moved is at 'to' but was at 'from'
      let squareBefore = piece.square;
      if (piece.square === to) {
        squareBefore = from;
      }

      const valueBefore = valuesBefore[squareBefore] || 0;
      const change = valueAfter - valueBefore;

      results.push({
        ...piece,
        delta_cp: change,
        delta_pawns: parseFloat((change / 100).toFixed(2)),
        value_before: parseFloat((valueBefore / 100).toFixed(2)),
        value_after: parseFloat((valueAfter / 100).toFixed(2))
      });
    }

    res.json({
      fen: newFen,
      eval_cp: baseEvalAfter,
      pieces: results
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Preview calculation failed' });
  }
});

// Top N moves using MultiPV analysis
router.post('/top-moves', async (req, res) => {
  try {
    const { fen, count = 10 } = req.body;
    if (!fen) return res.status(400).json({ error: 'FEN is required' });

    const turn = chess.getSideToMove(fen);
    const result = await engine.analyzeMultiPV(fen, Math.min(count, 10), 12);

    const moves = result.moves.map(m => ({
      rank: m.rank,
      move: m.move,
      san: chess.uciToSan(fen, m.move),
      eval_cp: normalizeToWhite(m.score, turn),
      eval_pawns: parseFloat((normalizeToWhite(m.score, turn) / 100).toFixed(2)),
      pv: m.pv.map(uci => chess.uciToSan(fen, uci)).slice(0, 3).join(' '),
      isMate: m.isMate,
      mateIn: m.mateIn
    }));

    res.json({
      fen,
      eval_cp: normalizeToWhite(result.score, turn),
      moves
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Top moves calculation failed' });
  }
});

// Best move with hint data
router.post('/best-move', async (req, res) => {
  try {
    const { fen } = req.body;
    if (!fen) return res.status(400).json({ error: 'FEN is required' });

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
      eval_cp: normalizeToWhite(result.score, turn),
      pv: result.pv.slice(0, 5).map(uci => chess.uciToSan(fen, uci))
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Best move calculation failed' });
  }
});

// Explain a move
const explainer = require('./explainer');

router.post('/explain-move', async (req, res) => {
  try {
    const { fen, move } = req.body;
    if (!fen || !move) return res.status(400).json({ error: 'FEN and move are required' });

    const turn = chess.getSideToMove(fen);

    // Get eval before
    const evalBefore = await engine.evaluate(fen, 10);
    const evalBeforeNorm = normalizeToWhite(evalBefore, turn);

    // Make the move
    const from = move.slice(0, 2);
    const to = move.slice(2, 4);
    const newFen = chess.makeMove(fen, from, to);

    if (!newFen) {
      return res.status(400).json({ error: 'Invalid move' });
    }

    // Get eval after
    const newTurn = chess.getSideToMove(newFen);
    const evalAfter = await engine.evaluate(newFen, 10);
    const evalAfterNorm = normalizeToWhite(evalAfter, newTurn);

    // Generate explanation
    const explanation = explainer.explainMove(fen, newFen, move, evalBeforeNorm, evalAfterNorm);

    res.json({
      fen,
      newFen,
      move,
      ...explanation
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Move explanation failed' });
  }
});

module.exports = router;
