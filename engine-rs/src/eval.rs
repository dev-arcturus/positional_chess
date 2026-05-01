//! Handcrafted classical evaluator — same architectural shape as
//! Stockfish's classical eval (the one that drove SF1–SF11 and is still
//! kept as a reference inside SF14+). Computed without any search.
//!
//! Design goals:
//!
//!   1. **Decomposable.** The final centipawn score is a sum of named
//!      heads (material, psqt, mobility, pawns, king_safety, threats,
//!      imbalance). Each head is per-side and tapered (mg/eg) so the
//!      caller can attribute *why* a position is +0.7 — not just "it is."
//!
//!   2. **Phase-aware.** Same piece is worth different things in mg vs eg.
//!      We use PeSTO's tuned PSQTs (32-piece-symmetric, mg+eg per piece)
//!      and the standard 24-quanta phase ramp:
//!         phase = N+B + 2R + 4Q  (capped at 24)
//!         final = (mg * phase + eg * (24 - phase)) / 24.
//!
//!   3. **Cheap.** All-bitboard, no allocations on the hot path. A full
//!      eval is well under 100µs on typical hardware.
//!
//!   4. **Driver of everything else.** This module is the engine behind
//!      `piece_value::contribution`, the new sacrifice/hangs logic in
//!      `motifs::detect_sacrifice_or_hangs`, and the heatmap.
//!
//! References:
//!   PeSTO PSQTs / material values: chessprogramming.org/PeSTO%27s_Evaluation_Function
//!   Stockfish 11 evaluate.cpp     : github.com/official-stockfish/Stockfish (sf_11 tag)

use serde::{Deserialize, Serialize};
use shakmaty::{
    attacks::{bishop_attacks, king_attacks, knight_attacks, pawn_attacks, queen_attacks, rook_attacks},
    Bitboard, Board, Color, File, Piece, Rank, Role, Square,
};

// ── Data shapes ─────────────────────────────────────────────────────────

#[derive(Default, Copy, Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Tapered {
    pub mg: i32,
    pub eg: i32,
}

impl Tapered {
    pub const ZERO: Tapered = Tapered { mg: 0, eg: 0 };
    pub const fn new(mg: i32, eg: i32) -> Self { Tapered { mg, eg } }

    pub fn add_assign(&mut self, o: Tapered) { self.mg += o.mg; self.eg += o.eg; }
    pub fn sub_assign(&mut self, o: Tapered) { self.mg -= o.mg; self.eg -= o.eg; }
    pub fn negate(self) -> Tapered { Tapered { mg: -self.mg, eg: -self.eg } }

    /// Phase-blend to a single centipawn score. `phase` runs 0..=24 with
    /// 24 = pure middlegame, 0 = pure endgame.
    pub fn taper(self, phase: i32) -> i32 {
        let p = phase.clamp(0, 24);
        (self.mg * p + self.eg * (24 - p)) / 24
    }
}

#[derive(Default, Copy, Clone, Debug, Serialize, Deserialize)]
pub struct EvalSide {
    pub material: Tapered,
    pub psqt: Tapered,
    pub mobility: Tapered,
    pub pawns: Tapered,
    pub king_safety: Tapered,
    pub threats: Tapered,
    pub imbalance: Tapered,
}

impl EvalSide {
    pub fn total(&self) -> Tapered {
        let mut t = Tapered::ZERO;
        t.add_assign(self.material);
        t.add_assign(self.psqt);
        t.add_assign(self.mobility);
        t.add_assign(self.pawns);
        t.add_assign(self.king_safety);
        t.add_assign(self.threats);
        t.add_assign(self.imbalance);
        t
    }
}

#[derive(Default, Copy, Clone, Debug, Serialize, Deserialize)]
pub struct Eval {
    pub phase: i32,
    pub white: EvalSide,
    pub black: EvalSide,
    /// Final centipawn score, **white-relative**.  +N = white better.
    pub final_cp: i32,
}

// ── PeSTO material values ───────────────────────────────────────────────
// (Tuned by Ronald Friederich. Same magnitudes Stockfish 14 still uses
// internally for some legacy scoring.)

const MAT: [Tapered; 6] = [
    /* P */ Tapered::new(82, 94),
    /* N */ Tapered::new(337, 281),
    /* B */ Tapered::new(365, 297),
    /* R */ Tapered::new(477, 512),
    /* Q */ Tapered::new(1025, 936),
    /* K */ Tapered::new(0, 0),
];

