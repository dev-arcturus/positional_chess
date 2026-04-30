//! All motif detectors — tactical + positional.
//!
//! Every detector is a pure function of (`pos_before`, `pos_after`, `mv`).
//! We materialise the post-move board once, compute a small `Context`,
//! and run each detector against it. Each detector pushes zero or more
//! `Motif`s into a shared `Vec`.
//!
//! Conventions:
//!
//!   - "self" / "mover"   → side that just moved
//!   - "them" / "opp"     → side to move now
//!   - All motif IDs match the JavaScript priority array. New IDs added
//!     here MUST be appended to the JS PRIORITY array or they won't be
//!     surfaced.
//!
//! Priority numbers come from a single ordered list at the bottom of
//! this file. Lower = more important. The composer picks the top 1–2.

use crate::see::{hanging_loss, see, see_capture, least_valuable_attacker};
use crate::util::{
    file_letter, in_enemy_half, king_zone, role_name, role_pin_value, role_value, square_is_light,
};
use serde::{Deserialize, Serialize};
use shakmaty::{
    attacks::{
        bishop_attacks, king_attacks, knight_attacks, pawn_attacks, queen_attacks, rook_attacks,
    },
    Bitboard, Board, CastlingMode, Chess, Color, File, Move, Piece, Position, Rank, Role, Square,
};

#[derive(Serialize, Deserialize, Clone)]
pub struct Motif {
    pub id: String,
    pub phrase: String,
    pub priority: u32,
}

struct Context<'a> {
    before: &'a Chess,
    after: &'a Chess,
    mv: &'a Move,
    from: Square,
    to: Square,
    moved: Piece,
    captured: Option<Piece>,
    mover: Color,
    opp: Color,
    move_number: u32,
}

pub fn detect_all(
    before: &Chess,
    after: &Chess,
    mv: &Move,
    terminal: Option<&'static str>,
) -> Vec<Motif> {
    let from = match mv.from() {
        Some(s) => s,
        None => return vec![], // drops or null moves shouldn't reach here
    };
    let to = mv.to();
    let board_b = before.board();
    let moved = match board_b.piece_at(from) {
        Some(p) => p,
        None => return vec![],
    };
    let captured = mv.capture().map(|role| Piece { color: moved.color.other(), role });

    let ctx = Context {
        before,
        after,
        mv,
        from,
        to,
        moved,
        captured,
        mover: moved.color,
        opp: moved.color.other(),
        move_number: before.fullmoves().get() as u32,
    };

    let mut out: Vec<Motif> = Vec::with_capacity(8);

    // Terminal (non-checkmate) handled separately.
    match terminal {
        Some("stalemate") => push(&mut out, "stalemate", "Stalemates the position"),
        Some("insufficient_material") => push(&mut out, "insufficient_material", "Reaches insufficient material"),
        _ => {}
    }
    if after.is_variant_end() && terminal.is_none() {
        // shakmaty doesn't expose threefold by default — the caller can layer
        // it on if it ever matters.
    }

    // Move-class basics ─────────────────────────────────────────────────
    detect_castling(&ctx, &mut out);
    detect_promotion(&ctx, &mut out);
    detect_en_passant(&ctx, &mut out);
    detect_capture_or_trade(&ctx, &mut out);
    detect_check_class(&ctx, &mut out);

    // Tactics ───────────────────────────────────────────────────────────
    detect_pin(&ctx, &mut out);
    detect_skewer(&ctx, &mut out);
    detect_xray(&ctx, &mut out);
    detect_fork(&ctx, &mut out);
    detect_battery(&ctx, &mut out);
    detect_threats_and_creates(&ctx, &mut out);
    detect_traps_piece(&ctx, &mut out);
    detect_removal_of_defender(&ctx, &mut out);
    detect_overloaded(&ctx, &mut out);
    detect_sacrifice_or_hangs(&ctx, &mut out);
    detect_defends_hanging(&ctx, &mut out);

    // King attack ───────────────────────────────────────────────────────
    detect_attacks_king(&ctx, &mut out);
    detect_eyes_king_zone(&ctx, &mut out);
    detect_smothered_mate_hint(&ctx, &mut out);
    detect_luft(&ctx, &mut out);

    // Positional / piece-specific ───────────────────────────────────────
    detect_outpost(&ctx, &mut out);
    detect_fianchetto(&ctx, &mut out);
    detect_long_diagonal(&ctx, &mut out);
    detect_rook_play(&ctx, &mut out);
    detect_bad_bishop(&ctx, &mut out);
    detect_bishop_pair_lost(&ctx, &mut out);
    detect_color_complex(&ctx, &mut out);
    detect_centralizes(&ctx, &mut out);
    detect_attacks_pawn(&ctx, &mut out);
    detect_prepares_castling(&ctx, &mut out);
    detect_knight_on_rim(&ctx, &mut out);

    // Pawn structure ─────────────────────────────────────────────────────
    detect_pawn_structure_changes(&ctx, &mut out);
    detect_pawn_specific(&ctx, &mut out);

    // Restriction / development ─────────────────────────────────────────
    detect_restricts(&ctx, &mut out);
    detect_develops(&ctx, &mut out);

    // Deduplicate by id, preferring earlier occurrences (which are
    // generally higher-confidence detectors that ran first).
    let mut seen = std::collections::HashSet::new();
    out.retain(|m| seen.insert(m.id.clone()));

    out
}

// ── Helpers ─────────────────────────────────────────────────────────────

fn push(out: &mut Vec<Motif>, id: &str, phrase: impl Into<String>) {
    let priority = priority_of(id);
    out.push(Motif {
        id: id.into(),
        phrase: phrase.into(),
        priority,
    });
}

/// Squares attacked by the piece sitting on `sq` in the given board, ignoring
/// turn order — pure geometric attack set.
fn attacks_from(board: &Board, sq: Square) -> Bitboard {
    let p = match board.piece_at(sq) {
        Some(p) => p,
        None => return Bitboard::EMPTY,
    };
    let occ = board.occupied();
    match p.role {
        Role::Pawn => pawn_attacks(p.color, sq),
        Role::Knight => knight_attacks(sq),
        Role::Bishop => bishop_attacks(sq, occ),
        Role::Rook => rook_attacks(sq, occ),
        Role::Queen => queen_attacks(sq, occ),
        Role::King => king_attacks(sq),
    }
}

fn find_king(board: &Board, color: Color) -> Option<Square> {
    board.king_of(color)
}

// ── Move-class detectors ───────────────────────────────────────────────

fn detect_castling(ctx: &Context, out: &mut Vec<Motif>) {
    if let Move::Castle { king, rook } = ctx.mv {
        let kingside = rook.file() > king.file();
        if kingside {
            push(out, "castles_kingside", "Castles kingside");
        } else {
            push(out, "castles_queenside", "Castles queenside");
        }
        if connects_rooks(ctx.after.board(), ctx.mover) {
            push(out, "connects_rooks", "");
        }
    }
}

fn connects_rooks(board: &Board, color: Color) -> bool {
    let back_rank = match color {
        Color::White => Rank::First,
        Color::Black => Rank::Eighth,
    };
    let rooks: Vec<Square> = (board.rooks() & board.by_color(color))
        .into_iter()
        .filter(|s| s.rank() == back_rank)
        .collect();
    if rooks.len() < 2 {
        return false;
    }
    let (a, b) = (rooks[0], rooks[1]);
    let lo = a.file().min(b.file()) as u8 + 1;
    let hi = a.file().max(b.file()) as u8;
    for f in lo..hi {
        let sq = Square::from_coords(File::new(f as u32), back_rank);
        if board.piece_at(sq).is_some() {
            return false;
        }
    }
    true
}

