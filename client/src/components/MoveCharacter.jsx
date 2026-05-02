import React from 'react';
import Tooltip from './Tooltip';

// Move-character classifier + circle icon.
//
// Given a move's motif IDs, classify its dominant character into one of
// a small set (tactical / attack / capture / positional / develop /
// defend / quiet) and render a coloured circle with a glyph in the
// middle. Clicking the circle selects the move; hovering shows a
// tooltip with the move's SAN and the dominant motif.
//
// This is what shows up in the row of summary circles above the
// scrollable top-moves list — a Lichess-engine-tab-style "at a glance"
// view of the engine's preferences.

const KIND_PRIORITY = [
  // Order: most-specific first. We pick the first that matches.
  ['mate',       ['checkmate']],
  ['mate_threat',['greek_gift', 'smothered_hint', 'back_rank_mate_threat',
                  'anastasia_mate_threat', 'bodens_mate_threat',
                  'arabian_mate_threat']],
  ['tactical',   ['decisive_combination', 'sacrifice', 'fork', 'pin',
                  'skewer', 'discovered_check', 'double_check',
                  'removes_defender']],
  ['attack',     ['attacks_king', 'eyes_king_zone', 'pawn_storm']],
  ['promotion',  ['promotion', 'pawn_breakthrough']],
  ['capture',    ['capture', 'simplifies', 'trades_into_endgame',
                  'queen_trade', 'piece_trade', 'exchange_sacrifice',
                  'en_passant']],
  ['threat',     ['threatens', 'creates_threat', 'attacks_pawn',
                  'traps_piece']],
  ['positional', ['outpost', 'knight_invasion', 'fianchetto',
                  'long_diagonal', 'rook_lift', 'rook_seventh',
                  'open_file', 'semi_open_file', 'doubles_rooks',
                  'opens_file_for', 'opens_diagonal_for', 'battery']],
  ['structure',  ['iqp_them', 'iqp_self', 'hanging_pawns_them',
                  'hanging_pawns_self', 'doubled_pawns_them',
                  'backward_pawn_them', 'color_complex_them',
                  'color_complex_self']],
  ['check',      ['check']],
  ['castle',     ['castles_kingside', 'castles_queenside',
                  'prepares_castling_kingside',
                  'prepares_castling_queenside']],
  ['defend',     ['defends', 'prophylaxis']],
  ['develop',    ['develops', 'centralizes', 'activates',
                  'connects_rooks', 'multi_purpose']],
  ['restrict',   ['restricts']],
];

export function classifyMove(motifIds = []) {
  for (const [kind, ids] of KIND_PRIORITY) {
    if (motifIds.some(id => ids.includes(id))) return kind;
  }
  return 'quiet';
}

// Tone for each kind — picks the colour pair (background + symbol).
const TONES = {
  mate:        { bg: 'rgba(244,114,182,0.18)', border: 'rgba(244,114,182,0.55)', fg: '#fbcfe8' },
  mate_threat: { bg: 'rgba(244,114,182,0.14)', border: 'rgba(244,114,182,0.40)', fg: '#fbcfe8' },
  tactical:    { bg: 'rgba(245,158,11,0.18)',  border: 'rgba(245,158,11,0.55)',  fg: '#fde68a' },
  attack:      { bg: 'rgba(239,68,68,0.16)',   border: 'rgba(239,68,68,0.45)',   fg: '#fecaca' },
  promotion:   { bg: 'rgba(168,85,247,0.18)',  border: 'rgba(168,85,247,0.55)',  fg: '#e9d5ff' },
  capture:     { bg: 'rgba(99,102,241,0.16)',  border: 'rgba(99,102,241,0.45)',  fg: '#c7d2fe' },
  threat:      { bg: 'rgba(217,119,6,0.16)',   border: 'rgba(217,119,6,0.45)',   fg: '#fed7aa' },
  positional:  { bg: 'rgba(34,197,94,0.14)',   border: 'rgba(34,197,94,0.40)',   fg: '#bbf7d0' },
  structure:   { bg: 'rgba(20,184,166,0.14)',  border: 'rgba(20,184,166,0.40)',  fg: '#99f6e4' },
  check:       { bg: 'rgba(239,68,68,0.14)',   border: 'rgba(239,68,68,0.40)',   fg: '#fecaca' },
  castle:      { bg: 'rgba(125,211,252,0.16)', border: 'rgba(125,211,252,0.45)', fg: '#bae6fd' },
  defend:      { bg: 'rgba(56,189,248,0.14)',  border: 'rgba(56,189,248,0.40)',  fg: '#bae6fd' },
  develop:     { bg: 'rgba(161,161,170,0.14)', border: 'rgba(161,161,170,0.30)', fg: '#d4d4d8' },
  restrict:    { bg: 'rgba(202,138,4,0.14)',   border: 'rgba(202,138,4,0.40)',   fg: '#fef08a' },
  quiet:       { bg: 'rgba(63,63,70,0.45)',    border: 'rgba(82,82,91,0.50)',    fg: '#a1a1aa' },
};