#[inline]
fn role_idx(r: Role) -> usize {
    match r {
        Role::Pawn => 0,
        Role::Knight => 1,
        Role::Bishop => 2,
        Role::Rook => 3,
        Role::Queen => 4,
        Role::King => 5,
    }
}

// ── Piece-Square Tables ─────────────────────────────────────────────────
// PeSTO PSQTs. Table layout: index 0 = a8 (rank 8 file a), index 7 = h8,
// index 56 = a1, index 63 = h1 — i.e. natural reading order top-to-bottom
// from white's perspective. Black squares are mirrored vertically.

const PSQT_MG: [[i32; 64]; 6] = [
    /* P */ [
          0,   0,   0,   0,   0,   0,  0,   0,
         98, 134,  61,  95,  68, 126, 34, -11,
         -6,   7,  26,  31,  65,  56, 25, -20,
        -14,  13,   6,  21,  23,  12, 17, -23,
        -27,  -2,  -5,  12,  17,   6, 10, -25,
        -26,  -4,  -4, -10,   3,   3, 33, -12,
        -35,  -1, -20, -23, -15,  24, 38, -22,
          0,   0,   0,   0,   0,   0,  0,   0,
    ],
    /* N */ [
        -167, -89, -34, -49,  61, -97, -15, -107,
         -73, -41,  72,  36,  23,  62,   7,  -17,
         -47,  60,  37,  65,  84, 129,  73,   44,
          -9,  17,  19,  53,  37,  69,  18,   22,
         -13,   4,  16,  13,  28,  19,  21,   -8,
         -23,  -9,  12,  10,  19,  17,  25,  -16,
         -29, -53, -12,  -3,  -1,  18, -14,  -19,
        -105, -21, -58, -33, -17, -28, -19,  -23,
    ],
    /* B */ [
        -29,   4, -82, -37, -25, -42,   7,  -8,
        -26,  16, -18, -13,  30,  59,  18, -47,
        -16,  37,  43,  40,  35,  50,  37,  -2,
         -4,   5,  19,  50,  37,  37,   7,  -2,
         -6,  13,  13,  26,  34,  12,  10,   4,
          0,  15,  15,  15,  14,  27,  18,  10,
          4,  15,  16,   0,   7,  21,  33,   1,
        -33,  -3, -14, -21, -13, -12, -39, -21,
    ],
    /* R */ [
         32,  42,  32,  51, 63,  9,  31,  43,
         27,  32,  58,  62, 80, 67,  26,  44,
         -5,  19,  26,  36, 17, 45,  61,  16,
        -24, -11,   7,  26, 24, 35,  -8, -20,
        -36, -26, -12,  -1,  9, -7,   6, -23,
        -45, -25, -16, -17,  3,  0,  -5, -33,
        -44, -16, -20,  -9, -1, 11,  -6, -71,
        -19, -13,   1,  17, 16,  7, -37, -26,
    ],
    /* Q */ [
        -28,   0,  29,  12,  59,  44,  43,  45,
        -24, -39,  -5,   1, -16,  57,  28,  54,
        -13, -17,   7,   8,  29,  56,  47,  57,
        -27, -27, -16, -16,  -1,  17,  -2,   1,
         -9, -26,  -9, -10,  -2,  -4,   3,  -3,
        -14,   2, -11,  -2,  -5,   2,  14,   5,
        -35,  -8,  11,   2,   8,  15,  -3,   1,
         -1, -18,  -9,  10, -15, -25, -31, -50,
    ],
    /* K */ [
        -65,  23,  16, -15, -56, -34,   2,  13,
         29,  -1, -20,  -7,  -8,  -4, -38, -29,
         -9,  24,   2, -16, -20,   6,  22, -22,
        -17, -20, -12, -27, -30, -25, -14, -36,
        -49,  -1, -27, -39, -46, -44, -33, -51,
        -14, -14, -22, -46, -44, -30, -15, -27,
          1,   7,  -8, -64, -43, -16,   9,   8,
        -15,  36,  12, -54,   8, -28,  24,  14,
    ],
];

