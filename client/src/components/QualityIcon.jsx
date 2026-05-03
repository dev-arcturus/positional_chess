import React from 'react';

// SVG move-quality icons — replaces the Unicode glyph approach.
//
// Each glyph is hand-drawn at 24×24, sized down to whatever the parent
// passes in. Style: Lichess-leaning shapes, white symbol on a coloured
// circular pill (the parent supplies the pill).
//
// Why custom SVG?
//   - Unicode `★`, `?!` etc. read inconsistently across fonts.
//   - SVG lets us calibrate stroke width so the glyph is legible at
//     16-22px without looking like fontware.
//   - Each shape becomes recognizable as a chess-tooling symbol the
//     same way `+0.6` is recognized as an evaluation.
//
// Public API:
//   <QualityIcon quality="brilliant" size={22} />

const ICONS = {
  // Brilliant: two stacked sparkles ("!!") with a tiny shimmer dot.
  brilliant: (
    <g>
      <path d="M9.5 4.5h2v9h-2zM12.5 4.5h2v9h-2z" fill="currentColor" />
      <circle cx="10.5" cy="18" r="1.6" fill="currentColor" />
      <circle cx="13.5" cy="18" r="1.6" fill="currentColor" />
      <circle cx="6"   cy="6"   r="1"   fill="currentColor" opacity="0.7" />
      <circle cx="18"  cy="9"   r="0.7" fill="currentColor" opacity="0.55" />
      <circle cx="20"  cy="17"  r="0.6" fill="currentColor" opacity="0.4" />
    </g>
  ),
  // Great: a single bold "!" — the only-good-move find.
  great: (
    <g>
      <path d="M11 4.5h2v9h-2z" fill="currentColor" />
      <circle cx="12" cy="18" r="1.7" fill="currentColor" />
    </g>
  ),
  // Best: 5-point star.
  best: (
    <path
      d="M12 3l2.6 5.85L21 9.6l-4.8 4.27L17.5 21 12 17.6 6.5 21l1.3-7.13L3 9.6l6.4-.75z"
      fill="currentColor"
    />
  ),
  // Excellent: clean checkmark.
  excellent: (
    <path
      d="M5 12.5l4 4 10-10"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  ),
  // Good: a soft checkmark — visible signal but lighter than excellent.
  good: (
    <path
      d="M5 12.5l4 4 10-10"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
      opacity="0.85"
    />
  ),
  neutral: null,
  // Book: open-book glyph — known opening-theory move.
  book: (
    <path
      d="M4 5h6c1.7 0 3 1 3 2v12c0-1-1.3-2-3-2H4V5zm16 0h-6c-1.7 0-3 1-3 2v12c0-1 1.3-2 3-2h6V5z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
      fill="none"
    />
  ),
  // Inaccuracy: "?!" — a question mark with a small dot beside it.
  inaccuracy: (
    <g>
      <path
        d="M7 8.5a3.5 3.5 0 116.2 2.3c-.7.7-1.7 1.3-1.7 2.7v.5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="11.5" cy="18" r="1.5" fill="currentColor" />
      <path d="M17 4.5h1.6v8H17z" fill="currentColor" />
      <circle cx="17.8" cy="15.5" r="1.1" fill="currentColor" />
    </g>
  ),
  // Mistake: solo question mark.
  mistake: (
    <g>
      <path
        d="M8 8.5a4 4 0 117.2 2.5c-.8.8-2 1.5-2 3v.7"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="13.2" cy="18.2" r="1.7" fill="currentColor" />
    </g>
  ),
  // Blunder: "??" — two question marks side-by-side.
  blunder: (
    <g>
      <path
        d="M3.5 8.5a3 3 0 015.5-1.6c.7 1 .3 2-.5 2.7-.7.6-1.5 1.2-1.5 2.4v.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="6.5" cy="16" r="1.4" fill="currentColor" />
      <path
        d="M13.5 8.5a3 3 0 015.5-1.6c.7 1 .3 2-.5 2.7-.7.6-1.5 1.2-1.5 2.4v.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="16.5" cy="16" r="1.4" fill="currentColor" />
    </g>
  ),
  // Missed mate: an X with a chess-king crown above it.
  missed_mate: (
    <g>
      <path
        d="M5 5l14 14M19 5L5 19"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </g>
  ),
};

export default function QualityIcon({ quality, size = 16, color = 'currentColor' }) {
  const icon = ICONS[quality];
  if (!icon) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={{ color, display: 'block' }}
      aria-hidden="true"
    >
      {icon}
    </svg>
  );
}
