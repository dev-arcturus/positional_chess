const { Chess } = require('chess.js');

const PIECE_VALUE = { p: 100, n: 300, b: 320, r: 500, q: 900, k: 20_000 };
const PIECE_NAME  = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

const PST = {
  p: [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [50, 50, 50, 50, 50, 50, 50, 50],
    [10, 10, 20, 30, 30, 20, 10, 10],
    [5, 5, 10, 25, 25, 10, 5, 5],
    [0, 0, 0, 20, 20, 0, 0, 0],
    [5, -5, -10, 0, 0, -10, -5, 5],
    [5, 10, 10, -20, -20, 10, 10, 5],
    [0, 0, 0, 0, 0, 0, 0, 0],
  ],
  n: [
    [-50, -40, -30, -30, -30, -30, -40, -50],
    [-40, -20, 0, 0, 0, 0, -20, -40],
    [-30, 0, 10, 15, 15, 10, 0, -30],
    [-30, 5, 15, 20, 20, 15, 5, -30],
    [-30, 0, 15, 20, 20, 15, 0, -30],
    [-30, 5, 10, 15, 15, 10, 5, -30],
    [-40, -20, 0, 5, 5, 0, -20, -40],
    [-50, -40, -30, -30, -30, -30, -40, -50],
  ],
  b: [
    [-20, -10, -10, -10, -10, -10, -10, -20],
    [-10, 0, 0, 0, 0, 0, 0, -10],
    [-10, 0, 5, 10, 10, 5, 0, -10],
    [-10, 5, 5, 10, 10, 5, 5, -10],
    [-10, 0, 10, 10, 10, 10, 0, -10],
    [-10, 10, 10, 10, 10, 10, 10, -10],
    [-10, 5, 0, 0, 0, 0, 5, -10],
    [-20, -10, -10, -10, -10, -10, -10, -20],
  ],
  r: [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [5, 10, 10, 10, 10, 10, 10, 5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [0, 0, 0, 5, 5, 0, 0, 0],
  ],
  q: [
    [-20, -10, -10, -5, -5, -10, -10, -20],
    [-10, 0, 0, 0, 0, 0, 0, -10],
    [-10, 0, 5, 5, 5, 5, 0, -10],
    [-5, 0, 5, 5, 5, 5, 0, -5],
    [0, 0, 5, 5, 5, 5, 0, -5],
    [-10, 5, 5, 5, 5, 5, 0, -10],
    [-10, 0, 5, 0, 0, 0, 0, -10],
    [-20, -10, -10, -5, -5, -10, -10, -20],
  ],
  k: [
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-20, -30, -30, -40, -40, -30, -30, -20],
    [-10, -20, -20, -20, -20, -20, -20, -10],
    [20, 20, 0, 0, 0, 0, 20, 20],
    [20, 30, 10, 0, 0, 10, 30, 20],
  ],
};

function squareToFR(sq) {
  return [sq.charCodeAt(0) - 97, parseInt(sq[1], 10) - 1];
}

function frToSquare(file, rank) {
  return String.fromCharCode(97 + file) + (rank + 1);
}

function getPSTValue(pieceType, square, color) {
  const [file, rank] = squareToFR(square);
  const table = PST[pieceType];
  if (!table) return 0;
  const row = color === 'w' ? 7 - rank : rank;
  return table[row][file];
}

// Lichess-style win-rate from white's perspective (0..100).
// 1pp ≈ ~25cp swing near equal; flattens at large advantages.
function winRate(cpWhitePOV) {
  const clamped = Math.max(-2000, Math.min(2000, cpWhitePOV));
  return 100 / (1 + Math.exp(-clamped / 300));
}

// Win-rate delta from MOVER's perspective. Positive = mover gained.
function winRateDelta(evalBeforeWhite, evalAfterWhite, moverColor) {
  const wrBefore = winRate(evalBeforeWhite);
  const wrAfter = winRate(evalAfterWhite);
  return moverColor === 'w' ? (wrAfter - wrBefore) : (wrBefore - wrAfter);
}

function classifyByWinRateDelta(wrDelta) {
  if (wrDelta >= 5)  return 'great';
  if (wrDelta >= -2) return 'good';
  if (wrDelta >= -5) return 'neutral';
  if (wrDelta >= -10) return 'inaccuracy';
  if (wrDelta >= -20) return 'mistake';
  return 'blunder';
}

