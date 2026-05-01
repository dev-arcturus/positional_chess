import React from 'react';

// "Captured" strip drawn above (Black's captures) and below (White's
// captures) the board. Each strip shows:
//   • side label
//   • Unicode glyphs of pieces that side has captured (in descending
//     value, so the queen leads if there is one)
//   • a +/- material-delta pill at the right
//
// We compute captures from the *current* FEN by counting what's missing
// from the starting army (8P, 2N, 2B, 2R, 1Q per side). This means the
// strip works correctly mid-game without needing the move list.
//
// Promotions complicate this: a side with 9 pawns'-worth of pieces but
// only 7 actual pawns will look weird. We bias the math correctly by
// showing the **missing-from-start** glyphs of the *opposite* side
// (because those are what the current side has captured). And for the
// material delta we use the standard P=1 N=B=3 R=5 Q=9 sum.
//
// Props:
//   fen        : current FEN (used to count remaining pieces).
//   orientation: 'white' | 'black' — flips which strip is on top.
//   side       : 'white' | 'black' — whose captures this instance shows.

const STARTING_COUNTS = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 };
const VALUES         = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const GLYPHS = {
  white: { p: '♙', n: '♘', b: '♗', r: '♖', q: '♕', k: '♔' },
  black: { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' },
};

function countPieces(fen) {
  // FEN piece-placement → counts per case (uppercase = white, lower = black).
  const placement = (fen || '').split(' ')[0] || '';
  const counts = {
    white: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 },
    black: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 },
  };
  for (const ch of placement) {
    if (ch === '/' || /\d/.test(ch)) continue;
    const lower = ch.toLowerCase();
    if (lower in counts.white) {
      const side = ch === lower ? 'black' : 'white';
      counts[side][lower] += 1;
    }
  }
  return counts;
}

// Pieces THIS side has captured = pieces missing from the OPPONENT'S army.
function capturedBy(side, counts) {
  const opp = side === 'white' ? 'black' : 'white';
  const remaining = counts[opp];
  const captured = [];
  for (const role of ['q', 'r', 'b', 'n', 'p']) {
    const missing = Math.max(0, STARTING_COUNTS[role] - remaining[role]);
    for (let i = 0; i < missing; i++) captured.push({ role, side: opp });
  }
  return captured;
}

function materialBalance(counts) {
  // White's POV: positive = white ahead.
  let w = 0, b = 0;
  for (const role of Object.keys(VALUES)) {
    w += counts.white[role] * VALUES[role];
    b += counts.black[role] * VALUES[role];
  }
  return w - b;
}

export default function CapturedStrip({ fen, side }) {
  const counts = countPieces(fen);
  const captured = capturedBy(side, counts);
  const delta = materialBalance(counts);
  const own = side === 'white' ? delta : -delta; // own-relative

  return (
    <div style={{
      width: '100%',
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      padding: '6px 10px',
      backgroundColor: '#0f0f12',
      border: '1px solid #27272a',
      borderRadius: '6px',
      minHeight: '32px',
      fontSize: '12px',
    }}>
      <span style={{
        textTransform: 'uppercase',
        fontSize: '9px',
        letterSpacing: '0.1em',
        fontWeight: 800,
        color: side === 'white' ? '#fafafa' : '#a1a1aa',
        minWidth: '54px',
      }}>
        {side === 'white' ? 'White' : 'Black'}
      </span>

      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        gap: '2px',
        minHeight: '24px',
        fontSize: '18px',
        lineHeight: 1,
        color: side === 'white' ? '#a1a1aa' : '#52525b',
        // Each captured piece glyph belongs to the OPPONENT colour
        // (these are pieces taken FROM them).
      }}>
        {captured.length === 0 && (
          <span style={{ fontSize: '11px', color: '#52525b' }}>—</span>
        )}
        {captured.map((c, i) => (
          <span key={i} style={{
            color: c.side === 'white' ? '#e4e4e7' : '#52525b',
            opacity: 0.95,
            // Squish glyphs so they read as a row, not a list.
            marginRight: '-3px',
          }}>
            {GLYPHS[c.side][c.role]}
          </span>
        ))}
      </div>

      {own !== 0 && (
        <span style={{
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontWeight: 700,
          fontSize: '11px',
          padding: '3px 8px',
          borderRadius: '999px',
          backgroundColor: own > 0 ? 'rgba(74,222,128,0.10)' : 'rgba(248,113,113,0.10)',
          color: own > 0 ? '#86efac' : '#fca5a5',
          border: '1px solid ' + (own > 0 ? 'rgba(74,222,128,0.25)' : 'rgba(248,113,113,0.25)'),
        }}>
          {own > 0 ? '+' : ''}{own}
        </span>
      )}
    </div>
  );
}