const PSQT_EG: [[i32; 64]; 6] = [
    /* P */ [
          0,   0,   0,   0,   0,   0,   0,   0,
        178, 173, 158, 134, 147, 132, 165, 187,
         94, 100,  85,  67,  56,  53,  82,  84,
         32,  24,  13,   5,  -2,   4,  17,  17,
         13,   9,  -3,  -7,  -7,  -8,   3,  -1,
          4,   7,  -6,   1,   0,  -5,  -1,  -8,
         13,   8,   8,  10,  13,   0,   2,  -7,
          0,   0,   0,   0,   0,   0,   0,   0,
    ],
    /* N */ [
        -58, -38, -13, -28, -31, -27, -63, -99,
        -25,  -8, -25,  -2,  -9, -25, -24, -52,
        -24, -20,  10,   9,  -1,  -9, -19, -41,
        -17,   3,  22,  22,  22,  11,   8, -18,
        -18,  -6,  16,  25,  16,  17,   4, -18,
        -23,  -3,  -1,  15,  10,  -3, -20, -22,
        -42, -20, -10,  -5,  -2, -20, -23, -44,
        -29, -51, -23, -15, -22, -18, -50, -64,
    ],
    /* B */ [
        -14, -21, -11,  -8, -7,  -9, -17, -24,
         -8,  -4,   7, -12, -3, -13,  -4, -14,
          2,  -8,   0,  -1, -2,   6,   0,   4,
         -3,   9,  12,   9, 14,  10,   3,   2,
         -6,   3,  13,  19,  7,  10,  -3,  -9,
        -12,  -3,   8,  10, 13,   3,  -7, -15,
        -14, -18,  -7,  -1,  4,  -9, -15, -27,
        -23,  -9, -23,  -5, -9, -16,  -5, -17,
    ],
    /* R */ [
         13, 10, 18, 15, 12,  12,   8,   5,
         11, 13, 13, 11, -3,   3,   8,   3,
          7,  7,  7,  5,  4,  -3,  -5,  -3,
          4,  3, 13,  1,  2,   1,  -1,   2,
          3,  5,  8,  4, -5,  -6,  -8, -11,
         -4,  0, -5, -1, -7, -12,  -8, -16,
         -6, -6,  0,  2, -9,  -9, -11,  -3,
         -9,  2,  3, -1, -5, -13,   4, -20,
    ],
    /* Q */ [
         -9,  22,  22,  27,  27,  19,  10,  20,
        -17,  20,  32,  41,  58,  25,  30,   0,
        -20,   6,   9,  49,  47,  35,  19,   9,
          3,  22,  24,  45,  57,  40,  57,  36,
        -18,  28,  19,  47,  31,  34,  39,  23,
        -16, -27,  15,   6,   9,  17,  10,   5,
        -22, -23, -30, -16, -16, -23, -36, -32,
        -33, -28, -22, -43,  -5, -32, -20, -41,
    ],
    /* K */ [
        -74, -35, -18, -18, -11,  15,   4, -17,
        -12,  17,  14,  17,  17,  38,  23,  11,
         10,  17,  23,  15,  20,  45,  44,  13,
         -8,  22,  24,  27,  26,  33,  26,   3,
        -18,  -4,  21,  24,  27,  23,   9, -11,
        -19,  -3,  11,  21,  23,  16,   7,  -9,
        -27, -11,   4,  13,  14,   4,  -5, -17,
        -53, -34, -21, -11, -28, -14, -24, -43,
    ],
];

#[inline]
fn psqt_lookup(piece: Piece, sq: Square) -> Tapered {
    // Tables are written from white's POV with index 0 = a8.
    // shakmaty's `Square` is indexed 0=a1 .. 63=h8, so we need to flip.
    let sq_idx = sq as usize;
    let table_idx = match piece.color {
        // White: flip vertically — rank 0 (a1) → row 7 in our tables.
        Color::White => sq_idx ^ 56,
        // Black: PSQTs are white-perspective; for black we flip BOTH the
        // square (mirror) and use the same tables.
        Color::Black => sq_idx,
    };
    let r = role_idx(piece.role);
    Tapered::new(PSQT_MG[r][table_idx], PSQT_EG[r][table_idx])
}

// ── Phase ───────────────────────────────────────────────────────────────

const PHASE_WEIGHT: [i32; 6] = [0, 1, 1, 2, 4, 0];

pub fn compute_phase(board: &Board) -> i32 {
    let mut p = 0;
    for sq in board.occupied() {
        if let Some(piece) = board.piece_at(sq) {
            p += PHASE_WEIGHT[role_idx(piece.role)];
        }
    }
    p.min(24)
}