function findKing(chess, color) {
  const board = chess.board();
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = board[r][f];
      if (p && p.type === 'k' && p.color === color) {
        return frToSquare(f, 7 - r);
      }
    }
  }
  return null;
}

function squareDistance(sq1, sq2) {
  const [f1, r1] = squareToFR(sq1);
  const [f2, r2] = squareToFR(sq2);
  return Math.max(Math.abs(f1 - f2), Math.abs(r1 - r2));
}

function iterateBoardSquares(chess, callback) {
  const board = chess.board();
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const piece = board[r][f];
      if (piece) callback(frToSquare(f, 7 - r), piece);
    }
  }
}

// Squares that the piece on `fromSquare` attacks (own-color squares included).
function squaresAttackedFrom(chess, fromSquare) {
  const piece = chess.get(fromSquare);
  if (!piece) return [];
  const attacked = [];
  iterateBoardSquares(chess, (sq) => {
    if (sq === fromSquare) return;
    const attackers = chess.attackers(sq, piece.color);
    if (attackers && attackers.includes(fromSquare)) attacked.push(sq);
  });
  return attacked;
}

// Cheapest exchange: is the piece on `square` losing material if captured now?
// Approximation of Static Exchange Evaluation:
//   - if no attackers → safe
//   - if attackers but no defenders → hanging
//   - if cheapest attacker < piece value → losing material
function isHanging(chess, square) {
  const piece = chess.get(square);
  if (!piece || piece.type === 'k') return false;
  const opponent = piece.color === 'w' ? 'b' : 'w';
  const attackers = chess.attackers(square, opponent);
  if (!attackers || attackers.length === 0) return false;
  const defenders = chess.attackers(square, piece.color);
  if (!defenders || defenders.length === 0) return true;
  const minAttackerVal = Math.min(
    ...attackers.map(s => PIECE_VALUE[chess.get(s).type])
  );
  return minAttackerVal < PIECE_VALUE[piece.type];
}

function detectFork(chessAfter, toSquare, movingPiece) {
  const opponent = movingPiece.color === 'w' ? 'b' : 'w';
  const attacked = squaresAttackedFrom(chessAfter, toSquare).filter(sq => {
    const p = chessAfter.get(sq);
    return p && p.color === opponent;
  });
  if (attacked.length < 2) return null;

  const targets = attacked.map(sq => ({ square: sq, type: chessAfter.get(sq).type }));
  const moverVal = PIECE_VALUE[movingPiece.type];
  const significant = targets.filter(t =>
    t.type === 'k' || PIECE_VALUE[t.type] > moverVal
  );
  if (significant.length === 0) return null;
  return targets;
}

function detectDiscoveredCheck(chessAfter, toSquare, movingPiece) {
  if (!chessAfter.inCheck()) return false;
  const opponent = movingPiece.color === 'w' ? 'b' : 'w';
  const kingSq = findKing(chessAfter, opponent);
  if (!kingSq) return false;
  const checkers = chessAfter.attackers(kingSq, movingPiece.color);
  if (!checkers || checkers.length === 0) return false;
  return !checkers.includes(toSquare);
}

function rayDirections(pieceType) {
  if (pieceType === 'r') return [[1, 0], [-1, 0], [0, 1], [0, -1]];
  if (pieceType === 'b') return [[1, 1], [-1, 1], [1, -1], [-1, -1]];
  if (pieceType === 'q') return [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [-1, 1], [1, -1], [-1, -1],
  ];
  return [];
}

// Pin: along a ray from the moving piece, the first enemy is less valuable than the second.
function detectPin(chessAfter, toSquare, movingPiece) {
  if (!['b', 'r', 'q'].includes(movingPiece.type)) return null;
  const opponent = movingPiece.color === 'w' ? 'b' : 'w';
  const [fromFile, fromRank] = squareToFR(toSquare);

  for (const [df, dr] of rayDirections(movingPiece.type)) {
    let first = null;
    let second = null;
    for (let i = 1; i < 8; i++) {
      const f = fromFile + df * i;
      const r = fromRank + dr * i;
      if (f < 0 || f > 7 || r < 0 || r > 7) break;
      const sq = frToSquare(f, r);
      const piece = chessAfter.get(sq);
      if (!piece) continue;
      if (!first) {
        if (piece.color === opponent) {
          first = { square: sq, type: piece.type };
        } else {
          break;
        }
      } else {
        if (piece.color === opponent) second = { square: sq, type: piece.type };
        break;
      }
    }
    if (first && second && PIECE_VALUE[second.type] > PIECE_VALUE[first.type]) {
      return { pinned: first, behind: second };
    }
  }
  return null;
}