// Human-readable label for the tooltip.
const KIND_LABEL = {
  mate: 'Checkmate',
  mate_threat: 'Mate threat',
  tactical: 'Tactical',
  attack: 'King attack',
  promotion: 'Promotion / breakthrough',
  capture: 'Capture / trade',
  threat: 'Creates a threat',
  positional: 'Positional',
  structure: 'Structural',
  check: 'Check',
  castle: 'Castling',
  defend: 'Defensive',
  develop: 'Development',
  restrict: 'Restricts opponent',
  quiet: 'Quiet move',
};

// Icon glyphs per kind. All 24×24 viewBox, currentColor fill or stroke.
const ICONS = {
  // Cross / target — for mate.
  mate: <g><circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" strokeWidth="2.4"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/></g>,
  // Halo target — mate threat
  mate_threat: <g><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeDasharray="2 2"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/></g>,
  // Lightning bolt — tactical
  tactical: <path d="M14 3l-7 11h4l-1.5 7L17 9h-4l1-6z" fill="currentColor"/>,
  // Crossed swords — attack
  attack: <g stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M5 5l14 14M19 5L5 19" /></g>,
  // Up arrow — promotion
  promotion: <g><path d="M12 4l5 6h-3v8h-4v-8H7l5-6z" fill="currentColor"/></g>,
  // Diagonal slash — capture
  capture: <g stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18"/></g>,
  // Target with arrow — threat
  threat: <g><circle cx="12" cy="12" r="5" fill="none" stroke="currentColor" strokeWidth="2"/><path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none"/></g>,
  // Outpost square — positional
  positional: <g><rect x="6" y="6" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/></g>,
  // Pawn-chain — structure
  structure: <g fill="currentColor"><circle cx="6" cy="14" r="2.2"/><circle cx="12" cy="10" r="2.2"/><circle cx="18" cy="14" r="2.2"/></g>,
  // Plus — check
  check: <g stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></g>,
  // Castle silhouette — castling
  castle: <g fill="currentColor"><path d="M5 4h2v2h2V4h2v2h2V4h2v2h2V4h2v4l-2 2v6l2 2v2H5v-2l2-2v-6L5 8V4z"/></g>,
  // Shield — defensive
  defend: <path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6l7-3z" fill="none" stroke="currentColor" strokeWidth="2"/>,
  // Up-right arrow — development
  develop: <g stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" fill="none"><path d="M7 17L17 7"/><path d="M11 7h6v6"/></g>,
  // Bracket — restricts
  restrict: <g stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" fill="none"><path d="M9 5L5 12l4 7M15 5l4 7-4 7"/></g>,
  // Dot — quiet
  quiet: <circle cx="12" cy="12" r="2.5" fill="currentColor"/>,
};

