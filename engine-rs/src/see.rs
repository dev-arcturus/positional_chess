//! Static Exchange Evaluation.
//!
//! Standard swap-off algorithm with x-ray attackers: when a slider moves
//! off a square, we re-scan along its ray in case another slider was
//! "behind" it. This is what lets the analyzer distinguish a *real*
//! sacrifice from a defended exchange — and what stops "knight is hanging
//! on f3" from firing every time the knight is defended by a pawn.

use crate::util::role_value;
use shakmaty::{
    attacks::{bishop_attacks, queen_attacks, rook_attacks},
    Bitboard, Board, Color, Piece, Role, Square,
};

/// Static exchange evaluation: the material balance, in centipawns, after
/// the side-to-move captures `to` (initiated by `attacker_role` from
/// `attacker_sq`). Returns the *net gain* for the attacking side.
///
/// > 0  — capture wins material
/// = 0  — even trade
/// < 0  — capture loses material (sacrifice / hanging move)
///
/// Uses iterative swap-off: at each step, the cheapest remaining attacker
/// of the side-to-move plays. X-ray attackers (a queen behind a rook, a
/// rook behind a bishop on the same diagonal) are revealed when an
/// occupier leaves the square.
pub fn see(
    board: &Board,
    to: Square,
    attacker_sq: Square,
    attacker_role: Role,
    side: Color,
    captured_role: Option<Role>,
) -> i32 {
    let mut occ = board.occupied();
    let mut gain: [i32; 32] = [0; 32];
    let mut depth = 0;

    // Capturing piece's "victim" so far: whatever was on `to`.
    gain[0] = captured_role.map(role_value).unwrap_or(0);

    let mut current_role = attacker_role;
    let mut stm = side.other();

    occ ^= Bitboard::from_square(attacker_sq);

    loop {
        depth += 1;
        if depth >= 32 {
            break;
        }
        // Speculative gain: capture the attacker that just played.
        gain[depth] = role_value(current_role) - gain[depth - 1];

        // Pruning: if this side already loses no matter what, stop.
        if gain[depth].max(-gain[depth - 1]) < 0 {
            break;
        }

        // Find STM's cheapest attacker on `to`, given current `occ`.
        let next = least_valuable_attacker(board, occ, to, stm);
        match next {
            None => break,
            Some((sq, role)) => {
                current_role = role;
                occ ^= Bitboard::from_square(sq);
                stm = stm.other();
            }
        }
    }

    // Negamax fold-back. The C-style standard `while (--d) gain[d-1] =
    // -max(-gain[d-1], gain[d])` runs (depth - 1) iterations: it folds
    // gain[d-1] using gain[d], walking down from the deepest capture to
    // gain[0], but it does NOT do an extra fold on gain[0] itself.
    //
    // The previous Rust translation `while depth > 0 { depth -= 1; ... }`
    // ran `depth` iterations instead — one too many. That extra iteration
    // wrote a folded value into gain[0] using an already-folded gain[1],
    // producing wrong-sign SEE results for defended-pawn cases. This is
    // why "pawn defended by N pieces" was sometimes flagged as hanging.
    //
    // Correct form:  while depth > 1 { fold gain[d-1] using gain[d] }.
    while depth > 1 {
        depth -= 1;
        gain[depth - 1] = -((-gain[depth - 1]).max(gain[depth]));
    }
    gain[0]
}

/// Direct SEE wrapper: returns the SEE value of side-to-move capturing `to`.
/// Side-agnostic — use when you just want to know "is this defended well?".
pub fn see_capture(board: &Board, to: Square, side: Color) -> Option<i32> {
    let captured_role = board.role_at(to)?;
    let (attacker_sq, attacker_role) = least_valuable_attacker(
        board,
        board.occupied(),
        to,
        side,
    )?;
    Some(see(
        board,
        to,
        attacker_sq,
        attacker_role,
        side,
        Some(captured_role),
    ))
}

/// Whether a piece *currently sitting* on `sq` (owned by `side`) is hanging
/// in the SEE sense: the opposite side can capture it for material gain.
///
/// Returns `Some(loss)` where `loss > 0` means the piece's owner loses
/// `loss` centipawns. `None` means it isn't attacked at all.
pub fn hanging_loss(board: &Board, sq: Square) -> Option<i32> {
    let piece = board.piece_at(sq)?;
    let attacker_side = piece.color.other();
    let (asq, arole) = least_valuable_attacker(
        board,
        board.occupied(),
        sq,
        attacker_side,
    )?;
    let see_val = see(board, sq, asq, arole, attacker_side, Some(piece.role));
    if see_val > 0 {
        Some(see_val)
    } else {
        None
    }
}

/// Least-valuable attacker of `to` belonging to `side`, given current
/// occupancy `occ`. Includes x-ray sliders revealed by holes in `occ`.
pub fn least_valuable_attacker(
    board: &Board,
    occ: Bitboard,
    to: Square,
    side: Color,
) -> Option<(Square, Role)> {
    // Pawn attackers — pawns attacking `to` are pawns standing on the
    // squares from which they would capture toward `to`.
    let pawns = board.by_piece(Piece { color: side, role: Role::Pawn })
        & shakmaty::attacks::pawn_attacks(side.other(), to)
        & occ;
    if let Some(sq) = pawns.first() {
        return Some((sq, Role::Pawn));
    }

    let knights = board.by_piece(Piece { color: side, role: Role::Knight })
        & shakmaty::attacks::knight_attacks(to)
        & occ;
    if let Some(sq) = knights.first() {
        return Some((sq, Role::Knight));
    }

    let bishops = board.by_piece(Piece { color: side, role: Role::Bishop })
        & bishop_attacks(to, occ)
        & occ;
    if let Some(sq) = bishops.first() {
        return Some((sq, Role::Bishop));
    }

    let rooks = board.by_piece(Piece { color: side, role: Role::Rook })
        & rook_attacks(to, occ)
        & occ;
    if let Some(sq) = rooks.first() {
        return Some((sq, Role::Rook));
    }

    let queens = board.by_piece(Piece { color: side, role: Role::Queen })
        & queen_attacks(to, occ)
        & occ;
    if let Some(sq) = queens.first() {
        return Some((sq, Role::Queen));
    }

    let kings = board.by_piece(Piece { color: side, role: Role::King })
        & shakmaty::attacks::king_attacks(to)
        & occ;
    if let Some(sq) = kings.first() {
        return Some((sq, Role::King));
    }

    None
}