// Did capturing the piece on `capturedSquare` leave a friendly-of-captured piece hanging
// that wasn't hanging before? (Removal-of-defender motif.)
function detectRemovalOfDefender(chessBefore, chessAfter, capturedSquare) {
  if (!capturedSquare) return null;
  const captured = chessBefore.get(capturedSquare);
  if (!captured) return null;

  let result = null;
  iterateBoardSquares(chessAfter, (sq, piece) => {
    if (result) return;
    if (piece.color !== captured.color || piece.type === 'k') return;
    const defendersBefore = chessBefore.attackers(sq, captured.color);
    if (!defendersBefore || !defendersBefore.includes(capturedSquare)) return;
    if (!isHanging(chessBefore, sq) && isHanging(chessAfter, sq)) {
      result = { square: sq, type: piece.type };
    }
  });
  return result;
}

// Sacrifice: the moving piece is now hanging for net material loss ≥ 200cp.
function detectSacrifice(chessAfter, toSquare, movingPiece, capturedPiece) {
  if (!isHanging(chessAfter, toSquare)) return false;
  const moverVal = PIECE_VALUE[movingPiece.type];
  const recoveryVal = capturedPiece ? PIECE_VALUE[capturedPiece.type] : 0;
  return (moverVal - recoveryVal) >= 200;
}

// Build the SAN + Move metadata for the move.
function getMoveMeta(fenBefore, moveUCI) {
  const chess = new Chess(fenBefore);
  const from = moveUCI.slice(0, 2);
  const to = moveUCI.slice(2, 4);
  const promotion = moveUCI[4] || 'q';
  try {
    const m = chess.move({ from, to, promotion });
    if (m) return { san: m.san, flags: m.flags, promotion: m.promotion };
  } catch { /* fallthrough */ }
  return { san: moveUCI, flags: '', promotion: null };
}