// The main pill-circle. Clickable.
export default function MoveCharacterCircle({
  motifIds = [],
  san,
  rank,
  selected = false,
  onClick,
  size = 28,
}) {
  const kind = classifyMove(motifIds);
  const tone = TONES[kind] || TONES.quiet;
  const label = KIND_LABEL[kind];

  return (
    <Tooltip placement="bottom" maxWidth={220} content={
      <div>
        <div style={{ fontWeight: 700, color: '#fafafa', marginBottom: 2 }}>
          #{rank} {san} <span style={{ color: '#a1a1aa', fontWeight: 500 }}>· {label}</span>
        </div>
        {motifIds.length > 0 && (
          <div style={{ color: '#a1a1aa', fontSize: '10px' }}>
            {motifIds.slice(0, 3).map(id => id.replace(/_/g, ' ')).join(' · ')}
          </div>
        )}
      </div>
    }>
      <button
        onClick={onClick}
        className="icon-btn"
        style={{
          width: size, height: size,
          borderRadius: '999px',
          backgroundColor: tone.bg,
          color: tone.fg,
          border: `1.5px solid ${tone.border}`,
          padding: 0,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          // Selected state — extra ring.
          boxShadow: selected ? `0 0 0 2px #18181b, 0 0 0 4px ${tone.border}` : 'none',
          transform: selected ? 'translateY(-1px)' : 'none',
        }}
      >
        <svg width={Math.round(size * 0.55)} height={Math.round(size * 0.55)} viewBox="0 0 24 24" style={{ display: 'block', color: tone.fg }}>
          {ICONS[kind] || ICONS.quiet}
        </svg>
      </button>
    </Tooltip>
  );
}

// Recapture-wisdom: when the top-2 moves are both captures targeting
// the same square (e.g. bxc5 vs dxc5), explain WHY the engine prefers
// one over the other. We attribute reasons by inspecting the motif sets:
//
//   • Top simplifies   → "Recapturing with the X bleeds pieces off the
//                          board (we're already winning material)."
//   • Top opens_file   → "Recapturing with X opens the [file]-file for
//                          our rook to take over."
//   • Top centralizes  → "Recapturing with X centralizes the piece."
//   • Top outpost      → "Recapturing with X plants a piece on a strong
//                          outpost."
//   • Eval delta only  → "Engine prefers X by N centipawns; the
//                          alternative leaves a worse pawn structure /
//                          slower piece activity."
//
// Returns null when no recapture comparison applies.
//
// `moves` is the topMoves array (with `motifs`, `eval_pawns`, `move`).
const FILES = ['a','b','c','d','e','f','g','h'];
function fileLetterFromUci(uci) { return uci ? uci[2] : null; }
function rankFromUci(uci) { return uci ? uci[3] : null; }

