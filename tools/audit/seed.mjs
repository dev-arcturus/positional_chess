// Seed corpus for the position-by-position audit.
//
// Five categories so we exercise different terms in the evaluator + different
// motif detectors. Each entry has a `note` field used in the report.

export const SEED = [
  // ── OPENINGS (book moves, develop/centralize/castle) ──────────────────
  { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    note: 'Starting position', kind: 'opening' },
  { fen: 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
    note: 'After 1.e4 e5', kind: 'opening' },
  { fen: 'rnbqkb1r/pppp1ppp/5n2/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
    note: '1.e4 e5 2.Nf3 Nf6 — Petroff', kind: 'opening' },
  { fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3',
    note: 'Italian: White Bc4 set up', kind: 'opening' },
  { fen: 'rnbqk2r/ppp1ppbp/3p1np1/8/3PP3/2N2N2/PPP2PPP/R1BQKB1R w KQkq - 0 5',
    note: "Pirc / KID-ish setup", kind: 'opening' },

  // ── QUIET MIDDLEGAMES (positional themes, no immediate tactics) ───────
  { fen: 'r1bq1rk1/pp1n1ppp/2pbpn2/3p4/2PP4/2NBPN2/PP1Q1PPP/R3K2R w KQ - 0 9',
    note: 'QGD-ish; both sides developed', kind: 'middlegame' },
  { fen: 'r1bq1rk1/pp1n1pbp/2pp1np1/4p3/P1PPP3/2N2N2/1P2BPPP/R1BQ1RK1 w - - 0 9',
    note: 'KID structure, central tension', kind: 'middlegame' },
  { fen: 'r2q1rk1/pp1n1ppp/2pbpn2/3p4/2PP4/2NBPN2/PP1Q1PPP/R3K2R w KQ - 0 9',
    note: 'Variation of QGD', kind: 'middlegame' },
  { fen: 'r1bq1rk1/pp2ppbp/n2p1np1/2pP4/2P5/2N2NP1/PP2PPBP/R1BQ1RK1 w - - 0 9',
    note: 'Benoni-style, locked centre', kind: 'middlegame' },

  // ── TACTICS (motif fire here matters most) ────────────────────────────
  { fen: '2k5/8/8/8/8/n7/8/R3K3 b - - 0 1',
    note: 'Royal fork: Nc2 forks K + R', kind: 'tactic' },
  { fen: '4k3/8/8/4n3/8/8/8/4R2K w - - 0 1',
    note: 'Re3 absolute pin on Ne5', kind: 'tactic' },
  { fen: '4k3/4q3/8/8/8/8/8/R5K1 w - - 0 1',
    note: 'Re1 pins Q to K (pin not skewer)', kind: 'tactic' },
  { fen: '3k4/8/8/3N4/8/8/8/3RK3 w - - 0 1',
    note: 'Nf6 discovered check from Rd1', kind: 'tactic' },
  { fen: 'r3k2r/ppp2ppp/2n2n2/3pp3/1b1P4/2N1PN2/PPPB1PPP/R2QKB1R w KQkq - 0 1',
    note: 'Symmetrical-ish, look for tactics', kind: 'tactic' },
  { fen: 'r4rk1/pp3ppp/2p1bn2/q2pP3/3P4/P1NB1Q2/1PP2PPP/R3R1K1 w - - 0 1',
    note: 'Kingside attack with sac chances', kind: 'tactic' },
  { fen: '2r3k1/p4ppp/1p1q4/3p4/3Q4/2P3P1/P4PBP/3R2K1 w - - 0 1',
    note: 'Q+R for Black, Q+B+R for White, threats', kind: 'tactic' },
  { fen: '6k1/5p1p/6p1/8/3R4/2r5/5PPP/6K1 w - - 0 1',
    note: 'Rook ending: who is active?', kind: 'tactic' },

  // ── ENDGAMES (eval + opposition + passed pawn detectors) ──────────────
  { fen: '8/8/1KP5/3r4/8/8/8/k7 w - - 0 1',
    note: 'Saavedra (1895) — White wins', kind: 'endgame' },
  { fen: '7K/8/k1P5/7p/8/8/8/8 w - - 0 1',
    note: 'Réti (1921) — King double duty', kind: 'endgame' },
  { fen: '1K6/1P6/k7/8/8/8/r7/2R5 w - - 0 1',
    note: 'Lucena — bridge wins', kind: 'endgame' },
  { fen: '8/8/8/3k4/8/r7/4P3/4K2R w K - 0 1',
    note: 'Philidor — drawing technique', kind: 'endgame' },
  { fen: '8/8/8/3k4/3P4/3K4/8/8 w - - 0 1',
    note: 'KP vs K: opposition', kind: 'endgame' },
  { fen: '8/4k3/8/8/8/3K4/4P3/8 w - - 0 1',
    note: 'KP vs K: square of pawn', kind: 'endgame' },
  { fen: '4k3/p7/8/8/8/8/P7/4K3 w - - 0 1',
    note: 'Symmetrical pawn endgame', kind: 'endgame' },
  { fen: '8/5k2/8/4PK2/8/8/8/8 w - - 0 1',
    note: 'White advanced K + P, easy win', kind: 'endgame' },
  { fen: '8/8/8/p7/P7/k7/8/K7 w - - 0 1',
    note: 'Trébuchet: zugzwang loses', kind: 'endgame' },

  // ── MIDDLEGAME FAMOUS (sharper) ───────────────────────────────────────
  { fen: 'r3r1k1/pp3pbp/2p3p1/3pP3/3P2P1/2P2N2/q2N1PB1/R2QR1K1 b - - 0 18',
    note: 'Sharp middlegame: Q on a2', kind: 'middlegame' },
  { fen: '2r1nrk1/pp3ppp/3p1q2/3Pp3/2P1P3/PP1B1Q1P/3N2P1/2R2RK1 w - - 0 22',
    note: 'Late middlegame, balanced material', kind: 'middlegame' },
  { fen: '6k1/5ppp/8/8/8/8/5PPP/2R3K1 w - - 0 1',
    note: 'Rook + pawns ending, exchange-up', kind: 'endgame' },

  // ── KNOWN TRICKY (regression coverage) ────────────────────────────────
  // Stockfish +5.55 STM-POV bug repro: a position where it's Black's turn and SF
  // says "+555" — that's actually black winning (STM-POV). The verdict must
  // match the bar.
  { fen: '8/8/8/8/4k3/8/4q3/4K3 b - - 0 1',
    note: 'Black to move with mate-in-1; SF score in STM-POV', kind: 'tactic' },
  // Skewer false positive (defended): rook in front shouldn't fall.
  { fen: '4k3/4r3/4r3/4r3/8/8/8/4R2K w - - 0 1',
    note: 'Defended pieces in line — should NOT call it skewer', kind: 'tactic' },

  // ── SACRIFICES (for brilliant detection) ──────────────────────────────
  { fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
    note: 'Italian: Greek-gift territory', kind: 'tactic' },
  { fen: 'r1bq1rk1/pppp1ppp/2n5/4p3/1bB1P3/5N2/PPPP1PPP/RNBQK2R w KQ - 0 5',
    note: 'Pin-pretzel; sac chances', kind: 'tactic' },

  // ── NEAR EQUAL (test that we don't over-explain quiet positions) ──────
  { fen: '8/5pk1/4p1p1/3pP1Pp/3P3P/3K4/8/8 w - - 0 1',
    note: 'King-and-pawn endgame, drawn-ish', kind: 'endgame' },
  { fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR b KQkq - 2 3',
    note: 'Italian: Bishop on c4 unblocked', kind: 'opening' },
];
