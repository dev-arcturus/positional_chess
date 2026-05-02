import React from 'react';

// Inline-SVG chess pieces — replaces the Unicode glyphs (♕♖♗♘♙♔ etc.)
// which rendered inconsistently across font fallbacks (queen tiny,
// pawns bold, bishops crooked).
//
// All 12 pieces drawn as filled silhouettes at 24×24, scaled by
// `size`. Uses `fill="currentColor"` so the parent picks the colour
// — typically `#e4e4e7` for white pieces, `#27272a` for black.
//
// Style: clean outline-on-fill silhouettes inspired by the Merida
// public-domain set; reproduced here as simplified path data so we
// don't ship a huge SVG library.
//
// Usage:
//
//   <ChessPieceIcon role="queen" color="white" size={20} />
//
// Or with the captured-strip helper:
//
//   <ChessPieceIcon role={c.role} color={c.side} size={18} />

const PATHS = {
  king: [
    // base
    'M5 21h14v-2H5v2z',
    'M5 18h14v-1H5v1z',
    // body
    'M9 12h6v5H9z',
    // crown
    'M11 8h2v3h-2z',
    // crossbar
    'M9.5 8.5h5v1h-5z',
    // top cross
    'M11 5h2v2h-2z',
    'M10.5 6h3v1h-3z',
  ],
  queen: [
    // base
    'M5 21h14v-2H5v2z',
    'M5 18h14v-1H5v1z',
    // body
    'M7 17h10l-1-7H8l-1 7z',
    // crown points
    'M5 5l2 5L8 6l1.5 4L11 5l1 5 1-5 1.5 5L16 6l1 4 2-5-1 5H6L5 5z',
    'M4.5 4.5l1 1.5-.5-2 1.5 0 .5-1.5z M19.5 4.5l-1 1.5.5-2-1.5 0-.5-1.5z',
    // jewel dots
    'M5 5.2a.6.6 0 11-1.2 0 .6.6 0 011.2 0zM12 4.2a.6.6 0 11-1.2 0 .6.6 0 011.2 0zM20 5.2a.6.6 0 11-1.2 0 .6.6 0 011.2 0z',
  ],
  rook: [
    // base
    'M5 21h14v-2H5v2z',
    'M5 18h14v-1H5v1z',
    // body
    'M7 17h10v-2H7v2z',
    'M7.5 14.5h9V8h-9v6.5z',
    // crenellations
    'M6 4h2v2h2V4h2v2h2V4h2v2h2v3H6V4z',
  ],
  bishop: [
    // base
    'M5 21h14v-2H5v2z',
    'M5 18h14v-1H5v1z',
    // sash / collar
    'M8 17h8v-1H8v1z',
    // body — taller drop shape
    'M12 5c2 1 4 4 4 7 0 2-1 3.5-4 4-3-.5-4-2-4-4 0-3 2-6 4-7z',
    // miter slit
    'M11.6 9h.8v3h-.8z',
    // top finial
    'M11.5 3.5h1v1.6h-1z',
    'M11 5h2v.7h-2z',
  ],
  knight: [
    // base
    'M5 21h14v-2H5v2z',
    'M5 18h14v-1H5v1z',
    // mane stem at the bottom
    'M7 17h10v-2H7v2z',
    // horse head silhouette
    'M14.5 4c-1 0-1.5.5-2 1l-2 .8C9.5 6 8.5 7 8 8.3l-1 1.4c-.4.6-.4 1.4 0 1.6.4.2.8 0 1.1-.4l.7-.6c.3-.2.7-.2.8.1l.2.6c.1.3.4.5.7.5h.6c.3 0 .5.2.4.5l-.2.7c-.1.3.1.6.4.6.7 0 1 .5 1.3 1l.2 1c.1.5-.1 1-.5 1.2l-1 .5h6V8c0-2-1-4-3-4z',
    // eye dot
    'M11.4 7.4a.55.55 0 11-1.1 0 .55.55 0 011.1 0z',
  ],
  pawn: [
    // base
    'M6 21h12v-2H6v2z',
    // belt
    'M7 18h10v-1H7v1z',
    // body / belly
    'M8 17h8c-.3-2-1-3.5-2-4.5l.3-.4c.4-.5.7-1.2.7-1.9C15 8.4 13.7 7 12 7s-3 1.4-3 3.2c0 .7.3 1.4.7 1.9l.3.4c-1 1-1.7 2.5-2 4.5z',
    // head
    'M14.4 5.5a2.4 2.4 0 11-4.8 0 2.4 2.4 0 014.8 0z',
  ],
};

const ROLE_FROM_SHORT = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

export default function ChessPieceIcon({ role, color = 'white', size = 20, style }) {
  const fullRole = role && role.length === 1 ? ROLE_FROM_SHORT[role.toLowerCase()] : role;
  const paths = PATHS[fullRole];
  if (!paths) return null;
  // Tones tuned to read crisply against the dark UI: white pieces on
  // the strip look better in soft white than full white; black pieces
  // in mid-zinc rather than pure black so the silhouette is visible.
  const fill = color === 'white' ? '#e4e4e7' : '#3f3f46';
  const stroke = color === 'white' ? '#71717a' : '#18181b';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={{
        display: 'block',
        fill,
        stroke,
        strokeWidth: 0.5,
        strokeLinejoin: 'round',
        ...style,
      }}
      aria-hidden="true"
    >
      {paths.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}
