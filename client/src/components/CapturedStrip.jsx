import React from 'react';
import ChessPieceIcon from './ChessPieceIcon';

// "Captured" strip drawn above (Black's captures) and below (White's
// captures) the board. Each strip shows:
//   • side label
//   • SVG silhouettes of pieces that side has captured (in descending
//     value, so the queen leads if there is one)
//   • a +N material-delta pill (only on the side that's ahead)
//
// We compute captures from the *current* FEN by counting what's missing
// from the starting army (8P, 2N, 2B, 2R, 1Q per side). This means the
// strip works correctly mid-game without needing the move list.

const STARTING_COUNTS = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 };
const VALUES         = { p: 1, n: 3, b: 3, r: 5, q: 9 };

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
        gap: '1px',
        minHeight: '24px',
      }}>
        {captured.length === 0 && (
          <span style={{ fontSize: '11px', color: '#52525b' }}>—</span>
        )}
        {captured.map((c, i) => (
          <ChessPieceIcon
            key={i}
            role={c.role}
            color={c.side}
            size={20}
            style={{ marginRight: '-2px' }}
          />
        ))}
      </div>

      {/* Only the side that is AHEAD shows the +N pill. The side that
          is behind says nothing — no minus sign needed. */}
      {own > 0 && (
        <span style={{
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontWeight: 700,
          fontSize: '11px',
          padding: '3px 8px',
          borderRadius: '999px',
          backgroundColor: 'rgba(74,222,128,0.10)',
          color: '#86efac',
          border: '1px solid rgba(74,222,128,0.25)',
        }}>
          +{own}
        </span>
      )}
    </div>
  );
}
