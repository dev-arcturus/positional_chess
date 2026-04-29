const { Chess } = require('chess.js');

function getPieces(fen) {
  const chess = new Chess(fen);
  const pieces = [];
  const board = chess.board();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const piece = board[r][c];
      if (piece) {
        pieces.push({
          square: String.fromCharCode('a'.charCodeAt(0) + c) + (8 - r),
          type: piece.type,
          color: piece.color,
        });
      }
    }
  }
  return pieces;
}

function removePiece(fen, square) {
  const chess = new Chess(fen);
  chess.remove(square);
  return chess.fen();
}

function getSideToMove(fen) {
  return new Chess(fen).turn();
}

function getLegalMoves(fen, square) {
  const chess = new Chess(fen);
  return chess.moves({ square, verbose: true })
    .map(m => ({ to: m.to, san: m.san, flags: m.flags, promotion: m.promotion }));
}

// Unique destination squares for a piece — collapses promotion variants.
function getLegalDestinations(fen, square) {
  const chess = new Chess(fen);
  const seen = new Set();
  const out = [];
  for (const m of chess.moves({ square, verbose: true })) {
    if (!seen.has(m.to)) {
      seen.add(m.to);
      out.push(m.to);
    }
  }
  return out;
}

function makeMove(fen, from, to, promotion = 'q') {
  try {
    const chess = new Chess(fen);
    const move = chess.move({ from, to, promotion });
    if (move) return chess.fen();
  } catch (e) {
    // chess.js throws on illegal moves; treat as null result.
  }
  return null;
}

function isValidFen(fen) {
  if (typeof fen !== 'string' || fen.trim().length === 0) return false;
  try {
    new Chess(fen);
    return true;
  } catch {
    return false;
  }
}

function uciToSan(fen, uci) {
  if (typeof uci !== 'string' || uci.length < 4) return uci;
  try {
    const chess = new Chess(fen);
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci[4] || undefined;
    const move = chess.move({ from, to, promotion });
    return move ? move.san : uci;
  } catch {
    return uci;
  }
}

function getAllLegalMoves(fen) {
  try {
    return new Chess(fen).moves({ verbose: true });
  } catch {
    return [];
  }
}

// Game-end detection used by API and explainer.
function gameStatus(fen) {
  try {
    const chess = new Chess(fen);
    return {
      inCheck: chess.inCheck(),
      isCheckmate: chess.isCheckmate(),
      isStalemate: chess.isStalemate(),
      isDraw: chess.isDraw(),
      isInsufficientMaterial: chess.isInsufficientMaterial(),
      isThreefoldRepetition: chess.isThreefoldRepetition(),
      isDrawByFiftyMoves: chess.isDrawByFiftyMoves(),
      moveNumber: chess.moveNumber(),
    };
  } catch {
    return null;
  }
}

module.exports = {
  getPieces,
  removePiece,
  getSideToMove,
  getLegalMoves,
  getLegalDestinations,
  makeMove,
  isValidFen,
  uciToSan,
  getAllLegalMoves,
  gameStatus,
};