// ── Mobility ────────────────────────────────────────────────────────────
// Piece-type-indexed table: # safe move-target squares → tapered bonus.
// Source: Stockfish 11 mobility tables, lightly compressed (we cap rather
// than extending past sensible limits).

const MOB_KNIGHT: &[Tapered] = &[
    Tapered::new(-62, -81),
    Tapered::new(-53, -56),
    Tapered::new(-12, -30),
    Tapered::new( -4, -14),
    Tapered::new(  3,   8),
    Tapered::new( 13,  15),
    Tapered::new( 22,  23),
    Tapered::new( 28,  27),
    Tapered::new( 33,  33),
];
const MOB_BISHOP: &[Tapered] = &[
    Tapered::new(-48, -59), Tapered::new(-20, -23), Tapered::new( 16,  -3),
    Tapered::new( 26,  13), Tapered::new( 38,  24), Tapered::new( 51,  42),
    Tapered::new( 55,  54), Tapered::new( 63,  57), Tapered::new( 63,  65),
    Tapered::new( 68,  73), Tapered::new( 81,  78), Tapered::new( 81,  86),
    Tapered::new( 91,  88), Tapered::new( 98,  97),
];
const MOB_ROOK: &[Tapered] = &[
    Tapered::new(-58, -76), Tapered::new(-27, -18), Tapered::new(-15,  28),
    Tapered::new(-10,  55), Tapered::new( -5,  69), Tapered::new( -2,  82),
    Tapered::new(  9, 112), Tapered::new( 16, 118), Tapered::new( 30, 132),
    Tapered::new( 29, 142), Tapered::new( 32, 155), Tapered::new( 38, 165),
    Tapered::new( 46, 166), Tapered::new( 48, 169), Tapered::new( 58, 171),
];
const MOB_QUEEN: &[Tapered] = &[
    Tapered::new(-39, -36), Tapered::new(-21, -15), Tapered::new(  3,   8),
    Tapered::new(  3,  18), Tapered::new( 14,  34), Tapered::new( 22,  54),
    Tapered::new( 28,  61), Tapered::new( 41,  73), Tapered::new( 43,  79),
    Tapered::new( 48,  92), Tapered::new( 56,  94), Tapered::new( 60, 104),
    Tapered::new( 60, 113), Tapered::new( 66, 120), Tapered::new( 67, 123),
    Tapered::new( 70, 126), Tapered::new( 71, 133), Tapered::new( 73, 136),
    Tapered::new( 79, 140), Tapered::new( 88, 143), Tapered::new( 88, 148),
    Tapered::new( 99, 166), Tapered::new(102, 170), Tapered::new(102, 175),
    Tapered::new(106, 184), Tapered::new(109, 191), Tapered::new(113, 206),
    Tapered::new(116, 212),
];

#[inline]
fn mob_table(role: Role) -> Option<&'static [Tapered]> {
    match role {
        Role::Knight => Some(MOB_KNIGHT),
        Role::Bishop => Some(MOB_BISHOP),
        Role::Rook => Some(MOB_ROOK),
        Role::Queen => Some(MOB_QUEEN),
        _ => None,
    }
}

#[inline]
fn mobility_lookup(role: Role, count: usize) -> Tapered {
    match mob_table(role) {
        Some(tbl) => tbl[count.min(tbl.len() - 1)],
        None => Tapered::ZERO,
    }
}

// ── Pawn structure terms (Stockfish-inspired magnitudes) ────────────────

const DOUBLED:    Tapered = Tapered::new(-11, -56);
const ISOLATED:   Tapered = Tapered::new(-5, -15);
const BACKWARD:   Tapered = Tapered::new(-9, -24);
// Connected/supported pawns: bonus by rank (white-relative). Rank 1/8 = 0.
const CONNECTED_BY_RANK: [Tapered; 8] = [
    Tapered::new(0, 0),   // rank 1
    Tapered::new(7, 0),   // rank 2
    Tapered::new(8, 0),   // rank 3
    Tapered::new(12, 3),  // rank 4
    Tapered::new(29, 13), // rank 5
    Tapered::new(48, 53), // rank 6
    Tapered::new(86, 95), // rank 7
    Tapered::new(0, 0),   // rank 8
];
// Passed-pawn bonus by rank (white-relative).
const PASSED_BY_RANK: [Tapered; 8] = [
    Tapered::new(0, 0),
    Tapered::new(10, 28),
    Tapered::new(17, 33),
    Tapered::new(15, 41),
    Tapered::new(62, 72),
    Tapered::new(168, 177),
    Tapered::new(276, 260),
    Tapered::new(0, 0),
];