fn detect_promotion(ctx: &Context, out: &mut Vec<Motif>) {
    if let Some(role) = ctx.mv.promotion() {
        push(
            out,
            "promotion",
            format!("Promotes to {}", role_name(role)),
        );
    }
}

fn detect_en_passant(ctx: &Context, out: &mut Vec<Motif>) {
    if matches!(ctx.mv, Move::EnPassant { .. }) {
        push(out, "en_passant", "Captures en passant");
    }
}

fn detect_capture_or_trade(ctx: &Context, out: &mut Vec<Motif>) {
    let cap = match ctx.captured {
        Some(p) => p,
        None => return,
    };
    if matches!(ctx.mv, Move::EnPassant { .. }) {
        return;
    }
    let cap_name = role_name(cap.role);
    if cap.role == Role::Queen && ctx.moved.role == Role::Queen {
        push(out, "queen_trade", "Trades queens");
    } else if cap.role == ctx.moved.role {
        push(out, "piece_trade", format!("Trades {}s", role_name(ctx.moved.role)));
    } else if ctx.moved.role == Role::Rook && (cap.role == Role::Knight || cap.role == Role::Bishop) {
        push(out, "exchange_sacrifice", format!("Gives the exchange for the {}", cap_name));
    } else {
        push(out, "capture", format!("Captures the {}", cap_name));
    }
}

fn detect_check_class(ctx: &Context, out: &mut Vec<Motif>) {
    if !ctx.after.is_check() {
        return;
    }
    // Discovered check: the moving piece is not the checker.
    let opp_king = match find_king(ctx.after.board(), ctx.opp) {
        Some(k) => k,
        None => return,
    };
    let mover_attackers = ctx.after.board().attacks_to(
        opp_king,
        ctx.mover,
        ctx.after.board().occupied(),
    );
    let from_moved = mover_attackers.contains(ctx.to);
    let other_checker = (mover_attackers & !Bitboard::from_square(ctx.to)).any();
    if !from_moved && other_checker {
        push(out, "discovered_check", "Discovered check");
    } else if from_moved && other_checker {
        // Double check — strongest form.
        push(out, "discovered_check", "Double check");
    } else {
        push(out, "check", "Gives check");
    }
}

// ── Tactics ─────────────────────────────────────────────────────────────

/// Pin: rook/bishop/queen on a ray with TWO opposing pieces, where the
/// piece in front cannot move without exposing the piece behind. Real pins
/// require the rear piece to be **strictly heavier** by our pin-value
/// scale (knight ≡ bishop), so "knight pinned to bishop" never fires.
fn detect_pin(ctx: &Context, out: &mut Vec<Motif>) {
    if !matches!(ctx.moved.role, Role::Bishop | Role::Rook | Role::Queen) {
        return;
    }
    let dirs = ray_dirs(ctx.moved.role);
    let board = ctx.after.board();
    let (f0, r0) = (ctx.to.file() as i32, ctx.to.rank() as i32);
    for &(df, dr) in dirs {
        let mut first: Option<Piece> = None;
        let mut second: Option<Piece> = None;
        for i in 1..8 {
            let f = f0 + df * i;
            let r = r0 + dr * i;
            if !(0..8).contains(&f) || !(0..8).contains(&r) {
                break;
            }
            let sq = Square::from_coords(File::new(f as u32), Rank::new(r as u32));
            let p = match board.piece_at(sq) {
                Some(p) => p,
                None => continue,
            };
            if first.is_none() {
                if p.color == ctx.opp {
                    first = Some(p);
                } else {
                    break;
                }
            } else {
                if p.color == ctx.opp {
                    second = Some(p);
                }
                break;
            }
        }
        if let (Some(f), Some(s)) = (first, second) {
            // Real pin: rear piece strictly heavier by the bucketed scale.
            // King is always strictly heavier than anything else.
            if role_pin_value(s.role) > role_pin_value(f.role) {
                let label = if s.role == Role::King {
                    format!("Pins the {} to the king", role_name(f.role))
                } else {
                    format!("Pins the {} to the {}", role_name(f.role), role_name(s.role))
                };
                push(out, "pin", label);
                return;
            }
        }
    }
}

fn detect_skewer(ctx: &Context, out: &mut Vec<Motif>) {
    if !matches!(ctx.moved.role, Role::Bishop | Role::Rook | Role::Queen) {
        return;
    }
    let dirs = ray_dirs(ctx.moved.role);
    let board = ctx.after.board();
    let (f0, r0) = (ctx.to.file() as i32, ctx.to.rank() as i32);
    for &(df, dr) in dirs {
        let mut first: Option<Piece> = None;
        let mut second: Option<Piece> = None;
        for i in 1..8 {
            let f = f0 + df * i;
            let r = r0 + dr * i;
            if !(0..8).contains(&f) || !(0..8).contains(&r) {
                break;
            }
            let sq = Square::from_coords(File::new(f as u32), Rank::new(r as u32));
            let p = match board.piece_at(sq) {
                Some(p) => p,
                None => continue,
            };
            if first.is_none() {
                if p.color == ctx.opp {
                    first = Some(p);
                } else {
                    break;
                }
            } else {
                if p.color == ctx.opp {
                    second = Some(p);
                }
                break;
            }
        }
        if let (Some(f), Some(s)) = (first, second) {
            // Skewer: front strictly heavier than back. Same bucketed scale.
            if role_pin_value(f.role) > role_pin_value(s.role) {
                push(
                    out,
                    "skewer",
                    format!("Skewers the {}, exposing the {}", role_name(f.role), role_name(s.role)),
                );
                return;
            }
        }
    }
}

/// X-ray: slider attacks an enemy piece *through* another enemy piece
/// (the pierced piece is heavier than the moving slider but lighter than
/// the rear target — i.e. winning material if the front piece moves and
/// recaptures aren't enough). This is closely related to pin/skewer but
/// fires on broader patterns.
fn detect_xray(ctx: &Context, out: &mut Vec<Motif>) {
    if matches!(ctx.moved.role, Role::Bishop | Role::Rook | Role::Queen) {
        // Already covered by pin/skewer if a real one fires; we want
        // x-ray to also describe attacker → enemy → target where the
        // first enemy is a defender of an even-bigger asset. Skip if
        // pin/skewer already fired (caller dedupes, but skipping is faster).
        if out.iter().any(|m| m.id == "pin" || m.id == "skewer") {
            return;
        }
        let dirs = ray_dirs(ctx.moved.role);
        let board = ctx.after.board();
        let (f0, r0) = (ctx.to.file() as i32, ctx.to.rank() as i32);
        for &(df, dr) in dirs {
            let mut first: Option<Piece> = None;
            let mut second: Option<Piece> = None;
            for i in 1..8 {
                let f = f0 + df * i;
                let r = r0 + dr * i;
                if !(0..8).contains(&f) || !(0..8).contains(&r) {
                    break;
                }
                let sq = Square::from_coords(File::new(f as u32), Rank::new(r as u32));
                let p = match board.piece_at(sq) {
                    Some(p) => p,
                    None => continue,
                };
                if first.is_none() {
                    if p.color == ctx.opp {
                        first = Some(p);
                    } else {
                        break;
                    }
                } else {
                    if p.color == ctx.opp {
                        second = Some(p);
                    }
                    break;
                }
            }
            if let (Some(f), Some(s)) = (first, second) {
                // X-ray fires if BOTH targets are valuable and the front
                // piece isn't strictly heavier than the rear (pin/skewer
                // would have caught those cases).
                let fv = role_pin_value(f.role);
                let sv = role_pin_value(s.role);
                if fv >= 5 && sv >= 5 && fv == sv {
                    push(
                        out,
                        "xray",
                        format!("X-ray attack through the {} onto the {}", role_name(f.role), role_name(s.role)),
                    );
                    return;
                }
            }
        }
    }
}

