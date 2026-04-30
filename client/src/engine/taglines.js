// Local, engine-free move classification used to generate one-line taglines
// for the top-moves panel ("Captures pawn, forks queen and rook", "Develops
// the knight onto an outpost", etc.).
//
// Designed to be cheap enough to run on every top move plus the first few
// plies of each PV — pure chess.js + simple geometry, no Stockfish calls.
//
// Motif catalog (broad strokes — see body for details):
//   Tactical:    capture, check, checkmate, fork, pin, skewer,
//                discovered_check, removal_of_defender, sacrifice,
//                hangs, threatens, defends, deflection, blocks_check
//   Endings:     stalemate, threefold_repetition, fifty_move,
//                insufficient_material
//   Pawn play:   pawn_break, pawn_lever, passed_pawn, doubled_pawns,
//                isolated_pawn, pawn_storm, en_passant, promotion
//   Pieces:      develops, centralizes, outpost, fianchetto,
//                trapped_piece, retreats, activity_gain
//   Rooks:       open_file, semi_open_file, doubles_rooks,
//                rook_seventh, back_rank
//   King:        castles_kingside, castles_queenside, connects_rooks,
//                attacks_king, exposes_king, weakens_king
//   Trades:      queen_trade, piece_trade, exchange_sacrifice
//   Strategic:   space_gain, opens_diagonal, opens_file,
//                tempo, gives_tempo

import { Chess } from 'chess.js';

const PIECE_VALUE = { p: 100, n: 300, b: 320, r: 500, q: 900, k: 20_000 };
const PIECE_NAME  = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