fn evaluate_pawns(board: &Board, color: Color) -> Tapered {
    let mut t = Tapered::ZERO;
    let our = board.pawns() & board.by_color(color);
    let enemy_pawns = board.pawns() & board.by_color(color.other());

    // Per-file pawn counts for doubled / isolated tests.
    let mut counts = [0u8; 8];
    for s in our { counts[s.file() as usize] += 1; }

    for s in our {
        let f = s.file() as usize;
        let r = s.rank() as usize;
        // Doubled.
        if counts[f] >= 2 { t.add_assign(DOUBLED); }
        // Isolated (no friendly pawn on adjacent files).
        let left = if f > 0 { counts[f - 1] } else { 0 };
        let right = if f < 7 { counts[f + 1] } else { 0 };
        if left == 0 && right == 0 { t.add_assign(ISOLATED); }
        // Backward: simple definition — no friendly pawn on adjacent file
        // at same or lower rank (white) and front square attacked by an
        // enemy pawn we can't dispute.
        if !left.gt(&0) && !right.gt(&0) { /* already counted as isolated */ }
        else if is_backward(board, s, color) { t.add_assign(BACKWARD); }
        // Passed.
        if is_passed_pawn(s, color, enemy_pawns) {
            let rank_for_color = match color {
                Color::White => r,
                Color::Black => 7 - r,
            };
            t.add_assign(PASSED_BY_RANK[rank_for_color]);
        }
        // Connected / supported (defended by another friendly pawn).
        if is_supported(board, s, color) {
            let rank_for_color = match color {
                Color::White => r,
                Color::Black => 7 - r,
            };
            t.add_assign(CONNECTED_BY_RANK[rank_for_color]);
        }
    }
    t
}

fn is_backward(board: &Board, sq: Square, color: Color) -> bool {
    // Front square covered by enemy pawn we can't fight back against.
    let f = sq.file() as i32;
    let r = sq.rank() as i32;
    let fwd = if color == Color::White { 1 } else { -1 };
    // No friendly pawn on adjacent file at our rank or behind?
    for df in [-1i32, 1] {
        let nf = f + df;
        if !(0..8).contains(&nf) { continue; }
        for nr in 0..8i32 {
            let s = Square::from_coords(File::new(nf as u32), Rank::new(nr as u32));
            if let Some(p) = board.piece_at(s) {
                if p.role == Role::Pawn && p.color == color {
                    if (color == Color::White && nr <= r)
                        || (color == Color::Black && nr >= r) {
                        return false;
                    }
                }
            }
        }
    }
    let r2 = r + 2 * fwd;
    if !(0..8).contains(&r2) { return false; }
    for df in [-1i32, 1] {
        let nf = f + df;
        if !(0..8).contains(&nf) { continue; }
        let s = Square::from_coords(File::new(nf as u32), Rank::new(r2 as u32));
        if let Some(p) = board.piece_at(s) {
            if p.role == Role::Pawn && p.color != color { return true; }
        }
    }
    false
}

fn is_passed_pawn(sq: Square, color: Color, enemy_pawns: Bitboard) -> bool {
    let f = sq.file() as i32;
    let r = sq.rank() as i32;
    for df in [-1, 0, 1] {
        let nf = f + df;
        if !(0..8).contains(&nf) { continue; }
        for nr in 0..8 {
            let s = Square::from_coords(File::new(nf as u32), Rank::new(nr as u32));
            if !enemy_pawns.contains(s) { continue; }
            if (color == Color::White && nr > r) || (color == Color::Black && nr < r) {
                return false;
            }
        }
    }
    true
}

fn is_supported(board: &Board, sq: Square, color: Color) -> bool {
    // A pawn behind us on an adjacent file = defender.
    let f = sq.file() as i32;
    let r = sq.rank() as i32;
    let back = if color == Color::White { -1 } else { 1 };
    let nr = r + back;
    if !(0..8).contains(&nr) { return false; }
    for df in [-1, 1] {
        let nf = f + df;
        if !(0..8).contains(&nf) { continue; }
        let s = Square::from_coords(File::new(nf as u32), Rank::new(nr as u32));
        if let Some(p) = board.piece_at(s) {
            if p.role == Role::Pawn && p.color == color { return true; }
        }
    }
    false
}