/// Fork: the moving piece attacks ≥2 enemy pieces such that
///   • at least one target is the king, OR
///   • the total threatened material exceeds the moving piece's value
///     AND at least one specific target wins material via SEE.
/// Defended forks (where every target is supported and the forker is
/// itself hanging on a worse SEE) don't fire.
fn detect_fork(ctx: &Context, out: &mut Vec<Motif>) {
    let board = ctx.after.board();
    let attacks = attacks_from(board, ctx.to);
    let enemy = board.by_color(ctx.opp);
    let targets_bb = attacks & enemy;
    let targets: Vec<Square> = targets_bb.into_iter().collect();
    if targets.len() < 2 {
        return;
    }
    let mover_val = role_value(ctx.moved.role);
    let mut significant: Vec<Piece> = Vec::new();
    let mut any_winning = false;
    for sq in &targets {
        let p = board.piece_at(*sq).unwrap();
        let is_king = p.role == Role::King;
        let heavier = role_value(p.role) > mover_val;
        if is_king || heavier {
            significant.push(p);
        }
        // SEE-aware: would actually capturing this win material?
        if let Some(see_val) = see_capture(board, *sq, ctx.mover) {
            if see_val > 0 {
                any_winning = true;
            }
        } else if is_king {
            any_winning = true; // king is always "winning" if exposed
        }
    }
    if significant.len() >= 1 && (any_winning || significant.iter().any(|p| p.role == Role::King)) {
        // Read-out: list up to 2 distinct roles.
        let mut roles: Vec<&str> = Vec::new();
        for p in &significant {
            let n = role_name(p.role);
            if !roles.contains(&n) {
                roles.push(n);
            }
        }
        let phrase = if roles.len() >= 2 {
            format!("Forks {} and {}", roles[0], roles[1])
        } else {
            format!("Forks the {}", roles[0])
        };
        push(out, "fork", phrase);
    }
}

/// Battery: friendly slider partner aligned along the same ray, with a
/// meaningful target (king/queen/rook) somewhere along the *outward* ray
/// from the moving piece.
fn detect_battery(ctx: &Context, out: &mut Vec<Motif>) {
    if !matches!(ctx.moved.role, Role::Bishop | Role::Rook | Role::Queen) {
        return;
    }
    let dirs = ray_dirs(ctx.moved.role);
    let board = ctx.after.board();
    let (f0, r0) = (ctx.to.file() as i32, ctx.to.rank() as i32);
    for &(df, dr) in dirs {
        // Outward target.
        let mut target: Option<Piece> = None;
        for i in 1..8 {
            let f = f0 + df * i;
            let r = r0 + dr * i;
            if !(0..8).contains(&f) || !(0..8).contains(&r) {
                break;
            }
            let sq = Square::from_coords(File::new(f as u32), Rank::new(r as u32));
            if let Some(p) = board.piece_at(sq) {
                if p.color == ctx.mover {
                    break;
                }
                if matches!(p.role, Role::King | Role::Queen | Role::Rook) {
                    target = Some(p);
                }
                break;
            }
        }
        // Backward partner.
        let mut partner: Option<Piece> = None;
        for i in 1..8 {
            let f = f0 - df * i;
            let r = r0 - dr * i;
            if !(0..8).contains(&f) || !(0..8).contains(&r) {
                break;
            }
            let sq = Square::from_coords(File::new(f as u32), Rank::new(r as u32));
            if let Some(p) = board.piece_at(sq) {
                if p.color != ctx.mover {
                    break;
                }
                if matches!(p.role, Role::Bishop | Role::Rook | Role::Queen) {
                    let partner_dirs = ray_dirs(p.role);
                    if partner_dirs.iter().any(|&(dx, dy)| dx == df && dy == dr) {
                        partner = Some(p);
                    }
                }
                break;
            }
        }
        if let (Some(p), Some(t)) = (partner, target) {
            push(
                out,
                "battery",
                format!(
                    "Lines up with the {} aimed at the {}",
                    role_name(p.role),
                    role_name(t.role)
                ),
            );
            return;
        }
    }
}

/// Threats: the move puts an enemy piece in jeopardy that wasn't before.
/// SEE-aware — only counts pieces where the side-to-move's capture is
/// genuinely winning material, OR pieces strictly heavier than the
/// attacker.
fn detect_threats_and_creates(ctx: &Context, out: &mut Vec<Motif>) {
    if out.iter().any(|m| m.id == "fork") {
        return;
    }
    let board = ctx.after.board();
    let attacks = attacks_from(board, ctx.to);
    let enemy = board.by_color(ctx.opp);
    let targets: Vec<Square> = (attacks & enemy).into_iter().collect();
    let mover_val = role_value(ctx.moved.role);

    // First: pieces strictly heavier than the attacker → "threatens".
    for sq in &targets {
        let p = board.piece_at(*sq).unwrap();
        if p.role == Role::King {
            continue; // already check
        }
        if role_value(p.role) > mover_val {
            push(out, "threatens", format!("Threatens the {}", role_name(p.role)));
            return;
        }
    }

    // Otherwise: check if any *other* enemy piece is now hanging that
    // wasn't before. This is "creates a threat".
    let board_b = ctx.before.board();
    for sq in board.by_color(ctx.opp) {
        let p = board.piece_at(sq).unwrap();
        if p.role == Role::King {
            continue;
        }
        let was_hanging = hanging_loss(board_b, sq).is_some();
        let is_hanging = hanging_loss(board, sq).is_some();
        if !was_hanging && is_hanging {
            push(
                out,
                "creates_threat",
                format!("Creates a threat on the {}", role_name(p.role)),
            );
            return;
        }
    }
}

/// Trapped piece: an enemy piece (not pawn/king) where every legal
/// destination either has zero squares or a strictly-negative SEE for
/// the piece to escape. We approximate by enumerating *quiet* and capture
/// destinations from that piece's location; if none is safe (SEE ≥ 0),
/// the piece is trapped.
fn detect_traps_piece(ctx: &Context, out: &mut Vec<Motif>) {
    let board = ctx.after.board();
    let attacks = attacks_from(board, ctx.to);
    let enemy_pieces: Vec<Square> = (attacks & board.by_color(ctx.opp)).into_iter().collect();
    for sq in enemy_pieces {
        let p = board.piece_at(sq).unwrap();
        if matches!(p.role, Role::Pawn | Role::King) {
            continue;
        }
        if is_trapped(ctx.after, sq, p) {
            push(out, "traps_piece", format!("Traps the {}", role_name(p.role)));
            return;
        }
    }
}