function frToSquare(f, r) { return String.fromCharCode(97 + f) + (r + 1); }
function squareToFR(sq) { return [sq.charCodeAt(0) - 97, parseInt(sq[1], 10) - 1]; }
function fileLetter(idx) { return String.fromCharCode(97 + idx); }
function chebyshev(sq1, sq2) {
  const [f1, r1] = squareToFR(sq1);
  const [f2, r2] = squareToFR(sq2);
  return Math.max(Math.abs(f1 - f2), Math.abs(r1 - r2));
}
function findKing(chess, color) {
  const board = chess.board();
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = board[r][f];
      if (p && p.type === 'k' && p.color === color) return frToSquare(f, 7 - r);
    }
  }
  return null;
}
function squaresAttackedFrom(chess, fromSquare) {
  const piece = chess.get(fromSquare);
  if (!piece) return [];
  const attacked = [];
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq = frToSquare(f, r);
      if (sq === fromSquare) continue;
      const a = chess.attackers(sq, piece.color);
      if (a && a.includes(fromSquare)) attacked.push(sq);
    }
  }
  return attacked;
}
function isHangingApprox(chess, square) {
  const piece = chess.get(square);
  if (!piece || piece.type === 'k') return false;
  const opponent = piece.color === 'w' ? 'b' : 'w';
  const attackers = chess.attackers(square, opponent);
  if (!attackers || attackers.length === 0) return false;
  const defenders = chess.attackers(square, piece.color);
  if (!defenders || defenders.length === 0) return true;
  const minA = Math.min(...attackers.map(s => PIECE_VALUE[chess.get(s).type] || 100));
  return minA < PIECE_VALUE[piece.type];
}
function isOutpost(chess, square, piece) {
  if (!['n', 'b'].includes(piece.type)) return false;
  const [file, rank] = squareToFR(square);
  if (piece.color === 'w' && rank < 4) return false;     // ranks 5..8
  if (piece.color === 'b' && rank > 3) return false;     // ranks 1..4
  const enemy = piece.color === 'w' ? 'b' : 'w';
  for (const df of [-1, 1]) {
    const f = file + df;
    if (f < 0 || f > 7) continue;
    for (let r = 0; r < 8; r++) {
      const p = chess.get(frToSquare(f, r));
      if (!p || p.type !== 'p' || p.color !== enemy) continue;
      // White piece outpost: a black pawn at higher rank can advance to attack.
      if (piece.color === 'w' && r >= rank + 1) return false;
      // Black piece outpost: a white pawn at lower rank can advance to attack.
      if (piece.color === 'b' && r <= rank - 1) return false;
    }
  }
  return true;
}
function pieceCount(chess, type, color) {
  let n = 0;
  const board = chess.board();
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const p = board[r][f];
    if (p && p.type === type && p.color === color) n++;
  }
  return n;
}
// Pawn structure helpers
function pawnsByFile(chess, color) {
  const counts = new Array(8).fill(0);
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const p = chess.get(frToSquare(f, r));
    if (p && p.type === 'p' && p.color === color) counts[f]++;
  }
  return counts;
}
function isIsolated(file, pawnsByFileArr) {
  const left = file > 0 ? pawnsByFileArr[file - 1] : 0;
  const right = file < 7 ? pawnsByFileArr[file + 1] : 0;
  return left === 0 && right === 0;
}
function isPassed(chess, square, color) {
  const [file, rank] = squareToFR(square);
  const enemy = color === 'w' ? 'b' : 'w';
  for (const df of [-1, 0, 1]) {
    const f = file + df;
    if (f < 0 || f > 7) continue;
    for (let r = 0; r < 8; r++) {
      const p = chess.get(frToSquare(f, r));
      if (!p || p.type !== 'p' || p.color !== enemy) continue;
      // White pawn is passed if no black pawn ahead of it in same/adjacent file.
      if (color === 'w' && r > rank) return false;
      if (color === 'b' && r < rank) return false;
    }
  }
  return true;
}
// Rook on 7th-from-its-side: rank 6 (white rook) or rank 1 (black rook).
function isRookOnSeventh(square, color) {
  const rank = parseInt(square[1], 10) - 1;
  return (color === 'w' && rank === 6) || (color === 'b' && rank === 1);
}
function detectBattery(chessAfter, fromSquare, movingPiece) {
  // Two same-color sliders on the same line aimed at a target.
  if (!['b', 'r', 'q'].includes(movingPiece.type)) return null;
  const directions = movingPiece.type === 'r'
    ? [[1, 0], [-1, 0], [0, 1], [0, -1]]
    : movingPiece.type === 'b'
    ? [[1, 1], [-1, 1], [1, -1], [-1, -1]]
    : [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
  const [f0, r0] = squareToFR(fromSquare);
  for (const [df, dr] of directions) {
    let f = f0 + df, r = r0 + dr;
    let firstFriend = null;
    let firstEnemy = null;
    while (f >= 0 && f < 8 && r >= 0 && r < 8) {
      const sq = frToSquare(f, r);
      const p = chessAfter.get(sq);
      if (p) {
        if (p.color === movingPiece.color && !firstFriend && !firstEnemy
            && (p.type === 'r' || p.type === 'q' || p.type === 'b')) {
          // For battery to be aimed forward (ahead of mover), we should have
          // hit our friendly piece first when scanning OUTWARD. But this scan
          // is outward; first friend means battery is BEHIND from mover's POV.
          // Sufficient signal that two pieces share a line.
          firstFriend = { sq, type: p.type };
        }
        if (p.color !== movingPiece.color && !firstEnemy) {
          firstEnemy = { sq, type: p.type };
        }
        break;
      }
      f += df; r += dr;
    }
    if (firstFriend) {
      return { partner: firstFriend, target: firstEnemy };
    }
  }
  return null;
}

// Light SEE-style sacrifice check.
function detectSacrificeApprox(chessAfter, toSquare, movingPiece, capturedPiece) {
  if (!isHangingApprox(chessAfter, toSquare)) return false;
  const moverVal = PIECE_VALUE[movingPiece.type] || 100;
  const recovered = capturedPiece ? (PIECE_VALUE[capturedPiece.type] || 0) : 0;
  return (moverVal - recovered) >= 200;
}

function detectPin(chessAfter, toSquare, movingPiece) {
  if (!['b', 'r', 'q'].includes(movingPiece.type)) return null;
  const opponent = movingPiece.color === 'w' ? 'b' : 'w';
  const dirs = movingPiece.type === 'r'
    ? [[1, 0], [-1, 0], [0, 1], [0, -1]]
    : movingPiece.type === 'b'
    ? [[1, 1], [-1, 1], [1, -1], [-1, -1]]
    : [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
  const [f0, r0] = squareToFR(toSquare);
  for (const [df, dr] of dirs) {
    let first = null, second = null;
    for (let i = 1; i < 8; i++) {
      const f = f0 + df * i, r = r0 + dr * i;
      if (f < 0 || f > 7 || r < 0 || r > 7) break;
      const p = chessAfter.get(frToSquare(f, r));
      if (!p) continue;
      if (!first) {
        if (p.color === opponent) first = { type: p.type };
        else break;
      } else {
        if (p.color === opponent) second = { type: p.type };
        break;
      }
    }
    if (first && second && (PIECE_VALUE[second.type] || 0) > (PIECE_VALUE[first.type] || 0)) {
      return { pinned: first.type, behind: second.type };
    }
  }
  return null;
}
function detectSkewer(chessAfter, toSquare, movingPiece) {
  if (!['b', 'r', 'q'].includes(movingPiece.type)) return null;
  const opponent = movingPiece.color === 'w' ? 'b' : 'w';
  const dirs = movingPiece.type === 'r'
    ? [[1, 0], [-1, 0], [0, 1], [0, -1]]
    : movingPiece.type === 'b'
    ? [[1, 1], [-1, 1], [1, -1], [-1, -1]]
    : [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
  const [f0, r0] = squareToFR(toSquare);
  for (const [df, dr] of dirs) {
    let first = null, second = null;
    for (let i = 1; i < 8; i++) {
      const f = f0 + df * i, r = r0 + dr * i;
      if (f < 0 || f > 7 || r < 0 || r > 7) break;
      const p = chessAfter.get(frToSquare(f, r));
      if (!p) continue;
      if (!first) {
        if (p.color === opponent) first = { type: p.type };
        else break;
      } else {
        if (p.color === opponent) second = { type: p.type };
        break;
      }
    }
    if (first && second && (PIECE_VALUE[first.type] || 0) > (PIECE_VALUE[second.type] || 0)) {
      return { skewered: first.type, behind: second.type };
    }
  }
  return null;
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

// Compute a tagline + structured motifs for a hypothetical move.
// fenBefore: position before the move; moveUCI: e.g. "e2e4" or "e7e8q".
export function quickExplain(fenBefore, moveUCI) {
  if (typeof moveUCI !== 'string' || moveUCI.length < 4) {
    return { san: moveUCI, motifs: [], tagline: '' };
  }
  const chess = new Chess(fenBefore);
  const from = moveUCI.slice(0, 2);
  const to = moveUCI.slice(2, 4);
  const movingPiece = chess.get(from);
  if (!movingPiece) return { san: moveUCI, motifs: [], tagline: '' };
  const capturedBefore = chess.get(to);
  const moverColor = movingPiece.color;
  const opponentColor = moverColor === 'w' ? 'b' : 'w';
  const moveNumber = chess.moveNumber();

  // Apply the move.
  let san, flags, promoted;
  try {
    const m = chess.move({ from, to, promotion: moveUCI[4] || 'q' });
    if (!m) return { san: moveUCI, motifs: [], tagline: '' };
    san = m.san; flags = m.flags || ''; promoted = m.promotion;
  } catch {
    return { san: moveUCI, motifs: [], tagline: '' };
  }
  const fenAfter = chess.fen();
  const chessAfter = new Chess(fenAfter);
  const chessBefore = new Chess(fenBefore);

  const motifs = [];
  const phrases = [];
  const add = (motif, phrase) => { motifs.push(motif); if (phrase) phrases.push(phrase); };

  // ── Terminal states ─────────────────────────────────────────────────────
  if (chessAfter.isCheckmate()) {
    return { san, motifs: ['checkmate'], tagline: 'Delivers checkmate' };
  }
  if (chessAfter.isStalemate())                { add('stalemate', 'Stalemates the position'); }
  if (chessAfter.isThreefoldRepetition())      { add('threefold_repetition', 'Repeats the position'); }
  if (chessAfter.isDrawByFiftyMoves())         { add('fifty_move', 'Triggers the 50-move rule'); }
  if (chessAfter.isInsufficientMaterial())     { add('insufficient_material', 'Reaches insufficient material'); }

  // ── Castling ────────────────────────────────────────────────────────────
  if (flags.includes('k')) {
    add('castles_kingside', 'Castles kingside');
    // Connect-rooks: after castle, both rooks are on back rank with no
    // pieces between them.
    const backRank = moverColor === 'w' ? 0 : 7;
    let pieces = 0;
    for (let f = 0; f < 8; f++) {
      const p = chessAfter.get(frToSquare(f, backRank));
      if (p && p.color === moverColor) pieces++;
    }
    if (pieces >= 3) add('connects_rooks', null); // implicit, no extra phrase
  } else if (flags.includes('q')) {
    add('castles_queenside', 'Castles queenside');
  }

  // ── En passant / promotion ──────────────────────────────────────────────
  if (flags.includes('e')) add('en_passant', 'Captures en passant');
  if (flags.includes('p') && promoted) {
    add('promotion', `Promotes to ${PIECE_NAME[promoted]}`);
  }

  // ── Capture / trade ─────────────────────────────────────────────────────
  if (capturedBefore && !flags.includes('e')) {
    const cName = PIECE_NAME[capturedBefore.type];
    if (capturedBefore.type === 'q' && movingPiece.type === 'q') {
      add('queen_trade', 'Trades queens');
    } else if (capturedBefore.type === movingPiece.type) {
      add('piece_trade', `Trades ${PIECE_NAME[movingPiece.type]}s`);
    } else if (movingPiece.type === 'r' && ['n', 'b'].includes(capturedBefore.type)) {
      add('exchange_sacrifice', `Gives the exchange for the ${cName}`);
    } else {
      add('capture', `Captures the ${cName}`);
    }
  }

  // ── Check (only if not already mate-handled) ────────────────────────────
  if (chessAfter.inCheck()) {
    if (detectDiscoveredCheck(chessAfter, to, movingPiece)) {
      add('discovered_check', 'Discovered check');
    } else {
      add('check', 'Gives check');
    }
  }

  // ── Tactical motifs ─────────────────────────────────────────────────────
  const attackedAfter = squaresAttackedFrom(chessAfter, to).filter(sq => {
    const p = chessAfter.get(sq);
    return p && p.color === opponentColor;
  });
  const moverVal = PIECE_VALUE[movingPiece.type] || 100;

  // Fork: 2+ enemy pieces attacked, with at least one ≥ mover value (or king).
  if (attackedAfter.length >= 2) {
    const significant = attackedAfter.filter(sq => {
      const p = chessAfter.get(sq);
      return p.type === 'k' || (PIECE_VALUE[p.type] || 0) > moverVal;
    });
    if (significant.length >= 1) {
      const types = attackedAfter.map(sq => PIECE_NAME[chessAfter.get(sq).type]);
      add('fork', `Forks ${[...new Set(types)].slice(0, 2).join(' and ')}`);
    }
  }
  // Threatens (only one valuable target).
  if (!motifs.includes('fork')) {
    const valuable = attackedAfter.filter(sq => {
      const p = chessAfter.get(sq);
      return p.type !== 'k' && (PIECE_VALUE[p.type] || 0) > moverVal;
    });
    if (valuable.length > 0) {
      add('threatens', `Threatens the ${PIECE_NAME[chessAfter.get(valuable[0]).type]}`);
    }
  }
  // Pin / skewer.
  const pin = detectPin(chessAfter, to, movingPiece);
  if (pin) add('pin', `Pins the ${PIECE_NAME[pin.pinned]} to the ${PIECE_NAME[pin.behind]}`);
  const skewer = detectSkewer(chessAfter, to, movingPiece);
  if (skewer) add('skewer', `Skewers the ${PIECE_NAME[skewer.skewered]}, exposing the ${PIECE_NAME[skewer.behind]}`);
  // Sacrifice (SEE approx).
  if (detectSacrificeApprox(chessAfter, to, movingPiece, capturedBefore)) {
    add('sacrifice', `Sacrifices the ${PIECE_NAME[movingPiece.type]}`);
  } else if (isHangingApprox(chessAfter, to) && movingPiece.type !== 'p') {
    add('hangs', `The ${PIECE_NAME[movingPiece.type]} is left undefended`);
  }

  // ── Strategic / positional motifs ───────────────────────────────────────

  // Develops (early game minor piece off back rank).
  if (moveNumber <= 12 && ['n', 'b'].includes(movingPiece.type)) {
    const startRank = moverColor === 'w' ? '1' : '8';
    if (from[1] === startRank) add('develops', `Develops the ${PIECE_NAME[movingPiece.type]}`);
  }

  // Centralizes (move to e4/d4/e5/d5).
  const center = ['d4', 'd5', 'e4', 'e5'];
  if (center.includes(to) && !motifs.includes('develops')) {
    if (movingPiece.type === 'p') add('centralizes', 'Stakes a claim in the center');
    else if (['n', 'b'].includes(movingPiece.type)) add('centralizes', 'Centralizes a piece');
  }

  // Outpost (knight or bishop on a square no enemy pawn can attack).
  if (['n', 'b'].includes(movingPiece.type) && isOutpost(chessAfter, to, movingPiece)) {
    add('outpost', `Establishes an outpost on ${to}`);
  }

  // Fianchetto (bishop to b2/g2 white, b7/g7 black).
  if (movingPiece.type === 'b') {
    if ((moverColor === 'w' && (to === 'b2' || to === 'g2')) ||
        (moverColor === 'b' && (to === 'b7' || to === 'g7'))) {
      add('fianchetto', 'Fianchettos the bishop');
    }
  }

  // Doubles rooks.
  if (movingPiece.type === 'r') {
    const [fileIdx] = squareToFR(to);
    let ourRooksOnFile = 0;
    let myPawnsOnFile = 0;
    let theirPawnsOnFile = 0;
    for (let r = 0; r < 8; r++) {
      const p = chessAfter.get(frToSquare(fileIdx, r));
      if (!p) continue;
      if (p.type === 'r' && p.color === moverColor) ourRooksOnFile++;
      if (p.type === 'p') {
        if (p.color === moverColor) myPawnsOnFile++;
        else theirPawnsOnFile++;
      }
    }
    if (ourRooksOnFile >= 2) {
      add('doubles_rooks', `Doubles rooks on the ${fileLetter(fileIdx)}-file`);
    } else if (myPawnsOnFile === 0 && theirPawnsOnFile === 0) {
      add('open_file', `Posts the rook on the open ${fileLetter(fileIdx)}-file`);
    } else if (myPawnsOnFile === 0 && theirPawnsOnFile >= 1) {
      add('semi_open_file', `Posts on the semi-open ${fileLetter(fileIdx)}-file`);
    }
    if (isRookOnSeventh(to, moverColor)) {
      add('rook_seventh', 'Rook on the seventh');
    }
  }

  // Battery (queen + rook / queen + bishop / rook + rook on same line).
  if (!motifs.includes('doubles_rooks')) {
    const battery = detectBattery(chessAfter, to, movingPiece);
    if (battery && (movingPiece.type === 'q' || movingPiece.type === 'r' || movingPiece.type === 'b')) {
      add('battery', `Forms a battery with the ${PIECE_NAME[battery.partner.type]}`);
    }
  }

  // Pawn-specific: pawn break / lever / passed pawn / storm.
  if (movingPiece.type === 'p') {
    if (capturedBefore) {
      add('pawn_break', 'Pawn break');
    } else {
      // Lever: move places pawn diagonally adjacent to enemy pawn (next move would capture).
      const [tf, tr] = squareToFR(to);
      const forward = moverColor === 'w' ? 1 : -1;
      let lever = false;
      for (const df of [-1, 1]) {
        const f = tf + df, r = tr + forward;
        if (f < 0 || f > 7 || r < 0 || r > 7) continue;
        const p = chessAfter.get(frToSquare(f, r));
        if (p && p.type === 'p' && p.color === opponentColor) { lever = true; break; }
      }
      if (lever) add('pawn_lever', 'Creates a pawn lever');
    }
    // Passed pawn after move?
    if (isPassed(chessAfter, to, moverColor)) {
      add('passed_pawn', 'Creates a passed pawn');
    }
    // Pawn storm: pawn advances toward enemy king, in front of it within 3 files.
    const oppKing = findKing(chessAfter, opponentColor);
    if (oppKing) {
      const [kf, kr] = squareToFR(oppKing);
      const [tf, tr] = squareToFR(to);
      const aimedAtKing = Math.abs(tf - kf) <= 2;
      const advancing = (moverColor === 'w' && tr >= 3) || (moverColor === 'b' && tr <= 4);
      if (aimedAtKing && advancing && !motifs.includes('pawn_break')) {
        add('pawn_storm', 'Joins the pawn storm');
      }
    }
  }

  // Pawn-structure side effects (after move).
  const myPawnsAfter = pawnsByFile(chessAfter, moverColor);
  const myPawnsBefore = pawnsByFile(chessBefore, moverColor);
  const oppPawnsAfter = pawnsByFile(chessAfter, opponentColor);
  const oppPawnsBefore = pawnsByFile(chessBefore, opponentColor);
  // Did we double the OPPONENT's pawns by capturing?
  if (capturedBefore && capturedBefore.type === 'p' && movingPiece.type !== 'p') {
    const [tf] = squareToFR(to);
    if (oppPawnsAfter[tf] > oppPawnsBefore[tf]
        || (oppPawnsAfter[tf] >= 2 && oppPawnsBefore[tf] < 2)) {
      add('doubled_pawns_them', 'Doubles the opponent\'s pawns');
    }
  }
  // Isolated our pawn? (move that leaves a pawn isolated)
  if (movingPiece.type === 'p') {
    const [tf] = squareToFR(to);
    if (myPawnsAfter[tf] >= 1 && isIsolated(tf, myPawnsAfter)) {
      add('isolated_pawn', 'Isolates the pawn');
    }
  }

  // King attack: major piece moves close to enemy king (only if no stronger
  // tactical motif already filed).
  if (!motifs.some(m => ['fork', 'pin', 'skewer', 'check', 'discovered_check'].includes(m))) {
    const oppKing = findKing(chessAfter, opponentColor);
    if (oppKing && ['q', 'r', 'b', 'n'].includes(movingPiece.type)) {
      const distAfter = chebyshev(to, oppKing);
      const distBefore = chebyshev(from, oppKing);
      if (distAfter < distBefore && distAfter <= 3) {
        add('attacks_king', "Increases pressure on the king");
      }
    }
  }

  // ── Defends a previously-hanging piece ──────────────────────────────────
  // Compare hanging-piece sets before/after for our own pieces.
  {
    const board = chessBefore.board();
    let defendedSquare = null;
    for (let r = 0; r < 8 && !defendedSquare; r++) {
      for (let f = 0; f < 8 && !defendedSquare; f++) {
        const p = board[r][f];
        if (!p || p.color !== moverColor || p.type === 'k') continue;
        const sq = frToSquare(f, 7 - r);
        if (sq === from) continue; // the moving piece doesn't count
        if (isHangingApprox(chessBefore, sq) && !isHangingApprox(chessAfter, sq)) {
          defendedSquare = { sq, type: p.type };
        }
      }
    }
    if (defendedSquare) {
      add('defends', `Defends the ${PIECE_NAME[defendedSquare.type]}`);
    }
  }

  // ── Creates a new threat ────────────────────────────────────────────────
  // An opponent piece that wasn't hanging before is now hanging.
  {
    const board = chessAfter.board();
    let newlyHanging = null;
    for (let r = 0; r < 8 && !newlyHanging; r++) {
      for (let f = 0; f < 8 && !newlyHanging; f++) {
        const p = board[r][f];
        if (!p || p.color !== opponentColor || p.type === 'k') continue;
        const sq = frToSquare(f, 7 - r);
        if (isHangingApprox(chessAfter, sq) && !isHangingApprox(chessBefore, sq)) {
          newlyHanging = { sq, type: p.type };
        }
      }
    }
    if (newlyHanging && !motifs.includes('threatens') && !motifs.includes('fork')) {
      add('creates_threat', `Creates a threat on the ${PIECE_NAME[newlyHanging.type]}`);
    }
  }

  // ── Tempo: develops while attacking something ──────────────────────────
  if (motifs.includes('develops')
      && (motifs.includes('threatens') || motifs.includes('attacks_king')
          || motifs.includes('creates_threat'))) {
    add('tempo', null);
  }

  // ── Maneuvers / repositions: a meaningful PST gain even with no
  //    tactical action. Used to make the fallback richer than "Quiet X". ─
  // (Computed but only applied as fallback if nothing else fires.)
  function pstFor(pieceType, square, color) {
    // Tiny embedded PST (matches the explainer's): just the central
    // bias for knight + bishop is enough to call out activity gains.
    const KN = [
      [-50,-40,-30,-30,-30,-30,-40,-50],
      [-40,-20,  0,  5,  5,  0,-20,-40],
      [-30,  5, 10, 15, 15, 10,  5,-30],
      [-30,  0, 15, 20, 20, 15,  0,-30],
      [-30,  5, 15, 20, 20, 15,  5,-30],
      [-30,  0, 10, 15, 15, 10,  0,-30],
      [-40,-20,  0,  0,  0,  0,-20,-40],
      [-50,-40,-30,-30,-30,-30,-40,-50],
    ];
    const BI = [
      [-20,-10,-10,-10,-10,-10,-10,-20],
      [-10,  5,  0,  0,  0,  0,  5,-10],
      [-10, 10, 10, 10, 10, 10, 10,-10],
      [-10,  0, 10, 10, 10, 10,  0,-10],
      [-10,  5,  5, 10, 10,  5,  5,-10],
      [-10,  0,  5, 10, 10,  5,  0,-10],
      [-10,  0,  0,  0,  0,  0,  0,-10],
      [-20,-10,-10,-10,-10,-10,-10,-20],
    ];
    const tab = pieceType === 'n' ? KN : pieceType === 'b' ? BI : null;
    if (!tab) return 0;
    const [f, r] = squareToFR(square);
    const row = color === 'w' ? 7 - r : r;
    return tab[row][f];
  }
  let activityGain = 0;
  if (['n', 'b'].includes(movingPiece.type)) {
    activityGain = pstFor(movingPiece.type, to, moverColor)
                 - pstFor(movingPiece.type, from, moverColor);
  }

  // ── Direction hints (used as fallback flavor) ───────────────────────────
  // Heads toward kingside / queenside / center based on file.
  const [tf, tr] = squareToFR(to);
  const [ff, fr] = squareToFR(from);
  let directionHint = null;
  const oppKingSq = findKing(chessAfter, opponentColor);
  if (oppKingSq) {
    const [okf] = squareToFR(oppKingSq);
    const closerToKing = Math.abs(tf - okf) < Math.abs(ff - okf)
                       || (chebyshev(to, oppKingSq) < chebyshev(from, oppKingSq));
    if (closerToKing) {
      directionHint = okf >= 4 ? 'Heads toward the kingside' : 'Heads toward the queenside';
    }
  }
  if (!directionHint) {
    const distFromCenter = (sq) => {
      const [f, r] = squareToFR(sq);
      return Math.max(Math.abs(f - 3.5), Math.abs(r - 3.5));
    };
    if (distFromCenter(to) < distFromCenter(from) - 0.5) {
      directionHint = 'Repositions toward the center';
    }
  }

  // ── Compose tagline (priority order) ────────────────────────────────────
  // Higher = more important / surprising. We pick the top 1-2 phrases.
  const PRIORITY = [
    'checkmate', 'sacrifice', 'fork', 'discovered_check', 'pin', 'skewer',
    'queen_trade', 'exchange_sacrifice', 'piece_trade', 'capture',
    'creates_threat', 'threatens', 'check',
    'castles_kingside', 'castles_queenside', 'promotion', 'en_passant',
    'doubles_rooks', 'rook_seventh', 'open_file', 'semi_open_file',
    'outpost', 'fianchetto', 'battery', 'attacks_king',
    'develops', 'centralizes', 'defends',
    'pawn_break', 'pawn_lever', 'passed_pawn', 'pawn_storm',
    'doubled_pawns_them', 'isolated_pawn', 'hangs',
    'stalemate', 'threefold_repetition', 'fifty_move', 'insufficient_material',
  ];
  const orderedPhrases = [];
  for (const motif of PRIORITY) {
    if (!motifs.includes(motif)) continue;
    const idx = motifs.indexOf(motif);
    if (idx >= 0 && phrases[idx]) {
      // We don't keep a strict 1-1 mapping; instead, find the phrase whose
      // text matches typical wording. Simpler: walk the original phrases in
      // priority order by looking up what was added at the time.
    }
  }
  // Build phrase list by re-iterating motifs in their original add order
  // but filter to the most "informative" couple. We already pushed phrases
  // alongside motifs; just dedupe and take top two by priority.
  const motifPhrases = motifs.map((m, i) => ({ motif: m, phrase: phrases[i] }))
    .filter(x => x.phrase);
  motifPhrases.sort((a, b) => {
    const ai = PRIORITY.indexOf(a.motif); const bi = PRIORITY.indexOf(b.motif);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  // Richer fallback than "Quiet X move": pick the most informative thing
  // we can say about the move based on positional cues we already
  // computed (PST activity, direction toward king/center).
  function fallbackTagline() {
    if (activityGain >= 20) {
      return `Improves the ${PIECE_NAME[movingPiece.type]}'s activity`;
    }
    if (activityGain <= -20) {
      return `Retreats the ${PIECE_NAME[movingPiece.type]}`;
    }
    if (directionHint) return directionHint;
    if (movingPiece.type === 'p') {
      const [, tr2] = squareToFR(to);
      const onSeventh = (moverColor === 'w' && tr2 === 6) || (moverColor === 'b' && tr2 === 1);
      if (onSeventh) return 'Pushes the pawn to the seventh rank';
      return `Pushes the ${fileLetter(squareToFR(to)[0])}-pawn`;
    }
    if (['q', 'r'].includes(movingPiece.type)) {
      return `Repositions the ${PIECE_NAME[movingPiece.type]} to ${to}`;
    }
    return `Maneuvers the ${PIECE_NAME[movingPiece.type]} to ${to}`;
  }

  let tagline;
  if (motifPhrases.length === 0) {
    tagline = fallbackTagline();
  } else if (motifPhrases.length === 1) {
    // Even with one motif, append a flavor hint if it adds info.
    const main = motifPhrases[0].phrase;
    if (directionHint
        && !['checkmate','fork','pin','skewer','sacrifice'].includes(motifPhrases[0].motif)
        && motifPhrases[0].motif !== 'castles_kingside'
        && motifPhrases[0].motif !== 'castles_queenside') {
      tagline = `${main}, ${directionHint.toLowerCase()}`;
    } else {
      tagline = main;
    }
  } else {
    tagline = motifPhrases.slice(0, 2).map(x => x.phrase).join(', ');
  }

  return { san, motifs, tagline, fenAfter };
}

// Generate taglines for the first N plies of a PV. Used to show a short
// narrative under each top move.
export function explainPV(startFen, pvUcis, plies = 3) {
  let fen = startFen;
  const out = [];
  for (const uci of pvUcis.slice(0, plies)) {
    const r = quickExplain(fen, uci);
    if (!r || !r.san) break;
    out.push({ san: r.san, tagline: r.tagline });
    fen = r.fenAfter || fen;
    if (!fen) break;
  }
  return out;
}