function explainMove(fenBefore, fenAfter, moveUCI, evalBefore, evalAfter, opts = {}) {
  const chessBefore = new Chess(fenBefore);
  const chessAfter = new Chess(fenAfter);

  const from = moveUCI.slice(0, 2);
  const to = moveUCI.slice(2, 4);
  const movingPiece = chessBefore.get(from);
  const captured = chessBefore.get(to);
  const sideToMove = chessBefore.turn();
  const opponent = sideToMove === 'w' ? 'b' : 'w';

  const { san, flags, promotion: promotedTo } = getMoveMeta(fenBefore, moveUCI);
  const explanations = [];
  const factors = [];
  const motifs = [];

  // Win-rate based classification
  const wrDelta = winRateDelta(evalBefore, evalAfter, sideToMove);
  let quality = classifyByWinRateDelta(wrDelta);

  // Eval delta from mover's POV (in cp)
  const evalDeltaCp = sideToMove === 'w'
    ? (evalAfter - evalBefore)
    : (evalBefore - evalAfter);

  // ----- Terminal-state shortcuts -----
  if (chessAfter.isCheckmate()) {
    return {
      san,
      summary: 'Checkmate!',
      details: 'Delivers checkmate. The opponent has no legal response.',
      quality: 'brilliant',
      factors: [{ type: 'checkmate', value_pawns: 100 }],
      motifs: ['checkmate'],
      evalBefore: evalBefore / 100,
      evalAfter: evalAfter / 100,
      evalDelta: evalDeltaCp / 100,
      winRateDelta: parseFloat(wrDelta.toFixed(2)),
      isTopMove: isPlayerMoveTopEngine(opts.topMoves, moveUCI),
    };
  }

  if (chessAfter.isStalemate()) {
    const wasWinning = sideToMove === 'w' ? evalBefore > 200 : evalBefore < -200;
    return {
      san,
      summary: wasWinning ? 'Stalemate — throws away the win!' : 'Stalemate (draw)',
      details: 'The opponent has no legal moves and is not in check.',
      quality: wasWinning ? 'blunder' : 'neutral',
      factors: [{ type: 'stalemate', value_pawns: 0 }],
      motifs: ['stalemate'],
      evalBefore: evalBefore / 100,
      evalAfter: 0,
      evalDelta: wasWinning ? -evalBefore / 100 : 0,
      winRateDelta: parseFloat(wrDelta.toFixed(2)),
      isTopMove: isPlayerMoveTopEngine(opts.topMoves, moveUCI),
    };
  }

  if (chessAfter.isThreefoldRepetition()) motifs.push('threefold-repetition');
  if (chessAfter.isDrawByFiftyMoves()) motifs.push('fifty-move-rule');
  if (chessAfter.isInsufficientMaterial()) motifs.push('insufficient-material');

  // ----- Capture -----
  if (captured) {
    explanations.push(`Captures the ${PIECE_NAME[captured.type]}`);
    factors.push({
      type: 'capture',
      piece: captured.type,
      value_pawns: PIECE_VALUE[captured.type] / 100,
    });
    motifs.push('capture');
  }

  // ----- Castling via Move flags (not SAN) -----
  if (flags.includes('k')) {
    explanations.push('Castles kingside');
    factors.push({ type: 'castling', side: 'king', value_pawns: 0.5 });
    motifs.push('castling-kingside');
  } else if (flags.includes('q')) {
    explanations.push('Castles queenside');
    factors.push({ type: 'castling', side: 'queen', value_pawns: 0.5 });
    motifs.push('castling-queenside');
  }

  // ----- En passant -----
  if (flags.includes('e')) {
    explanations.push('Captures en passant');
    motifs.push('en-passant');
  }

  // ----- Promotion -----
  if (flags.includes('p') && promotedTo) {
    explanations.push(`Promotes to ${PIECE_NAME[promotedTo]}`);
    factors.push({
      type: 'promotion',
      piece: promotedTo,
      value_pawns: PIECE_VALUE[promotedTo] / 100,
    });
    motifs.push('promotion');
  }

  // ----- Tactical motifs (only meaningful with a real moving piece) -----
  if (movingPiece) {
    // Fork
    const fork = detectFork(chessAfter, to, movingPiece);
    if (fork) {
      const targetNames = fork.map(t => PIECE_NAME[t.type]).join(' and ');
      explanations.push(`Forks the opponent's ${targetNames}`);
      factors.push({
        type: 'fork',
        targets: fork.map(t => t.type),
        value_pawns: 1.5,
      });
      motifs.push('fork');
    }

    // Discovered check
    if (detectDiscoveredCheck(chessAfter, to, movingPiece)) {
      explanations.push('Reveals a discovered check');
      factors.push({ type: 'discovered_check', value_pawns: 1.0 });
      motifs.push('discovered-check');
    }

    // Pin
    const pin = detectPin(chessAfter, to, movingPiece);
    if (pin) {
      explanations.push(
        `Pins the ${PIECE_NAME[pin.pinned.type]} against the ${PIECE_NAME[pin.behind.type]}`
      );
      factors.push({ type: 'pin', value_pawns: 0.7 });
      motifs.push('pin');
    }

    // Removal of defender
    const removal = detectRemovalOfDefender(chessBefore, chessAfter, captured ? to : null);
    if (removal) {
      explanations.push(`Removes the defender of the ${PIECE_NAME[removal.type]}`);
      factors.push({ type: 'removal_of_defender', value_pawns: 0.8 });
      motifs.push('removal-of-defender');
    }

    // Sacrifice
    const sacrifice = detectSacrifice(chessAfter, to, movingPiece, captured);
    if (sacrifice) motifs.push('sacrifice');

    // Plain check (already handled if discovered above; add label if not flagged as discovered)
    if (chessAfter.inCheck() && !motifs.includes('discovered-check')) {
      explanations.push('Gives check');
      factors.push({ type: 'check', value_pawns: 0.5 });
      motifs.push('check');
    }

    // Activity (PST), skip kings
    if (movingPiece.type !== 'k') {
      const pstBefore = getPSTValue(movingPiece.type, from, movingPiece.color);
      const pstAfter = getPSTValue(movingPiece.type, to, movingPiece.color);
      const improvement = pstAfter - pstBefore;
      if (improvement >= 15) {
        explanations.push(`Improves the ${PIECE_NAME[movingPiece.type]}'s activity`);
        factors.push({ type: 'activity', value_pawns: improvement / 100 });
      } else if (improvement <= -15) {
        explanations.push(
          `The ${PIECE_NAME[movingPiece.type]} retreats to a passive square`
        );
        factors.push({ type: 'activity', value_pawns: improvement / 100 });
      }
    }

    // Center control
    if (['d4', 'd5', 'e4', 'e5'].includes(to)) {
      if (movingPiece.type === 'p') {
        explanations.push('Stakes a claim in the center');
        factors.push({ type: 'center_control', value_pawns: 0.3 });
      } else if (movingPiece.type === 'n' || movingPiece.type === 'b') {
        explanations.push('Centralizes a piece');
        factors.push({ type: 'center_control', value_pawns: 0.2 });
      }
    }

    // Development — only in early game (move number ≤ 12)
    const moveNum = chessBefore.moveNumber();
    if (moveNum <= 12 && (movingPiece.type === 'n' || movingPiece.type === 'b')) {
      const startRank = movingPiece.color === 'w' ? '1' : '8';
      if (from[1] === startRank) {
        explanations.push(`Develops the ${PIECE_NAME[movingPiece.type]}`);
        factors.push({ type: 'development', value_pawns: 0.3 });
      }
    }

    // King attack pressure
    const oppKing = findKing(chessAfter, opponent);
    if (
      oppKing &&
      ['q', 'r', 'b', 'n'].includes(movingPiece.type)
    ) {
      const distBefore = squareDistance(from, oppKing);
      const distAfter = squareDistance(to, oppKing);
      if (distAfter < distBefore && distAfter <= 3) {
        explanations.push("Increases pressure on the opponent's king");
        factors.push({ type: 'king_attack', value_pawns: 0.3 });
      }
    }

    // ----- Brilliant upgrade: top engine move + sacrifice + maintains advantage -----
    const isTop = isPlayerMoveTopEngine(opts.topMoves, moveUCI);
    if (sacrifice && isTop && wrDelta >= -2) {
      quality = 'brilliant';
    } else if (isTop && (quality === 'good' || quality === 'great' || quality === 'neutral')) {
      // Mark engine's top choice as "best" when it's not already brilliant
      quality = 'best';
    }
  }

  // ----- Mate-in-N annotation -----
  let mateNote = '';
  if (opts.mateAfter !== undefined && opts.mateAfter !== null) {
    const myMate =
      (sideToMove === 'w' && opts.mateAfter > 0) ||
      (sideToMove === 'b' && opts.mateAfter < 0);
    const n = Math.abs(opts.mateAfter);
    mateNote = myMate
      ? ` Forces mate in ${n}.`
      : ` (Opponent has mate in ${n}.)`;
  }

  const summaries = {
    brilliant:  'A brilliant move — a non-obvious tactical resource.',
    great:      'A great move that significantly improves your position.',
    best:       'The best move in the position.',
    good:       'A solid move that maintains the balance.',
    neutral:    'A reasonable move.',
    inaccuracy: 'A slight inaccuracy — better options were available.',
    mistake:    'A mistake. The position is now worse than it should be.',
    blunder:    'A blunder. This loses significant advantage.',
  };
  const summary = summaries[quality] || 'A move.';

  const details = explanations.length > 0
    ? explanations.join('. ') + '.' + mateNote
    : 'A quiet positional move.' + mateNote;

  return {
    san,
    summary,
    details,
    quality,
    factors,
    motifs,
    evalBefore: evalBefore / 100,
    evalAfter: evalAfter / 100,
    evalDelta: evalDeltaCp / 100,
    winRateDelta: parseFloat(wrDelta.toFixed(2)),
    isTopMove: isPlayerMoveTopEngine(opts.topMoves, moveUCI),
  };
}

function isPlayerMoveTopEngine(topMoves, moveUCI) {
  if (!Array.isArray(topMoves) || topMoves.length === 0) return false;
  return topMoves[0].move === moveUCI;
}

module.exports = {
  explainMove,
  getPSTValue,
  winRate,
  isHanging,
  detectFork,
  detectPin,
  detectDiscoveredCheck,
  detectRemovalOfDefender,
  detectSacrifice,
};