fn is_trapped(after: &Chess, sq: Square, piece: Piece) -> bool {
    // Build a position whose side-to-move is the *piece's owner*, so we
    // can ask shakmaty for that piece's legal moves directly. If the
    // position would be illegal (e.g. our king is in check), bail.
    let board_fen = after.board().board_fen(Bitboard::EMPTY).to_string();
    let fen_str = format!(
        "{} {} - - 0 1",
        board_fen,
        if piece.color == Color::White { 'w' } else { 'b' }
    );
    let fen: shakmaty::fen::Fen = match fen_str.parse() {
        Ok(f) => f,
        Err(_) => return false,
    };
    let pos: Chess = match fen.into_position(CastlingMode::Standard) {
        Ok(p) => p,
        Err(_) => return false,
    };

    let moves = pos.legal_moves();
    let piece_moves: Vec<&Move> = moves.iter().filter(|m| m.from() == Some(sq)).collect();
    if piece_moves.is_empty() {
        return false; // 0 moves → likely pinned, not "trapped"
    }
    let board = pos.board();
    for m in &piece_moves {
        let to = m.to();
        let capture_role = board.role_at(to);
        let see_val = see(board, to, sq, piece.role, piece.color, capture_role);
        // Allow escape if SEE is ≥ 0 (not losing material).
        if see_val >= 0 {
            return false;
        }
    }
    true
}

/// Removal of defender: this move captures (or otherwise neutralises)
/// a piece that was the sole defender of *another* enemy piece, leaving
/// the latter hanging.
fn detect_removal_of_defender(ctx: &Context, out: &mut Vec<Motif>) {
    if ctx.captured.is_none() {
        return;
    }
    let board_b = ctx.before.board();
    let board_a = ctx.after.board();
    for sq in board_b.by_color(ctx.opp) {
        if Some(sq) == Some(ctx.to) {
            continue; // the captured square itself
        }
        let was_hanging = hanging_loss(board_b, sq).is_some();
        let is_hanging = hanging_loss(board_a, sq).is_some();
        if !was_hanging && is_hanging {
            let role = board_a.role_at(sq);
            if let Some(r) = role {
                if r == Role::King {
                    continue;
                }
                push(
                    out,
                    "removes_defender",
                    format!("Removes the defender of the {}", role_name(r)),
                );
                return;
            }
        }
    }
}

/// Overloaded piece: an enemy piece defending ≥2 of our targets such that
/// it cannot defend both. Lightweight version: count enemy pieces that
/// defend ≥2 of the squares attacked by us; if any of those squares would
/// be a winning capture (SEE ≥ 0) but for that defender, the defender is
/// overloaded.
fn detect_overloaded(ctx: &Context, out: &mut Vec<Motif>) {
    let board = ctx.after.board();
    // Squares we attack from `ctx.to` that contain an enemy piece.
    let our_attacks = attacks_from(board, ctx.to);
    let our_targets: Vec<Square> = (our_attacks & board.by_color(ctx.opp)).into_iter().collect();
    if our_targets.len() < 2 {
        return;
    }
    // For each enemy non-king piece, count how many of our targets it defends.
    let enemy_pieces: Vec<Square> = board.by_color(ctx.opp).into_iter().collect();
    for esq in &enemy_pieces {
        let ep = board.piece_at(*esq).unwrap();
        if ep.role == Role::King {
            continue;
        }
        let defends = attacks_from(board, *esq);
        let count = our_targets.iter().filter(|s| defends.contains(**s)).count();
        if count >= 2 {
            push(
                out,
                "overloaded",
                format!("Overloads the {}", role_name(ep.role)),
            );
            return;
        }
    }
}

fn detect_sacrifice_or_hangs(ctx: &Context, out: &mut Vec<Motif>) {
    let board = ctx.after.board();
    let loss = hanging_loss(board, ctx.to);
    if let Some(l) = loss {
        let mover_val = role_value(ctx.moved.role);
        let recovered = ctx.captured.map(|p| role_value(p.role)).unwrap_or(0);
        // A *sacrifice* is when we put a heavier piece in jeopardy than we
        // captured AND the SEE loss is meaningful (≥200cp net negative).
        if mover_val - recovered >= 200 && l >= 200 {
            push(out, "sacrifice", format!("Sacrifices the {}", role_name(ctx.moved.role)));
            return;
        }
        // Otherwise it's just a blunder — piece left undefended. Don't fire
        // for pawns (those usually have other context).
        if ctx.moved.role != Role::Pawn {
            push(
                out,
                "hangs",
                format!("The {} is left undefended", role_name(ctx.moved.role)),
            );
        }
    }
}

fn detect_defends_hanging(ctx: &Context, out: &mut Vec<Motif>) {
    let board_b = ctx.before.board();
    let board_a = ctx.after.board();
    for sq in board_b.by_color(ctx.mover) {
        if sq == ctx.from {
            continue;
        }
        let role = match board_b.role_at(sq) {
            Some(r) => r,
            None => continue,
        };
        if role == Role::King {
            continue;
        }
        let was_hanging = hanging_loss(board_b, sq).is_some();
        let is_hanging_after = hanging_loss(board_a, sq).is_some();
        if was_hanging && !is_hanging_after {
            push(out, "defends", format!("Defends the {}", role_name(role)));
            return;
        }
    }
}

// ── King attack ─────────────────────────────────────────────────────────

fn detect_attacks_king(ctx: &Context, out: &mut Vec<Motif>) {
    if out.iter().any(|m| ["fork","pin","skewer","check","discovered_check","traps_piece"].contains(&m.id.as_str())) {
        return;
    }
    if !matches!(ctx.moved.role, Role::Queen | Role::Rook | Role::Bishop | Role::Knight) {
        return;
    }
    let opp_king = match find_king(ctx.after.board(), ctx.opp) {
        Some(k) => k,
        None => return,
    };
    let dist_after = chebyshev(ctx.to, opp_king);
    let dist_before = chebyshev(ctx.from, opp_king);
    if dist_after < dist_before && dist_after <= 3 {
        push(out, "attacks_king", "Increases pressure on the king");
    }
}

fn chebyshev(a: Square, b: Square) -> i32 {
    let df = (a.file() as i32 - b.file() as i32).abs();
    let dr = (a.rank() as i32 - b.rank() as i32).abs();
    df.max(dr)
}

fn detect_eyes_king_zone(ctx: &Context, out: &mut Vec<Motif>) {
    if out.iter().any(|m| ["fork","pin","skewer","check","discovered_check","attacks_king","threatens","attacks_pawn"].contains(&m.id.as_str())) {
        return;
    }
    if !matches!(ctx.moved.role, Role::Bishop | Role::Rook | Role::Queen) {
        return;
    }
    if ctx.after.is_check() {
        return;
    }
    let opp_king = match find_king(ctx.after.board(), ctx.opp) {
        Some(k) => k,
        None => return,
    };
    let zone = king_zone(opp_king);
    let board_b = ctx.before.board();
    let board_a = ctx.after.board();
    let before = attacks_from(board_b, ctx.from);
    let after = attacks_from(board_a, ctx.to);
    let newly = after & zone & !before;
    if !newly.any() {
        return;
    }
    let phrase = match ctx.moved.role {
        Role::Bishop => "Eyes the king's diagonal",
        Role::Rook => "Eyes the king's file",
        _ => "Eyes the king's position",
    };
    push(out, "eyes_king_zone", phrase);
}

