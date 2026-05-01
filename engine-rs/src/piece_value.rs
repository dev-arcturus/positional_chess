//! Per-piece contribution to the static evaluation.
//!
//! For a piece on `sq`, its **contribution** is `eval(board) − eval(board − piece)`:
//! how many centipawns the position would lose for the side that owns it
//! if the piece vanished. This is the heatmap's "piece worth" number —
//! decomposed naturally because `eval()` is decomposable.
//!
//! Why not just static material? Because the user will (and should) see:
//!   - a knight on f5 is worth +480cp (mat 337 + psqt 28 + mob 22 + threat
//!     contribution 70 + king-attack 23) — it's that *outpost knight*
//!     that the trade was about;
//!   - the same knight on a3 is worth +280cp (mat 337 − psqt 23 − mob 5 …);
//!   - the bishop in the corner is +320cp (mat 365 − psqt 21 − mob 50 …).
//! That's the educational delta the heatmap needed.
//!
//! Cost: removing a piece is just clearing one bit in the bitboards, then
//! re-running `evaluate()` — about 100µs. 16 pieces × 100µs ≈ 1.6ms total
//! per board, fast enough for instant heatmap updates on hover/drag.

use crate::eval::{evaluate, Eval};
use serde::{Deserialize, Serialize};
use shakmaty::{Bitboard, Board, Color, Piece, Role, Square};

#[derive(Serialize, Deserialize)]
pub struct PieceContribution {
    /// Square the piece is on.
    pub square: String,
    /// 'w' or 'b'.
    pub color: char,
    /// 'p','n','b','r','q','k'.
    pub role: char,
    /// Centipawn worth, **side-relative** (always positive for "this is
    /// a good thing for this piece's owner").
    pub value_cp: i32,
    /// Phase-tapered breakdown by head, **side-relative**.
    pub material: i32,
    pub psqt: i32,
    pub mobility: i32,
    pub pawns: i32,
    pub king_safety: i32,
    pub threats: i32,
    pub imbalance: i32,
}

/// Compute every non-king piece's contribution to the current static eval.
/// Returns one entry per occupied square (excluding kings — removing the
/// king is illegal and "infinite" in any case).
pub fn piece_contributions(board: &Board) -> Vec<PieceContribution> {
    let base = evaluate(board);
    let mut out = Vec::with_capacity(32);

    for sq in board.occupied() {
        let piece = match board.piece_at(sq) { Some(p) => p, None => continue };
        if piece.role == Role::King { continue; }

        // Build a copy of the board with this piece removed.
        let mut copy = board.clone();
        copy.discard_piece_at(sq);
        let alt = evaluate(&copy);

        // Side-relative delta. White piece: a positive (white − black)
        // change is good for white; we want "good for owner" so we keep
        // the white-relative sign for white pieces and flip for black.
        let sign = if piece.color == Color::White { 1 } else { -1 };
        let value_cp = sign * (base.final_cp - alt.final_cp);

        // Per-head deltas. Unlike the totalled value_cp these come from
        // the side's own breakdown so we can attribute cleanly.
        let owner_base = match piece.color {
            Color::White => base.white,
            Color::Black => base.black,
        };
        let owner_alt = match piece.color {
            Color::White => alt.white,
            Color::Black => alt.black,
        };
        let phase = base.phase;
        let material   = (owner_base.material   .taper(phase)) - (owner_alt.material   .taper(phase));
        let psqt       = (owner_base.psqt       .taper(phase)) - (owner_alt.psqt       .taper(phase));
        let mobility   = (owner_base.mobility   .taper(phase)) - (owner_alt.mobility   .taper(phase));
        let pawns      = (owner_base.pawns      .taper(phase)) - (owner_alt.pawns      .taper(phase));
        let king_safety= (owner_base.king_safety.taper(phase)) - (owner_alt.king_safety.taper(phase));
        let threats    = (owner_base.threats    .taper(phase)) - (owner_alt.threats    .taper(phase));
        let imbalance  = (owner_base.imbalance  .taper(phase)) - (owner_alt.imbalance  .taper(phase));

        out.push(PieceContribution {
            square: sq.to_string(),
            color: if piece.color == Color::White { 'w' } else { 'b' },
            role: role_char(piece.role),
            value_cp,
            material, psqt, mobility, pawns, king_safety, threats, imbalance,
        });
    }
    out
}

/// Compute a single piece's contribution.
pub fn piece_contribution(board: &Board, sq: Square) -> Option<PieceContribution> {
    let piece = board.piece_at(sq)?;
    if piece.role == Role::King { return None; }
    let base = evaluate(board);
    let mut copy = board.clone();
    copy.discard_piece_at(sq);
    let alt = evaluate(&copy);
    let sign = if piece.color == Color::White { 1 } else { -1 };
    let value_cp = sign * (base.final_cp - alt.final_cp);
    let owner_base = match piece.color { Color::White => base.white, Color::Black => base.black };
    let owner_alt  = match piece.color { Color::White => alt.white,  Color::Black => alt.black  };
    let phase = base.phase;
    Some(PieceContribution {
        square: sq.to_string(),
        color: if piece.color == Color::White { 'w' } else { 'b' },
        role: role_char(piece.role),
        value_cp,
        material:   owner_base.material   .taper(phase) - owner_alt.material   .taper(phase),
        psqt:       owner_base.psqt       .taper(phase) - owner_alt.psqt       .taper(phase),
        mobility:   owner_base.mobility   .taper(phase) - owner_alt.mobility   .taper(phase),
        pawns:      owner_base.pawns      .taper(phase) - owner_alt.pawns      .taper(phase),
        king_safety:owner_base.king_safety.taper(phase) - owner_alt.king_safety.taper(phase),
        threats:    owner_base.threats    .taper(phase) - owner_alt.threats    .taper(phase),
        imbalance:  owner_base.imbalance  .taper(phase) - owner_alt.imbalance  .taper(phase),
    })
}

#[inline]
fn role_char(r: Role) -> char {
    match r {
        Role::Pawn => 'p', Role::Knight => 'n', Role::Bishop => 'b',
        Role::Rook => 'r', Role::Queen => 'q', Role::King => 'k',
    }
}
