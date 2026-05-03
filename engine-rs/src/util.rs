//! Small helpers shared across motif detectors: UCI parsing, SAN, role
//! values, etc.

use shakmaty::{san::SanPlus, Chess, Color, File, Move, Position, Rank, Role, Square};

/// Centipawn material values. Knight=300, Bishop=320 — bishop slightly
/// preferred per Stockfish midgame, but for "is this pin/skewer real?"
/// we treat them as equal (see [`role_pin_value`]).
pub fn role_value(role: Role) -> i32 {
    match role {
        Role::Pawn => 100,
        Role::Knight => 300,
        Role::Bishop => 320,
        Role::Rook => 500,
        Role::Queen => 900,
        Role::King => 20_000,
    }
}

/// Bucketed value for pin / skewer: knight and bishop are EQUAL here.
/// A pin is only a real pin when the piece behind is *strictly* heavier:
/// rook or queen behind a minor, queen behind a rook, or king behind anything.
pub fn role_pin_value(role: Role) -> i32 {
    match role {
        Role::Pawn => 1,
        Role::Knight | Role::Bishop => 3,
        Role::Rook => 5,
        Role::Queen => 9,
        Role::King => 100,
    }
}

pub fn role_name(role: Role) -> &'static str {
    match role {
        Role::Pawn => "pawn",
        Role::Knight => "knight",
        Role::Bishop => "bishop",
        Role::Rook => "rook",
        Role::Queen => "queen",
        Role::King => "king",
    }
}

pub fn file_letter(f: File) -> char {
    match f {
        File::A => 'a',
        File::B => 'b',
        File::C => 'c',
        File::D => 'd',
        File::E => 'e',
        File::F => 'f',
        File::G => 'g',
        File::H => 'h',
    }
}

/// Square is in opponent's half (rank 5+ for white; rank 4- for black).
pub fn in_enemy_half(sq: Square, mover: Color) -> bool {
    match mover {
        Color::White => sq.rank() >= Rank::Fifth,
        Color::Black => sq.rank() <= Rank::Fourth,
    }
}

/// 3×3 zone around a king (excluding the king square itself for some uses,
/// included for others — caller decides).
pub fn king_zone(king_sq: Square) -> shakmaty::Bitboard {
    let mut bb = shakmaty::Bitboard::EMPTY;
    let kf = king_sq.file() as i32;
    let kr = king_sq.rank() as i32;
    for df in -1..=1i32 {
        for dr in -1..=1i32 {
            let f = kf + df;
            let r = kr + dr;
            if (0..8).contains(&f) && (0..8).contains(&r) {
                bb |= shakmaty::Bitboard::from_square(unsafe {
                    Square::new_unchecked((r * 8 + f) as u32)
                });
            }
        }
    }
    bb
}

/// Light/dark square color.
pub fn square_is_light(sq: Square) -> bool {
    (sq.file() as u8 + sq.rank() as u8) % 2 == 1
}

pub fn parse_uci(pos: &Chess, uci: &str) -> Result<Move, String> {
    if uci.len() < 4 {
        return Err(format!("uci too short: {}", uci));
    }
    let from = parse_square(&uci[0..2])?;
    let to = parse_square(&uci[2..4])?;
    let promotion = if uci.len() >= 5 {
        match &uci[4..5] {
            "q" => Some(Role::Queen),
            "r" => Some(Role::Rook),
            "b" => Some(Role::Bishop),
            "n" => Some(Role::Knight),
            _ => None,
        }
    } else {
        None
    };

    // Find the matching legal move.  Castling needs special handling: in
    // shakmaty's `Move::Castle`, `m.to()` is the *rook* square (chess-960
    // convention), so for standard "e1g1" / "e1c1" UCI we compute the
    // king's destination square ourselves and match against that.
    for m in pos.legal_moves() {
        if m.from() == Some(from) && m.to() == to && m.promotion() == promotion {
            return Ok(m);
        }
        if let Move::Castle { king, rook } = &m {
            if *king != from { continue; }
            let king_dest_file = if rook.file() > king.file() {
                File::G  // kingside
            } else {
                File::C  // queenside
            };
            let king_dest = Square::from_coords(king_dest_file, king.rank());
            if king_dest == to || *rook == to {
                return Ok(m);
            }
        }
    }
    Err(format!("not a legal move: {}", uci))
}

fn parse_square(s: &str) -> Result<Square, String> {
    s.parse().map_err(|e| format!("bad square {}: {}", s, e))
}

pub fn move_to_san(pos: &Chess, mv: &Move) -> String {
    SanPlus::from_move(pos.clone(), mv).to_string()
}

/// Pieces that move "forward" depend on color — small helper for pawn dirs.
pub fn forward_rank_offset(c: Color) -> i32 {
    match c {
        Color::White => 1,
        Color::Black => -1,
    }
}