fn detect_smothered_mate_hint(ctx: &Context, out: &mut Vec<Motif>) {
    // Knight check where every adjacent square to the enemy king is
    // occupied by enemy pieces. Strong hint of imminent smothered mate.
    if ctx.moved.role != Role::Knight || !ctx.after.is_check() {
        return;
    }
    let opp_king = match find_king(ctx.after.board(), ctx.opp) {
        Some(k) => k,
        None => return,
    };
    let zone = king_attacks(opp_king);
    let occ = ctx.after.board().occupied();
    let enemy = ctx.after.board().by_color(ctx.opp);
    if (zone & !occ).any() {
        return;
    }
    if (zone & enemy).count() >= zone.count() - 1 {
        push(out, "smothered_hint", "Threatens smothered mate");
    }
}

/// Luft: pawn push that is a *response* to an actual back-rank threat.
/// Requires:
///   • mover's king on the back rank
///   • adjacent pawn (within 1 file)
///   • single push from starting rank
///   • enemy R/Q on a file with no friendly pawn blocker
fn detect_luft(ctx: &Context, out: &mut Vec<Motif>) {
    if ctx.moved.role != Role::Pawn {
        return;
    }
    let king_sq = match find_king(ctx.after.board(), ctx.mover) {
        Some(k) => k,
        None => return,
    };
    let expected_back = match ctx.mover {
        Color::White => Rank::First,
        Color::Black => Rank::Eighth,
    };
    if king_sq.rank() != expected_back {
        return;
    }
    if (ctx.from.file() as i32 - king_sq.file() as i32).abs() > 1 {
        return;
    }
    if (ctx.to.rank() as i32 - ctx.from.rank() as i32).abs() != 1 {
        return;
    }
    let expected_pawn_rank = match ctx.mover {
        Color::White => Rank::Second,
        Color::Black => Rank::Seventh,
    };
    if ctx.from.rank() != expected_pawn_rank {
        return;
    }

    // Real back-rank threat?
    let board = ctx.before.board();
    let rooks_queens = (board.rooks() | board.queens()) & board.by_color(ctx.opp);
    for f in 0..8 {
        let mut has_heavy = false;
        let mut my_pawn_on_file = false;
        for r in 0..8 {
            let sq = Square::from_coords(File::new(f), Rank::new(r));
            if let Some(p) = board.piece_at(sq) {
                if rooks_queens.contains(sq) {
                    has_heavy = true;
                }
                if p.role == Role::Pawn && p.color == ctx.mover {
                    my_pawn_on_file = true;
                }
            }
        }
        if has_heavy && !my_pawn_on_file {
            push(out, "luft", "Creates luft for the king");
            return;
        }
    }
}

// ── Positional detectors ────────────────────────────────────────────────

fn detect_outpost(ctx: &Context, out: &mut Vec<Motif>) {
    if !matches!(ctx.moved.role, Role::Knight | Role::Bishop) {
        return;
    }
    let board = ctx.after.board();
    if !is_outpost(board, ctx.to, ctx.moved) {
        return;
    }
    push(out, "outpost", format!("Establishes an outpost on {}", ctx.to));
}

fn is_outpost(board: &Board, sq: Square, piece: Piece) -> bool {
    let rank = sq.rank() as i32;
    if piece.color == Color::White && rank < 4 {
        return false;
    }
    if piece.color == Color::Black && rank > 3 {
        return false;
    }
    // No enemy pawn on adjacent files at higher rank (white) / lower rank (black).
    let enemy = piece.color.other();
    let f = sq.file() as i32;
    for df in [-1, 1] {
        let nf = f + df;
        if !(0..8).contains(&nf) {
            continue;
        }
        for r in 0..8 {
            let s = Square::from_coords(File::new(nf as u32), Rank::new(r));
            if let Some(p) = board.piece_at(s) {
                if p.role == Role::Pawn && p.color == enemy {
                    if piece.color == Color::White && r as i32 >= rank + 1 {
                        return false;
                    }
                    if piece.color == Color::Black && (r as i32) <= rank - 1 {
                        return false;
                    }
                }
            }
        }
    }
    // Pawn support OR rank ≥ 5 (white) / ≤ 4 (black).
    let support_rank = rank + if piece.color == Color::White { -1 } else { 1 };
    if (0..8).contains(&support_rank) {
        for df in [-1, 1] {
            let nf = f + df;
            if !(0..8).contains(&nf) {
                continue;
            }
            let s = Square::from_coords(File::new(nf as u32), Rank::new(support_rank as u32));
            if let Some(p) = board.piece_at(s) {
                if p.role == Role::Pawn && p.color == piece.color {
                    return true;
                }
            }
        }
    }
    if piece.color == Color::White {
        rank >= 4
    } else {
        rank <= 3
    }
}

fn detect_fianchetto(ctx: &Context, out: &mut Vec<Motif>) {
    if ctx.moved.role != Role::Bishop {
        return;
    }
    let valid = match ctx.mover {
        Color::White => ctx.to == Square::B2 || ctx.to == Square::G2,
        Color::Black => ctx.to == Square::B7 || ctx.to == Square::G7,
    };
    if valid {
        push(out, "fianchetto", "Fianchettos the bishop");
    }
}

fn detect_long_diagonal(ctx: &Context, out: &mut Vec<Motif>) {
    if !matches!(ctx.moved.role, Role::Bishop | Role::Queen) {
        return;
    }
    let from_diag = on_long_diag(ctx.from);
    let to_diag = on_long_diag(ctx.to);
    if to_diag.is_some() && from_diag != to_diag {
        push(
            out,
            "long_diagonal",
            format!("Posts on the long {} diagonal", to_diag.unwrap()),
        );
    }
}

fn on_long_diag(sq: Square) -> Option<&'static str> {
    let f = sq.file() as i32;
    let r = sq.rank() as i32;
    if f == r {
        Some("a1-h8")
    } else if f == 7 - r {
        Some("h1-a8")
    } else {
        None
    }
}

fn detect_rook_play(ctx: &Context, out: &mut Vec<Motif>) {
    if ctx.moved.role != Role::Rook {
        return;
    }
    let board = ctx.after.board();
    let f = ctx.to.file();
    let mut our_rooks = 0;
    let mut my_pawns = 0;
    let mut their_pawns = 0;
    for r in 0..8 {
        let sq = Square::from_coords(f, Rank::new(r));
        if let Some(p) = board.piece_at(sq) {
            if p.role == Role::Rook && p.color == ctx.mover {
                our_rooks += 1;
            }
            if p.role == Role::Pawn {
                if p.color == ctx.mover {
                    my_pawns += 1;
                } else {
                    their_pawns += 1;
                }
            }
        }
    }
    if our_rooks >= 2 {
        push(
            out,
            "doubles_rooks",
            format!("Doubles rooks on the {}-file", file_letter(f)),
        );
    } else if my_pawns == 0 && their_pawns == 0 {
        push(
            out,
            "open_file",
            format!("Posts the rook on the open {}-file", file_letter(f)),
        );
    } else if my_pawns == 0 && their_pawns >= 1 {
        push(
            out,
            "semi_open_file",
            format!("Posts on the semi-open {}-file", file_letter(f)),
        );
    }
    let seventh = match ctx.mover {
        Color::White => Rank::Seventh,
        Color::Black => Rank::Second,
    };
    if ctx.to.rank() == seventh {
        push(out, "rook_seventh", "Rook on the seventh");
    }
}

