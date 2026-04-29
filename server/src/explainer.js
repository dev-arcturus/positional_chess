const { Chess } = require('chess.js');

// Piece square tables for positional evaluation
const PST = {
  p: [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [50, 50, 50, 50, 50, 50, 50, 50],
    [10, 10, 20, 30, 30, 20, 10, 10],
    [5, 5, 10, 25, 25, 10, 5, 5],
    [0, 0, 0, 20, 20, 0, 0, 0],
    [5, -5, -10, 0, 0, -10, -5, 5],
    [5, 10, 10, -20, -20, 10, 10, 5],
    [0, 0, 0, 0, 0, 0, 0, 0]
  ],
  n: [
    [-50, -40, -30, -30, -30, -30, -40, -50],
    [-40, -20, 0, 0, 0, 0, -20, -40],
    [-30, 0, 10, 15, 15, 10, 0, -30],
    [-30, 5, 15, 20, 20, 15, 5, -30],
    [-30, 0, 15, 20, 20, 15, 0, -30],
    [-30, 5, 10, 15, 15, 10, 5, -30],
    [-40, -20, 0, 5, 5, 0, -20, -40],
    [-50, -40, -30, -30, -30, -30, -40, -50]
  ],
  b: [
    [-20, -10, -10, -10, -10, -10, -10, -20],
    [-10, 0, 0, 0, 0, 0, 0, -10],
    [-10, 0, 5, 10, 10, 5, 0, -10],
    [-10, 5, 5, 10, 10, 5, 5, -10],
    [-10, 0, 10, 10, 10, 10, 0, -10],
    [-10, 10, 10, 10, 10, 10, 10, -10],
    [-10, 5, 0, 0, 0, 0, 5, -10],
    [-20, -10, -10, -10, -10, -10, -10, -20]
  ],
  r: [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [5, 10, 10, 10, 10, 10, 10, 5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [0, 0, 0, 5, 5, 0, 0, 0]
  ],
  q: [
    [-20, -10, -10, -5, -5, -10, -10, -20],
    [-10, 0, 0, 0, 0, 0, 0, -10],
    [-10, 0, 5, 5, 5, 5, 0, -10],
    [-5, 0, 5, 5, 5, 5, 0, -5],
    [0, 0, 5, 5, 5, 5, 0, -5],
    [-10, 5, 5, 5, 5, 5, 0, -10],
    [-10, 0, 5, 0, 0, 0, 0, -10],
    [-20, -10, -10, -5, -5, -10, -10, -20]
  ],
  k: [
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-20, -30, -30, -40, -40, -30, -30, -20],
    [-10, -20, -20, -20, -20, -20, -20, -10],
    [20, 20, 0, 0, 0, 0, 20, 20],
    [20, 30, 10, 0, 0, 10, 30, 20]
  ]
};

function squareToCoords(square) {
  return {
    file: square.charCodeAt(0) - 'a'.charCodeAt(0),
    rank: parseInt(square[1]) - 1
  };
}

function getPSTValue(pieceType, square, color) {
  const { file, rank } = squareToCoords(square);
  const table = PST[pieceType];
  if (!table) return 0;
  const row = color === 'w' ? 7 - rank : rank;
  return table[row][file];
}

function countMobility(chess, color) {
  const originalTurn = chess.turn();
  // Count legal moves for side
  let count = 0;
  if (originalTurn === color) {
    count = chess.moves().length;
  }
  return count;
}

function getCenterControl(chess) {
  const centerSquares = ['d4', 'd5', 'e4', 'e5'];
  const control = { w: 0, b: 0 };

  for (const sq of centerSquares) {
    const piece = chess.get(sq);
    if (piece) {
      control[piece.color] += piece.type === 'p' ? 30 : 15;
    }
  }
  return control;
}