// ── King safety (light) ─────────────────────────────────────────────────
// Stockfish has hundreds of lines for this; we capture the dominant
// signal: count enemy attackers landing in the 3×3 zone around our king,
// weighted by attacker piece type, with extra weight when our pawn shield
// is missing.

const KING_ATTACKER_WEIGHT: [i32; 6] = [
    /* P */ 0, /* N */ 81, /* B */ 52, /* R */ 44, /* Q */ 10, /* K */ 0,
];

fn evaluate_king_safety(board: &Board, color: Color) -> Tapered {
    let king_sq = match board.king_of(color) {
        Some(s) => s,
        None => return Tapered::ZERO,
    };
    // 3×3 zone around our king.
    let mut zone = Bitboard::EMPTY;
    let kf = king_sq.file() as i32;
    let kr = king_sq.rank() as i32;
    for df in -1..=1 {
        for dr in -1..=1 {
            let f = kf + df;
            let r = kr + dr;
            if !(0..8).contains(&f) || !(0..8).contains(&r) { continue; }
            zone |= Bitboard::from_square(Square::from_coords(File::new(f as u32), Rank::new(r as u32)));
        }
    }

    // Sum weighted attacker contributions.
    let occ = board.occupied();
    let enemy = color.other();
    let mut weighted: i32 = 0;
    let mut attacker_count: i32 = 0;
    for sq in board.by_color(enemy) {
        let p = match board.piece_at(sq) { Some(p) => p, None => continue };
        let attacks = match p.role {
            Role::Pawn => pawn_attacks(p.color, sq),
            Role::Knight => knight_attacks(sq),
            Role::Bishop => bishop_attacks(sq, occ),
            Role::Rook => rook_attacks(sq, occ),
            Role::Queen => queen_attacks(sq, occ),
            Role::King => king_attacks(sq),
        };
        let hits = (attacks & zone).count() as i32;
        if hits > 0 {
            weighted += KING_ATTACKER_WEIGHT[role_idx(p.role)] * hits;
            attacker_count += 1;
        }
    }
    if attacker_count < 2 { return Tapered::ZERO; }

    // Pawn shield: count missing shield pawns (3 squares directly in front
    // of king on king's wing). 0..=3. Each missing pawn adds 30cp pressure.
    let shield_files: [i32; 3] = [kf - 1, kf, kf + 1];
    let shield_rank = match color {
        Color::White => kr + 1,
        Color::Black => kr - 1,
    };
    let mut missing_shield = 0;
    if (0..8).contains(&shield_rank) {
        for &sf in &shield_files {
            if !(0..8).contains(&sf) { missing_shield += 1; continue; }
            let s = Square::from_coords(File::new(sf as u32), Rank::new(shield_rank as u32));
            let p = board.piece_at(s);
            if !matches!(p, Some(pp) if pp.role == Role::Pawn && pp.color == color) {
                missing_shield += 1;
            }
        }
    }

    // Final danger score, scaled.
    let mut danger = weighted + missing_shield * 30;
    danger = danger.min(800);
    // Stockfish-style quadratic: danger * danger / 720, but capped for sanity.
    let mg = -((danger * danger) / 720);
    let eg = -danger / 8;
    Tapered::new(mg, eg)
}

// ── Threats ─────────────────────────────────────────────────────────────
// Per-piece scan: each enemy piece that's hanging (SEE > 0 for us) or
// attacked by a less-valuable piece contributes a penalty for them.
// This is the actual driver for sacrifice-vs-hangs classification later.

const HANGING:    Tapered = Tapered::new(70, 30);
const WEAK_BY_MINOR: Tapered = Tapered::new(35, 30);
const WEAK_BY_ROOK:  Tapered = Tapered::new(45, 50);