fn detect_bad_bishop(ctx: &Context, out: &mut Vec<Motif>) {
    if ctx.moved.role != Role::Bishop {
        return;
    }
    let board = ctx.after.board();
    let light = square_is_light(ctx.to);
    let mut blockers = 0;
    let pawns = board.pawns() & board.by_color(ctx.mover);
    for s in pawns {
        if square_is_light(s) == light {
            blockers += 1;
        }
    }
    if blockers >= 5 {
        push(out, "bad_bishop", "Bishop is hemmed in by its own pawns");
    }
}

fn detect_bishop_pair_lost(ctx: &Context, out: &mut Vec<Motif>) {
    if ctx.moved.role != Role::Bishop {
        return;
    }
    let board_b = ctx.before.board();
    let board_a = ctx.after.board();
    let before = (board_b.bishops() & board_b.by_color(ctx.mover)).count();
    let after = (board_a.bishops() & board_a.by_color(ctx.mover)).count();
    if before == 2 && after < 2 {
        let opp_bishops = (board_b.bishops() & board_b.by_color(ctx.opp)).count();
        if opp_bishops >= 2 {
            push(out, "bishop_pair_lost", "Gives up the bishop pair");
        }
    }
}

/// Color-complex weakness: side has no bishop of one color AND ≥3 pawns
/// on that color → squares of that color are perpetually weak.
fn detect_color_complex(ctx: &Context, out: &mut Vec<Motif>) {
    let board_a = ctx.after.board();
    let board_b = ctx.before.board();
    for &(color, label_self) in &[(ctx.mover, "self"), (ctx.opp, "them")] {
        let bishops = board_a.bishops() & board_a.by_color(color);
        let mut light = false;
        let mut dark = false;
        for s in bishops {
            if square_is_light(s) { light = true; } else { dark = true; }
        }
        let pawns = board_a.pawns() & board_a.by_color(color);
        let mut light_p = 0;
        let mut dark_p = 0;
        for s in pawns {
            if square_is_light(s) { light_p += 1; } else { dark_p += 1; }
        }
        // Did this just become true?
        let now_light_weak = !light && light_p >= 3;
        let now_dark_weak = !dark && dark_p >= 3;
        let bishops_b = board_b.bishops() & board_b.by_color(color);
        let mut light_b = false;
        let mut dark_b = false;
        for s in bishops_b {
            if square_is_light(s) { light_b = true; } else { dark_b = true; }
        }
        let pawns_b = board_b.pawns() & board_b.by_color(color);
        let mut light_pb = 0;
        let mut dark_pb = 0;
        for s in pawns_b {
            if square_is_light(s) { light_pb += 1; } else { dark_pb += 1; }
        }
        let was_light_weak = !light_b && light_pb >= 3;
        let was_dark_weak = !dark_b && dark_pb >= 3;
        if now_light_weak && !was_light_weak {
            let id = if label_self == "self" {
                "color_complex_self"
            } else {
                "color_complex_them"
            };
            let phrase = if label_self == "self" {
                "Light squares become permanently weak"
            } else {
                "Locks in the opponent's light-square weakness"
            };
            push(out, id, phrase);
            return;
        }
        if now_dark_weak && !was_dark_weak {
            let id = if label_self == "self" {
                "color_complex_self"
            } else {
                "color_complex_them"
            };
            let phrase = if label_self == "self" {
                "Dark squares become permanently weak"
            } else {
                "Locks in the opponent's dark-square weakness"
            };
            push(out, id, phrase);
            return;
        }
    }
}

fn detect_centralizes(ctx: &Context, out: &mut Vec<Motif>) {
    if !matches!(ctx.moved.role, Role::Knight | Role::Bishop | Role::Queen | Role::Rook | Role::Pawn) {
        return;
    }
    let core = |sq: Square| matches!(sq, Square::D4 | Square::D5 | Square::E4 | Square::E5);
    let large = |sq: Square| {
        let f = sq.file() as i32;
        let r = sq.rank() as i32;
        (2..=5).contains(&f) && (2..=5).contains(&r)
    };
    let board_b = ctx.before.board();
    let board_a = ctx.after.board();

    fn central_score(board: &Board, sq: Square, core: impl Fn(Square) -> bool, large: impl Fn(Square) -> bool) -> f32 {
        let attacks = attacks_from(board, sq);
        let mut c = 0.0;
        let mut l = 0.0;
        for s in attacks {
            if core(s) {
                c += 1.0;
            } else if large(s) {
                l += 1.0;
            }
        }
        c + 0.5 * l
    }
    let before = if ctx.moved.role == Role::Pawn {
        if core(ctx.from) { 1.0 } else { 0.0 }
    } else {
        central_score(board_b, ctx.from, &core, &large)
    };
    let after = if ctx.moved.role == Role::Pawn {
        if core(ctx.to) { 1.0 } else { 0.0 }
    } else {
        central_score(board_a, ctx.to, &core, &large)
    };
    if after - before >= 1.5 {
        let phrase = match ctx.moved.role {
            Role::Pawn if core(ctx.to) => "Stakes a claim in the center",
            Role::Knight | Role::Bishop => "Centralizes the piece",
            _ => "Brings the piece into the center",
        };
        push(out, "centralizes", phrase);
    }
}

fn detect_attacks_pawn(ctx: &Context, out: &mut Vec<Motif>) {
    if out.iter().any(|m| ["threatens","fork","capture"].contains(&m.id.as_str())) {
        return;
    }
    if ctx.moved.role == Role::Pawn {
        return;
    }
    let board_a = ctx.after.board();
    let board_b = ctx.before.board();
    let before = attacks_from(board_b, ctx.from);
    let after = attacks_from(board_a, ctx.to);
    for sq in after & !before {
        let p = match board_a.piece_at(sq) {
            Some(p) => p,
            None => continue,
        };
        if p.role != Role::Pawn || p.color != ctx.opp {
            continue;
        }
        let f = sq.file();
        let isolated = is_isolated_pawn(board_a, sq);
        let backward = is_backward_pawn(board_a, sq, ctx.opp);
        let adj = if backward {
            "backward "
        } else if isolated {
            "isolated "
        } else {
            ""
        };
        push(
            out,
            "attacks_pawn",
            format!("Attacks the {}{}-pawn", adj, file_letter(f)),
        );
        return;
    }
}

fn detect_prepares_castling(ctx: &Context, out: &mut Vec<Motif>) {
    if !matches!(ctx.moved.role, Role::Knight | Role::Bishop | Role::Queen) {
        return;
    }
    let back = match ctx.mover {
        Color::White => Rank::First,
        Color::Black => Rank::Eighth,
    };
    if ctx.from.rank() != back {
        return;
    }
    let cr = ctx.after.castles();
    let board = ctx.after.board();
    let rank = back;
    let kingside = match ctx.mover {
        Color::White => cr.has(Color::White, shakmaty::CastlingSide::KingSide),
        Color::Black => cr.has(Color::Black, shakmaty::CastlingSide::KingSide),
    };
    let queenside = match ctx.mover {
        Color::White => cr.has(Color::White, shakmaty::CastlingSide::QueenSide),
        Color::Black => cr.has(Color::Black, shakmaty::CastlingSide::QueenSide),
    };
    let f_clear = board.piece_at(Square::from_coords(File::F, rank)).is_none();
    let g_clear = board.piece_at(Square::from_coords(File::G, rank)).is_none();
    let b_clear = board.piece_at(Square::from_coords(File::B, rank)).is_none();
    let c_clear = board.piece_at(Square::from_coords(File::C, rank)).is_none();
    let d_clear = board.piece_at(Square::from_coords(File::D, rank)).is_none();
    let from_file = ctx.from.file();
    if kingside && f_clear && g_clear && (from_file == File::F || from_file == File::G) {
        push(out, "prepares_castling_kingside", "Clears the way for kingside castle");
    } else if queenside && b_clear && c_clear && d_clear && matches!(from_file, File::B | File::C | File::D) {
        push(out, "prepares_castling_queenside", "Clears the way for queenside castle");
    }
}