function getKingSafety(chess, color) {
  const board = chess.board();
  let kingSquare = null;

  // Find king
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const piece = board[r][f];
      if (piece && piece.type === 'k' && piece.color === color) {
        kingSquare = { r, f };
        break;
      }
    }
    if (kingSquare) break;
  }

  if (!kingSquare) return 0;

  // Check pawn shield (simplified)
  let shieldScore = 0;
  const pawnDir = color === 'w' ? -1 : 1;
  const pawnRow = kingSquare.r + pawnDir;

  if (pawnRow >= 0 && pawnRow < 8) {
    for (let df = -1; df <= 1; df++) {
      const f = kingSquare.f + df;
      if (f >= 0 && f < 8) {
        const piece = board[pawnRow][f];
        if (piece && piece.type === 'p' && piece.color === color) {
          shieldScore += 10;
        }
      }
    }
  }

  // Penalize if king is in center during middlegame
  if (kingSquare.f >= 2 && kingSquare.f <= 5) {
    const rank = color === 'w' ? 7 - kingSquare.r : kingSquare.r;
    if (rank > 1) {
      shieldScore -= 20;
    }
  }

  return shieldScore;
}

function analyzePosition(fen) {
  const chess = new Chess(fen);
  const factors = {
    centerControl: getCenterControl(chess),
    kingSafety: {
      w: getKingSafety(chess, 'w'),
      b: getKingSafety(chess, 'b')
    },
    mobility: {
      w: chess.turn() === 'w' ? chess.moves().length : 0,
      b: chess.turn() === 'b' ? chess.moves().length : 0
    }
  };

  // Calculate piece activity from PST
  const board = chess.board();
  let pieceActivity = { w: 0, b: 0 };

  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const piece = board[r][f];
      if (piece) {
        const square = String.fromCharCode('a'.charCodeAt(0) + f) + (8 - r);
        pieceActivity[piece.color] += getPSTValue(piece.type, square, piece.color);
      }
    }
  }

  factors.pieceActivity = pieceActivity;
  return factors;
}