fn evaluate_threats(board: &Board, color: Color) -> Tapered {
    let mut t = Tapered::ZERO;
    let occ = board.occupied();
    let enemy = color.other();
    // For each enemy non-pawn piece...
    for sq in board.by_color(enemy) {
        let target = match board.piece_at(sq) { Some(p) => p, None => continue };
        if target.role == Role::Pawn || target.role == Role::King { continue; }
        // Find smallest of OUR attackers landing on `sq`.
        let mut our_min: Option<Role> = None;
        let our_attackers = attackers_to(board, sq, color, occ);
        for asq in our_attackers {
            let arole = match board.piece_at(asq) { Some(p) => p.role, None => continue };
            if our_min.map_or(true, |r| material_index(arole) < material_index(r)) {
                our_min = Some(arole);
            }
        }
        let attacker_role = match our_min { Some(r) => r, None => continue };
        // Hanging: any defender?
        let defenders = attackers_to(board, sq, enemy, occ);
        if defenders.is_empty() {
            t.add_assign(HANGING);
            continue;
        }
        // Otherwise: weak by minor / rook based on attacker.
        if matches!(attacker_role, Role::Knight | Role::Bishop) {
            t.add_assign(WEAK_BY_MINOR);
        } else if attacker_role == Role::Rook && matches!(target.role, Role::Queen) {
            t.add_assign(WEAK_BY_ROOK);
        }
    }
    t
}

#[inline]
fn material_index(r: Role) -> i32 {
    // Just for "smaller attacker" comparisons.
    match r {
        Role::Pawn => 0,
        Role::Knight | Role::Bishop => 1,
        Role::Rook => 2,
        Role::Queen => 3,
        Role::King => 4,
    }
}

fn attackers_to(board: &Board, to: Square, color: Color, occ: Bitboard) -> Bitboard {
    let mut bb = Bitboard::EMPTY;
    bb |= board.by_piece(Piece { color, role: Role::Pawn })
        & pawn_attacks(color.other(), to);
    bb |= board.by_piece(Piece { color, role: Role::Knight })
        & knight_attacks(to);
    bb |= board.by_piece(Piece { color, role: Role::Bishop })
        & bishop_attacks(to, occ);
    bb |= board.by_piece(Piece { color, role: Role::Rook })
        & rook_attacks(to, occ);
    bb |= board.by_piece(Piece { color, role: Role::Queen })
        & queen_attacks(to, occ);
    bb |= board.by_piece(Piece { color, role: Role::King })
        & king_attacks(to);
    bb
}

// ── Imbalance ───────────────────────────────────────────────────────────
// Just the bishop pair for now — the most empirically robust imbalance term.

const BISHOP_PAIR: Tapered = Tapered::new(30, 50);

fn evaluate_imbalance(board: &Board, color: Color) -> Tapered {
    let mut t = Tapered::ZERO;
    if (board.bishops() & board.by_color(color)).count() >= 2 {
        t.add_assign(BISHOP_PAIR);
    }
    t
}

// ── Top-level evaluator ─────────────────────────────────────────────────

pub fn evaluate(board: &Board) -> Eval {
    let phase = compute_phase(board);
    let mut white = EvalSide::default();
    let mut black = EvalSide::default();
    let occ = board.occupied();

    for sq in occ {
        let piece = match board.piece_at(sq) { Some(p) => p, None => continue };
        let side = if piece.color == Color::White { &mut white } else { &mut black };

        // Material.
        side.material.add_assign(MAT[role_idx(piece.role)]);
        // PSQT.
        side.psqt.add_assign(psqt_lookup(piece, sq));
        // Mobility (sliders + knights only).
        if let Some(_) = mob_table(piece.role) {
            let attacks = match piece.role {
                Role::Knight => knight_attacks(sq),
                Role::Bishop => bishop_attacks(sq, occ),
                Role::Rook => rook_attacks(sq, occ),
                Role::Queen => queen_attacks(sq, occ),
                _ => Bitboard::EMPTY,
            };
            // Don't count squares occupied by our own pieces.
            let safe = attacks & !board.by_color(piece.color);
            side.mobility.add_assign(mobility_lookup(piece.role, safe.count()));
        }
    }

    white.pawns = evaluate_pawns(board, Color::White);
    black.pawns = evaluate_pawns(board, Color::Black);
    white.king_safety = evaluate_king_safety(board, Color::White);
    black.king_safety = evaluate_king_safety(board, Color::Black);
    white.threats = evaluate_threats(board, Color::White);
    black.threats = evaluate_threats(board, Color::Black);
    white.imbalance = evaluate_imbalance(board, Color::White);
    black.imbalance = evaluate_imbalance(board, Color::Black);

    let mut total = white.total();
    let bt = black.total();
    total.sub_assign(bt);
    let final_cp = total.taper(phase);

    Eval { phase, white, black, final_cp }
}