fn detect_knight_on_rim(ctx: &Context, out: &mut Vec<Motif>) {
    if ctx.moved.role != Role::Knight || ctx.move_number > 16 {
        return;
    }
    if ctx.to.file() == File::A || ctx.to.file() == File::H {
        push(out, "knight_on_rim", "Knight drifts to the rim");
    }
}

// ── Pawn structure ──────────────────────────────────────────────────────

fn detect_pawn_structure_changes(ctx: &Context, out: &mut Vec<Motif>) {
    let mp_b = pawns_by_file(ctx.before.board(), ctx.mover);
    let mp_a = pawns_by_file(ctx.after.board(), ctx.mover);
    let op_b = pawns_by_file(ctx.before.board(), ctx.opp);
    let op_a = pawns_by_file(ctx.after.board(), ctx.opp);

    // IQP — created for either side?
    if !is_iqp(&mp_b) && is_iqp(&mp_a) {
        push(out, "iqp_self", "Accepts an isolated queen pawn (IQP)");
    } else if !is_iqp(&op_b) && is_iqp(&op_a) {
        push(out, "iqp_them", "Saddles the opponent with an isolated queen pawn");
    }
    // Hanging pawns — created for either side?
    let hps_b = hanging_pair(&mp_b);
    let hps_a = hanging_pair(&mp_a);
    if hps_b.is_none() && hps_a.is_some() {
        push(
            out,
            "hanging_pawns_self",
            format!("Creates hanging {} pawns", hps_a.unwrap()),
        );
    }
    let hpt_b = hanging_pair(&op_b);
    let hpt_a = hanging_pair(&op_a);
    if hpt_b.is_none() && hpt_a.is_some() {
        push(
            out,
            "hanging_pawns_them",
            format!("Saddles the opponent with hanging {} pawns", hpt_a.unwrap()),
        );
    }

    // Doubled pawns imposed on opponent.
    if let Some(cap) = ctx.captured {
        if cap.role == Role::Pawn && ctx.moved.role != Role::Pawn {
            let f = ctx.to.file() as usize;
            if op_a[f] >= 2 && op_b[f] < 2 {
                push(out, "doubled_pawns_them", "Doubles the opponent's pawns");
            }
        }
    }
    // Backward pawn imposed on opponent.
    let board_b = ctx.before.board();
    let board_a = ctx.after.board();
    for f in 0..8 {
        for r in 0..8 {
            let sq = Square::from_coords(File::new(f), Rank::new(r));
            let pa = match board_a.piece_at(sq) { Some(p) => p, None => continue };
            if pa.role != Role::Pawn || pa.color != ctx.opp {
                continue;
            }
            let was = is_backward_pawn(board_b, sq, ctx.opp);
            let is_now = is_backward_pawn(board_a, sq, ctx.opp);
            if !was && is_now {
                push(
                    out,
                    "backward_pawn_them",
                    format!("Saddles the opponent with a backward {}-pawn", file_letter(File::new(f))),
                );
                return;
            }
        }
    }
}

fn detect_pawn_specific(ctx: &Context, out: &mut Vec<Motif>) {
    if ctx.moved.role != Role::Pawn {
        return;
    }
    if ctx.captured.is_some() {
        push(out, "pawn_break", "Pawn break");
    } else {
        // Lever: enemy pawn diagonally adjacent.
        let board = ctx.after.board();
        let f = ctx.to.file() as i32;
        let r = ctx.to.rank() as i32;
        let fwd = match ctx.mover {
            Color::White => 1,
            Color::Black => -1,
        };
        let mut lever = false;
        for df in [-1, 1] {
            let nf = f + df;
            let nr = r + fwd;
            if !(0..8).contains(&nf) || !(0..8).contains(&nr) {
                continue;
            }
            let s = Square::from_coords(File::new(nf as u32), Rank::new(nr as u32));
            if let Some(p) = board.piece_at(s) {
                if p.role == Role::Pawn && p.color == ctx.opp {
                    lever = true;
                    break;
                }
            }
        }
        if lever {
            push(out, "pawn_lever", "Creates a pawn lever");
        }
    }
    if is_passed(ctx.after.board(), ctx.to, ctx.mover) {
        push(out, "passed_pawn", "Creates a passed pawn");
    }
    if is_pawn_storm(ctx.after.board(), ctx.to, ctx.mover, ctx.opp) {
        if !out.iter().any(|m| m.id == "pawn_break") {
            push(out, "pawn_storm", "Joins the pawn storm");
        }
    }
    let mp_a = pawns_by_file(ctx.after.board(), ctx.mover);
    let f = ctx.to.file() as usize;
    if mp_a[f] >= 1 && is_isolated_file(f, &mp_a) {
        push(out, "isolated_pawn", "Isolates the pawn");
    }
}

fn pawns_by_file(board: &Board, color: Color) -> [u8; 8] {
    let mut counts = [0u8; 8];
    let pawns = board.pawns() & board.by_color(color);
    for s in pawns {
        counts[s.file() as usize] += 1;
    }
    counts
}

fn is_isolated_file(file: usize, counts: &[u8; 8]) -> bool {
    let left = if file > 0 { counts[file - 1] } else { 0 };
    let right = if file < 7 { counts[file + 1] } else { 0 };
    left == 0 && right == 0
}

fn is_isolated_pawn(board: &Board, sq: Square) -> bool {
    let p = match board.piece_at(sq) {
        Some(p) if p.role == Role::Pawn => p,
        _ => return false,
    };
    let counts = pawns_by_file(board, p.color);
    is_isolated_file(sq.file() as usize, &counts)
}

fn is_iqp(counts: &[u8; 8]) -> bool {
    counts[3] >= 1 && counts[2] == 0 && counts[4] == 0
}

fn hanging_pair(counts: &[u8; 8]) -> Option<&'static str> {
    if counts[2] >= 1 && counts[3] >= 1 && counts[1] == 0 && counts[4] == 0 {
        return Some("cd");
    }
    if counts[3] >= 1 && counts[4] >= 1 && counts[2] == 0 && counts[5] == 0 {
        return Some("de");
    }
    None
}

fn is_passed(board: &Board, sq: Square, color: Color) -> bool {
    let f = sq.file() as i32;
    let r = sq.rank() as i32;
    let enemy = color.other();
    for df in [-1, 0, 1] {
        let nf = f + df;
        if !(0..8).contains(&nf) {
            continue;
        }
        for nr in 0..8 {
            let s = Square::from_coords(File::new(nf as u32), Rank::new(nr));
            if let Some(p) = board.piece_at(s) {
                if p.role != Role::Pawn || p.color != enemy {
                    continue;
                }
                if color == Color::White && nr as i32 > r {
                    return false;
                }
                if color == Color::Black && (nr as i32) < r {
                    return false;
                }
            }
        }
    }
    true
}