function explainMove(fenBefore, fenAfter, moveUCI, evalBefore, evalAfter) {
  const chessBefore = new Chess(fenBefore);
  const chessAfter = new Chess(fenAfter);

  const from = moveUCI.slice(0, 2);
  const to = moveUCI.slice(2, 4);
  const movingPiece = chessBefore.get(from);
  const captured = chessBefore.get(to);

  const sideToMove = chessBefore.turn();
  const explanations = [];
  const factors = [];

  // Get SAN notation
  let san = '';
  try {
    const move = chessBefore.move({ from, to, promotion: moveUCI[4] || 'q' });
    san = move ? move.san : moveUCI;
    chessBefore.undo();
  } catch {
    san = moveUCI;
  }

  // Eval change from moving player's perspective
  let evalDelta;
  if (sideToMove === 'w') {
    evalDelta = evalAfter - evalBefore;
  } else {
    // For black, flip so positive = good for black
    evalDelta = evalBefore - evalAfter;
  }

  // Classify move quality based on eval change
  let quality;
  if (evalDelta >= 100) {
    quality = 'brilliant';
  } else if (evalDelta >= 20) {
    quality = 'good';
  } else if (evalDelta >= -20) {
    quality = 'neutral';
  } else if (evalDelta >= -50) {
    quality = 'inaccuracy';
  } else if (evalDelta >= -150) {
    quality = 'mistake';
  } else {
    quality = 'blunder';
  }

  // Check for captures
  if (captured) {
    const pieceNames = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen' };
    const pieceValues = { p: 100, n: 300, b: 320, r: 500, q: 900 };
    explanations.push(`Captures the ${pieceNames[captured.type]}`);
    factors.push({ type: 'capture', piece: captured.type, value: pieceValues[captured.type] / 100 });
  }

  // Check for checks
  if (chessAfter.inCheck()) {
    explanations.push('Gives check');
    factors.push({ type: 'check', value: 0.5 });
  }

  // Piece activity improvement using PST
  const pieceNames = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
  if (movingPiece && movingPiece.type !== 'k') {
    const pstBefore = getPSTValue(movingPiece.type, from, movingPiece.color);
    const pstAfter = getPSTValue(movingPiece.type, to, movingPiece.color);
    const improvement = pstAfter - pstBefore;

    if (improvement > 15) {
      explanations.push(`Moves the ${pieceNames[movingPiece.type]} to a more active square`);
      factors.push({ type: 'activity', value: improvement / 100 });
    } else if (improvement < -15) {
      explanations.push(`Moves the ${pieceNames[movingPiece.type]} to a less active position`);
      factors.push({ type: 'activity', value: improvement / 100 });
    }
  }

  // Center control analysis
  const centerSquares = ['d4', 'd5', 'e4', 'e5'];
  if (centerSquares.includes(to) && movingPiece) {
    if (movingPiece.type === 'p') {
      explanations.push('Controls the center with a pawn');
      factors.push({ type: 'center', value: 0.3 });
    } else if (movingPiece.type === 'n' || movingPiece.type === 'b') {
      explanations.push('Places a piece in the center');
      factors.push({ type: 'center', value: 0.2 });
    }
  }

  // Development in opening
  if (movingPiece && (movingPiece.type === 'n' || movingPiece.type === 'b')) {
    const startRank = movingPiece.color === 'w' ? '1' : '8';
    if (from[1] === startRank) {
      explanations.push(`Develops the ${pieceNames[movingPiece.type]}`);
      factors.push({ type: 'development', value: 0.25 });
    }
  }

  // Castling
  if (san === 'O-O' || san === 'O-O-O') {
    explanations.push('Castles to safety');
    factors.push({ type: 'castling', value: 0.5 });
  }

  // King safety threat
  const opponentKingSquare = findKing(chessAfter, sideToMove === 'w' ? 'b' : 'w');
  if (opponentKingSquare && movingPiece) {
    const distBefore = squareDistance(from, opponentKingSquare);
    const distAfter = squareDistance(to, opponentKingSquare);
    if (distAfter < distBefore && (movingPiece.type === 'q' || movingPiece.type === 'r')) {
      explanations.push('Increases pressure on the opponent\'s king');
      factors.push({ type: 'king_attack', value: 0.3 });
    }
  }

  // Generate summary based on quality
  let summary;
  switch (quality) {
    case 'brilliant':
      summary = 'An excellent move that significantly improves the position!';
      break;
    case 'good':
      summary = 'A good move that strengthens the position.';
      break;
    case 'neutral':
      summary = 'A solid move that maintains the balance.';
      break;
    case 'inaccuracy':
      summary = 'A slight inaccuracy that gives up some advantage.';
      break;
    case 'mistake':
      summary = 'A mistake that weakens the position.';
      break;
    case 'blunder':
      summary = 'A serious blunder that loses significant advantage.';
      break;
    default:
      summary = 'A move.';
  }

  const details = explanations.length > 0
    ? explanations.join('. ') + '.'
    : 'A quiet positional move.';

  return {
    san,
    summary,
    details,
    quality,
    factors,
    evalBefore: evalBefore / 100,
    evalAfter: evalAfter / 100,
    evalDelta: evalDelta / 100
  };
}

function findKing(chess, color) {
  const board = chess.board();
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const piece = board[r][f];
      if (piece && piece.type === 'k' && piece.color === color) {
        return String.fromCharCode('a'.charCodeAt(0) + f) + (8 - r);
      }
    }
  }
  return null;
}

function squareDistance(sq1, sq2) {
  const f1 = sq1.charCodeAt(0) - 'a'.charCodeAt(0);
  const r1 = parseInt(sq1[1]) - 1;
  const f2 = sq2.charCodeAt(0) - 'a'.charCodeAt(0);
  const r2 = parseInt(sq2[1]) - 1;
  return Math.max(Math.abs(f1 - f2), Math.abs(r1 - r2));
}

module.exports = {
  explainMove,
  analyzePosition,
  getPSTValue
};