export function recaptureWisdom(moves = []) {
  if (!Array.isArray(moves) || moves.length < 2) return null;
  const a = moves[0];
  const b = moves[1];
  if (!a || !b) return null;
  // Both must capture; both target the same square.
  const aIsCap = (a.motifs || []).some(m =>
    ['capture', 'piece_trade', 'queen_trade', 'simplifies', 'trades_into_endgame', 'exchange_sacrifice'].includes(m));
  const bIsCap = (b.motifs || []).some(m =>
    ['capture', 'piece_trade', 'queen_trade', 'simplifies', 'trades_into_endgame', 'exchange_sacrifice'].includes(m));
  if (!aIsCap || !bIsCap) return null;
  const aSq = `${fileLetterFromUci(a.move)}${rankFromUci(a.move)}`;
  const bSq = `${fileLetterFromUci(b.move)}${rankFromUci(b.move)}`;
  if (aSq !== bSq) return null;
  // Same destination — likely two ways to recapture. Attribute the
  // engine's preference based on what the TOP move uniquely has.
  const aSet = new Set(a.motifs || []);
  const bSet = new Set(b.motifs || []);
  const onlyA = [...aSet].filter(x => !bSet.has(x));
  // Highest-priority distinctive motif → drive the explanation.
  const rules = [
    ['simplifies', `Recapturing this way bleeds pieces off the board (we're already ahead).`],
    ['trades_into_endgame', `Recapturing here heads straight to the endgame.`],
    ['opens_file_for', `Recapturing this way opens a file for our heavy pieces.`],
    ['opens_diagonal_for', `Recapturing this way opens a diagonal for our bishop or queen.`],
    ['knight_invasion', `Recapturing with the knight plants a piece deep in enemy territory.`],
    ['outpost', `Recapturing this way plants a piece on a strong outpost.`],
    ['centralizes', `Recapturing this way centralises the piece.`],
    ['fork', `The recapture also forks two enemy pieces.`],
    ['pin', `The recapture also pins an enemy piece.`],
    ['discovered_check', `The recapture uncovers a discovered check.`],
    ['eyes_king_zone', `Recapturing this way joins the attack on the king.`],
    ['battery', `Recapturing this way completes a battery on the open line.`],
    ['rook_seventh', `Recapturing this way puts a rook on the 7th rank.`],
    ['removes_defender', `The recapture also removes a key defender.`],
  ];
  for (const [id, txt] of rules) {
    if (onlyA.includes(id)) {
      return { square: aSq, sanA: a.san, sanB: b.san, reason: txt };
    }
  }
  // No structural distinction — fall back to eval delta.
  const aEv = a.eval_pawns ?? 0;
  const bEv = b.eval_pawns ?? 0;
  const delta = (typeof aEv === 'number' && typeof bEv === 'number')
    ? Math.abs(aEv - bEv) : 0;
  if (delta >= 0.2) {
    return {
      square: aSq, sanA: a.san, sanB: b.san,
      reason: `Engine prefers ${a.san} by ${delta.toFixed(2)} pawns — the alternative ${b.san} leaves a slightly worse position.`,
    };
  }
  return null;
}

// Engine-consensus summary string. Looks across all top-moves and
// returns a one-liner describing the engine's overall recommendation.
//
// Rules of thumb:
//   - all top moves agree on "tactical" / "attack" / "mate_threat" → strong signal
//   - all are captures → simplification
//   - all are positional → quiet improvement
//   - mix → "engine sees several reasonable options"
export function engineConsensus(annotatedMoves = []) {
  if (!annotatedMoves || annotatedMoves.length === 0) return null;
  const kinds = annotatedMoves.map(m => classifyMove(m.motifs || []));
  const counts = {};
  for (const k of kinds) counts[k] = (counts[k] || 0) + 1;
  const total = kinds.length;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const [topKind, topN] = top;
  if (topN >= Math.ceil(total * 0.6)) {
    switch (topKind) {
      case 'mate':        return 'Mate is on the board.';
      case 'mate_threat': return 'Engine sees a mating attack.';
      case 'tactical':    return `Engine consensus: tactical play (${topN}/${total} top moves).`;
      case 'attack':      return `Engine consensus: kingside attack (${topN}/${total} top moves target the king).`;
      case 'promotion':   return 'Engine consensus: push toward promotion.';
      case 'capture':     return `Engine consensus: simplification (${topN}/${total} top moves are trades).`;
      case 'threat':      return `Engine consensus: piling on threats (${topN}/${total} top moves create concrete threats).`;
      case 'positional':  return `Engine consensus: positional improvement (${topN}/${total} top moves).`;
      case 'structure':   return 'Engine consensus: structural improvement.';
      case 'castle':      return 'Engine recommends getting the king to safety.';
      case 'defend':      return 'Engine recommends defensive consolidation.';
      case 'develop':     return 'Engine recommends piece development.';
      default:            return null;
    }
  }
  return `Engine sees several reasonable options (${total} candidates).`;
}