fn is_backward_pawn(board: &Board, sq: Square, color: Color) -> bool {
    let p = match board.piece_at(sq) {
        Some(p) => p,
        None => return false,
    };
    if p.role != Role::Pawn || p.color != color {
        return false;
    }
    let f = sq.file() as i32;
    let r = sq.rank() as i32;
    let fwd = match color {
        Color::White => 1,
        Color::Black => -1,
    };
    // Friendly pawn behind on adjacent files?
    for df in [-1, 1] {
        let nf = f + df;
        if !(0..8).contains(&nf) {
            continue;
        }
        for nr in 0..8 {
            let s = Square::from_coords(File::new(nf as u32), Rank::new(nr));
            if let Some(p2) = board.piece_at(s) {
                if p2.role == Role::Pawn && p2.color == color {
                    if color == Color::White && nr as i32 <= r {
                        return false;
                    }
                    if color == Color::Black && (nr as i32) >= r {
                        return false;
                    }
                }
            }
        }
    }
    let front_r = r + fwd;
    if !(0..8).contains(&front_r) {
        return false;
    }
    let front = Square::from_coords(File::new(f as u32), Rank::new(front_r as u32));
    if let Some(fp) = board.piece_at(front) {
        if fp.color != color {
            return true;
        }
    }
    let enemy = color.other();
    for df in [-1, 1] {
        let nf = f + df;
        let r2 = r + 2 * fwd;
        if !(0..8).contains(&nf) || !(0..8).contains(&r2) {
            continue;
        }
        let s = Square::from_coords(File::new(nf as u32), Rank::new(r2 as u32));
        if let Some(p2) = board.piece_at(s) {
            if p2.role == Role::Pawn && p2.color == enemy {
                return true;
            }
        }
    }
    false
}

fn is_pawn_storm(board: &Board, to: Square, mover: Color, opp: Color) -> bool {
    let opp_king = match find_king(board, opp) {
        Some(k) => k,
        None => return false,
    };
    let okf = opp_king.file() as i32;
    let tf = to.file() as i32;
    let same_wing = (okf <= 3) == (tf <= 3);
    if !same_wing {
        return false;
    }
    let advanced = match mover {
        Color::White => to.rank() as i32 >= 3,
        Color::Black => (to.rank() as i32) <= 4,
    };
    if !advanced {
        return false;
    }
    let mut buddies = 0;
    let pawns = board.pawns() & board.by_color(mover);
    for s in pawns {
        let f = s.file() as i32;
        // Same wing only.
        if (okf <= 3) != (f <= 3) {
            continue;
        }
        let adv = match mover {
            Color::White => s.rank() as i32 >= 3,
            Color::Black => (s.rank() as i32) <= 4,
        };
        if adv {
            buddies += 1;
        }
    }
    buddies >= 2
}

// ── Restriction / development ──────────────────────────────────────────

fn detect_restricts(ctx: &Context, out: &mut Vec<Motif>) {
    if out.iter().any(|m| m.id == "check" || m.id == "discovered_check") {
        return;
    }
    let before = pseudo_legal_count(ctx.before, ctx.opp);
    let after = pseudo_legal_count(ctx.after, ctx.opp);
    if before.saturating_sub(after) >= 4 {
        push(out, "restricts", "Restricts the opponent's pieces");
    }
}

fn pseudo_legal_count(pos: &Chess, color: Color) -> usize {
    // Build a clone where it's `color`'s turn and count legal moves.
    let board_fen = pos.board().board_fen(Bitboard::EMPTY).to_string();
    let fen_str = format!(
        "{} {} - - 0 1",
        board_fen,
        if color == Color::White { 'w' } else { 'b' }
    );
    let fen: Result<shakmaty::fen::Fen, _> = fen_str.parse();
    if let Ok(f) = fen {
        if let Ok(p) = f.into_position::<Chess>(CastlingMode::Standard) {
            return p.legal_moves().len();
        }
    }
    0
}

fn detect_develops(ctx: &Context, out: &mut Vec<Motif>) {
    if ctx.move_number > 12 {
        return;
    }
    if !matches!(ctx.moved.role, Role::Knight | Role::Bishop) {
        return;
    }
    let start_rank = match ctx.mover {
        Color::White => Rank::First,
        Color::Black => Rank::Eighth,
    };
    if ctx.from.rank() == start_rank {
        push(out, "develops", "");
    }
}

// ── Ray tables ──────────────────────────────────────────────────────────

fn ray_dirs(role: Role) -> &'static [(i32, i32)] {
    match role {
        Role::Rook => &[(1, 0), (-1, 0), (0, 1), (0, -1)],
        Role::Bishop => &[(1, 1), (-1, 1), (1, -1), (-1, -1)],
        Role::Queen => &[
            (1, 0), (-1, 0), (0, 1), (0, -1),
            (1, 1), (-1, 1), (1, -1), (-1, -1),
        ],
        _ => &[],
    }
}

// ── Priority table ──────────────────────────────────────────────────────
// Single source of truth. Lower = more important. JS composer just sorts
// by `priority` field — no JS-side priority array needed.

fn priority_of(id: &str) -> u32 {
    match id {
        "checkmate" => 0,
        "sacrifice" => 1,
        "fork" => 2,
        "discovered_check" => 3,
        "pin" => 4,
        "skewer" => 5,
        "xray" => 6,
        "removes_defender" => 7,
        "smothered_hint" => 8,
        "queen_trade" => 10,
        "exchange_sacrifice" => 11,
        "piece_trade" => 12,
        "capture" => 13,
        "en_passant" => 14,
        "promotion" => 15,
        "creates_threat" => 20,
        "threatens" => 21,
        "traps_piece" => 22,
        "overloaded" => 23,
        "check" => 24,
        "castles_kingside" => 30,
        "castles_queenside" => 31,
        "iqp_them" => 40,
        "iqp_self" => 41,
        "hanging_pawns_them" => 42,
        "hanging_pawns_self" => 43,
        "color_complex_them" => 44,
        "color_complex_self" => 45,
        "doubled_pawns_them" => 46,
        "backward_pawn_them" => 47,
        "doubles_rooks" => 50,
        "rook_seventh" => 51,
        "open_file" => 52,
        "semi_open_file" => 53,
        "outpost" => 60,
        "long_diagonal" => 61,
        "fianchetto" => 62,
        "battery" => 63,
        "attacks_pawn" => 70,
        "eyes_king_zone" => 71,
        "attacks_king" => 72,
        "luft" => 73,
        "prepares_castling_kingside" => 80,
        "prepares_castling_queenside" => 81,
        "centralizes" => 82,
        "defends" => 83,
        "restricts" => 84,
        "pawn_break" => 90,
        "pawn_lever" => 91,
        "passed_pawn" => 92,
        "pawn_storm" => 93,
        "isolated_pawn" => 94,
        "knight_on_rim" => 100,
        "bishop_pair_lost" => 101,
        "bad_bishop" => 102,
        "hangs" => 103,
        "stalemate" => 110,
        "insufficient_material" => 113,
        "develops" => 200,
        "connects_rooks" => 201,
        _ => 999,
    }
}
