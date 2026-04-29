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
          color: piece.color
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
  const chess = new Chess(fen);
  return chess.turn();
}

function getLegalMoves(fen, square) {
  const chess = new Chess(fen);
  const moves = chess.moves({ square, verbose: true });
  return moves.map(m => ({ to: m.to, san: m.san }));
}

// Make a legal move and return the new FEN
function makeMove(fen, from, to) {
  try {
    const chess = new Chess(fen);
    const move = chess.move({ from, to, promotion: 'q' });
    if (move) {
      return chess.fen();
    }
  } catch (e) {
    console.error("makeMove error:", e);
  }
  return null;
}

function isValidFen(fen) {
  try {
    new Chess(fen);
    return true;
  } catch {
    return false;
  }
}

function uciToSan(fen, uci) {
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
    const chess = new Chess(fen);
    return chess.moves({ verbose: true });
  } catch {
    return [];
  }
}

module.exports = {
  getPieces,
  removePiece,
  getSideToMove,
  getLegalMoves,
  makeMove,
  isValidFen,
  uciToSan,
  getAllLegalMoves
};
