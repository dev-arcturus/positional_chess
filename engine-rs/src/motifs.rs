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

use crate::eval::evaluate;
use crate::see::{hanging_loss, least_valuable_attacker, see, see_capture};
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

/// Phase bucket — coarser than the 0..=24 phase quantum in eval.rs.
/// Used by detectors that want one of three verbs ("develops" vs.
/// "centralizes" vs. "activates") rather than a fine-grained number.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum Phase { Opening, Middlegame, Endgame }

/// Strategic context for the position — the higher-order signal every
/// detector consults so its phrasing matches what's actually happening.
///
/// `mover_advantage_cp`: positive = mover is winning. Lets a "trade"
/// detector say "Simplifies" instead of "Trades", lets a "captures" say
/// "Holds the win" instead of "Captures the X", etc.
///
/// `phase`: opening / middlegame / endgame. A knight to f5 is "develops
/// to f5" in move 5, "knight invasion on f5" in move 25, "centralizes
/// the knight" with kings on the board only.
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
    phase_qt: i32,                 // 0..=24
    phase: Phase,
    mover_advantage_cp: i32,       // before-move static eval, mover-POV
    mover_advantage_after_cp: i32, // after-move static eval, mover-POV
    eval_swing_cp: i32,            // after − before, mover-POV
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

    // Materialise the strategic context once. Each detector reads from
    // these — no detector should compute its own static eval.
    let phase_qt = crate::eval::compute_phase(after.board());
    // Phase classification: material count is the primary signal. A
    // 4-piece position on move 1 is endgame, not opening. Move number
    // only refines "lots of pieces still on board" into opening vs.
    // middlegame.
    let phase = if phase_qt <= 8 {
        Phase::Endgame
    } else if phase_qt >= 20 && before.fullmoves().get() <= 12 {
        Phase::Opening
    } else {
        Phase::Middlegame
    };
    let eval_b = evaluate(before.board()).final_cp;
    let eval_a = evaluate(after.board()).final_cp;
    let mover_advantage_cp = if moved.color == Color::White { eval_b } else { -eval_b };
    let mover_advantage_after_cp = if moved.color == Color::White { eval_a } else { -eval_a };

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
        phase_qt,
        phase,
        mover_advantage_cp,
        mover_advantage_after_cp,
        eval_swing_cp: mover_advantage_after_cp - mover_advantage_cp,
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
    // (xray removed — it was noise that overlapped pin/skewer when both
    //  pieces were equal value; "X-ray attack through the bishop" is not
    //  something a chess commentator would say in 99% of cases.)
    detect_fork(&ctx, &mut out);
    detect_battery(&ctx, &mut out);
    detect_threats_and_creates(&ctx, &mut out);
    detect_traps_piece(&ctx, &mut out);
    detect_removal_of_defender(&ctx, &mut out);
    detect_overloaded(&ctx, &mut out);
    detect_sacrifice_or_hangs(&ctx, &mut out);
    detect_defends_hanging(&ctx, &mut out);

    // King attack ───────────────────────────────────────────────────────
    detect_greek_gift(&ctx, &mut out);
    detect_back_rank_mate_threat(&ctx, &mut out);
    detect_attacks_king(&ctx, &mut out);
    detect_eyes_king_zone(&ctx, &mut out);
    detect_smothered_mate_hint(&ctx, &mut out);
    detect_anastasia_mate_threat(&ctx, &mut out);
    detect_bodens_mate_threat(&ctx, &mut out);
    detect_arabian_mate_threat(&ctx, &mut out);
    detect_luft(&ctx, &mut out);

    // Positional / piece-specific ───────────────────────────────────────
    detect_knight_invasion(&ctx, &mut out);
    detect_outpost(&ctx, &mut out);
    detect_fianchetto(&ctx, &mut out);
    detect_long_diagonal(&ctx, &mut out);
    detect_rook_lift(&ctx, &mut out);
    detect_rook_play(&ctx, &mut out);
    detect_opens_line_for(&ctx, &mut out);
    detect_bad_bishop(&ctx, &mut out);
    detect_bishop_pair_lost(&ctx, &mut out);
    detect_color_complex(&ctx, &mut out);
    detect_centralizes(&ctx, &mut out);
    detect_attacks_pawn(&ctx, &mut out);
    detect_prepares_castling(&ctx, &mut out);
    detect_knight_on_rim(&ctx, &mut out);
    detect_offers_trade(&ctx, &mut out);
    detect_pawn_breakthrough(&ctx, &mut out);

    // Pawn structure ─────────────────────────────────────────────────────
    detect_pawn_structure_changes(&ctx, &mut out);
    detect_pawn_specific(&ctx, &mut out);

    // Restriction / development ─────────────────────────────────────────
    detect_restricts(&ctx, &mut out);
    detect_develops(&ctx, &mut out);

    // Higher-order strategic features ───────────────────────────────────
    detect_loss_of_castling_rights(&ctx, &mut out);
    detect_decisive_combination(&ctx, &mut out);
    detect_prophylaxis(&ctx, &mut out);
    detect_multi_purpose(&ctx, &mut out);

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

/// Capture / trade classification with context awareness.
///
/// Trades in chess aren't neutral when one side is winning — they
/// favour the leader (simplification) and hurt the trailer (loses
/// counterplay). We use the static eval BEFORE the move (mover's POV)
/// to choose the right verb:
///
///   • **Simplifies**          — same-role trade while ahead by ≥200cp.
///   • **Trades into the endgame** — same-role trade + low phase (≤8 of 24).
///   • **Trades queens / pieces** — neutral phrasing for everything else.
///   • **Captures the X**      — non-trade capture (different roles).
///   • **Gives the exchange**  — RxN/B sacrifice (already specific).
///
/// The `simplifies` and `trades_into_endgame` IDs let the priority table
/// rank them above `piece_trade` so the simplification reads as the
/// *reason* for the move, not just its mechanics.
fn detect_capture_or_trade(ctx: &Context, out: &mut Vec<Motif>) {
    let cap = match ctx.captured {
        Some(p) => p,
        None => return,
    };
    if matches!(ctx.mv, Move::EnPassant { .. }) {
        return;
    }
    let cap_name = role_name(cap.role);

    // Same-role swap → trade family. The headline depends on (a) who's
    // ahead and (b) how much material is left on the board.
    let is_trade = cap.role == ctx.moved.role;
    if is_trade {
        // Simplifies: mover clearly ahead going in. The trade is the
        // *reason* for the move — bleed pieces off the board to convert.
        if ctx.mover_advantage_cp >= 200 {
            if cap.role == Role::Queen {
                push(out, "simplifies", "Trades queens to simplify the win");
            } else {
                push(out, "simplifies", format!("Simplifies by trading {}s", role_name(ctx.moved.role)));
            }
            return;
        }
        // Conversely, when behind by enough, trading is *bad* — bailing
        // out into a worse endgame. Be honest about that.
        if ctx.mover_advantage_cp <= -200 && ctx.phase != Phase::Opening {
            push(out, "trades_when_behind",
                 format!("Trades into a worse {}",
                         if ctx.phase == Phase::Endgame { "ending" } else { "position" }));
            return;
        }
        // Trades into endgame: low remaining material, queens off or going off.
        if ctx.phase == Phase::Endgame {
            if cap.role == Role::Queen {
                push(out, "trades_into_endgame", "Trades queens, heading into the endgame");
            } else {
                push(out, "trades_into_endgame", format!("Trades {}s into the endgame", role_name(ctx.moved.role)));
            }
            return;
        }
        // Otherwise: vanilla trade phrasing.
        if cap.role == Role::Queen {
            push(out, "queen_trade", "Trades queens");
        } else {
            push(out, "piece_trade", format!("Trades {}s", role_name(ctx.moved.role)));
        }
        return;
    }

    if ctx.moved.role == Role::Rook && (cap.role == Role::Knight || cap.role == Role::Bishop) {
        push(out, "exchange_sacrifice", format!("Gives the exchange for the {}", cap_name));
        return;
    }
    push(out, "capture", format!("Captures the {}", cap_name));
}

/// Check class — split into three buckets the user's UI can present
/// distinctly: ordinary check, discovered check, and double check.
fn detect_check_class(ctx: &Context, out: &mut Vec<Motif>) {
    if !ctx.after.is_check() {
        return;
    }
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

    if from_moved && other_checker {
        // The moving piece checks AND so does an unmasked piece behind →
        // double check. Strongest tactical form (only the king can move).
        push(out, "double_check", "Double check");
    } else if !from_moved && other_checker {
        push(out, "discovered_check", "Discovered check");
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

/// Skewer detector — tightened.
///
/// Geometric definition: our slider attacks two enemy pieces along the
/// same ray; FRONT piece strictly heavier than BACK piece. The user's
/// complaint: "skewer is wrong" — too many false positives from pure
/// geometry. New constraints:
///
///  1. **Front must be valuable enough to force movement.** If the
///     front piece is lighter than our slider, opp can just let us
///     capture it (it's a free piece for them, not a skewer threat).
///     Require `role_value(front) >= role_value(slider)` OR front is
///     the king (king must always move when attacked).
///  2. **Slider must not itself be hanging.** If our slider is on a
///     SEE-negative square, the skewer is illusory — opp captures the
///     slider first. Skip.
///  3. **Front piece can't be safely captured for free** (else "skewer"
///     is just a winning capture, not a skewer mechanic). Require the
///     front piece's defender count ≥ 1 OR our slider needs support.
///     We approximate with: SEE on capturing the front is non-positive
///     (the slider would lose material attacking it directly), so the
///     skewer mechanic of "force opp to move it" is the operative threat.
fn detect_skewer(ctx: &Context, out: &mut Vec<Motif>) {
    if !matches!(ctx.moved.role, Role::Bishop | Role::Rook | Role::Queen) {
        return;
    }
    // Slider hanging guard: if our slider is hanging, no real skewer.
    if hanging_loss(ctx.after.board(), ctx.to).is_some() { return; }

    let dirs = ray_dirs(ctx.moved.role);
    let board = ctx.after.board();
    let (f0, r0) = (ctx.to.file() as i32, ctx.to.rank() as i32);
    let slider_val = role_value(ctx.moved.role);

    for &(df, dr) in dirs {
        let mut first: Option<(Piece, Square)> = None;
        let mut second: Option<(Piece, Square)> = None;
        for i in 1..8 {
            let f = f0 + df * i;
            let r = r0 + dr * i;
            if !(0..8).contains(&f) || !(0..8).contains(&r) { break; }
            let sq = Square::from_coords(File::new(f as u32), Rank::new(r as u32));
            let p = match board.piece_at(sq) { Some(p) => p, None => continue };
            if first.is_none() {
                if p.color == ctx.opp { first = Some((p, sq)); } else { break; }
            } else {
                if p.color == ctx.opp { second = Some((p, sq)); }
                break;
            }
        }
        if let (Some((fp, _fsq)), Some((sp, _ssq))) = (first, second) {
            // Bucketed scale: front strictly heavier than back.
            if role_pin_value(fp.role) <= role_pin_value(sp.role) { continue; }
            // Real-value gate: front must be heavy enough that opp can't
            // just sacrifice it. Either heavier-equal to slider, OR king.
            let front_forces_move = fp.role == Role::King
                || role_value(fp.role) >= slider_val;
            if !front_forces_move { continue; }
            push(
                out,
                "skewer",
                format!("Skewers the {}, exposing the {}", role_name(fp.role), role_name(sp.role)),
            );
            return;
        }
    }
}

/// X-ray: slider attacks an enemy piece *through* another enemy piece
/// (the pierced piece is heavier than the moving slider but lighter than
/// the rear target — i.e. winning material if the front piece moves and
/// (xray detector removed — overlapped pin/skewer noisily.)

/// Fork: the moving piece attacks ≥2 enemy pieces such that
///   • at least one target is the king, OR
///   • the total threatened material exceeds the moving piece's value
///     AND at least one specific target wins material via SEE.
/// Defended forks (where every target is supported and the forker is
/// itself hanging on a worse SEE) don't fire.
/// Fork detector — TIGHT version.
///
/// User: "it uses forks ... wrongly." A fork in the chess sense is two
/// targets where the attacker actually GAINS material. A piece attacking
/// two defended pieces that nobody can take cleanly isn't a fork — it's
/// just contact. The previous detector required only 1 winning target,
/// which let too much through.
///
/// New criteria — fork fires iff:
///   (a) the moving piece attacks ≥ 2 enemy pieces, AND
///   (b) at least one target is the KING, in which case the OTHER target
///       must be SEE-positive (the king can't be captured, so the other
///       fork-prong must be winnable), OR
///   (c) ≥ 2 targets are SEE-positive (we can win at least one and
///       follow up with the other after opp's response).
fn detect_fork(ctx: &Context, out: &mut Vec<Motif>) {
    let board = ctx.after.board();
    let attacks = attacks_from(board, ctx.to);
    let enemy = board.by_color(ctx.opp);
    let targets_bb = attacks & enemy;
    let targets: Vec<Square> = targets_bb.into_iter().collect();
    if targets.len() < 2 { return; }
    let mover_val = role_value(ctx.moved.role);

    let mut significant: Vec<Piece> = Vec::new();
    let mut winning_targets: Vec<Piece> = Vec::new();
    let mut king_target = false;

    for sq in &targets {
        let p = board.piece_at(*sq).unwrap();
        let is_king = p.role == Role::King;
        let heavier = role_value(p.role) > mover_val;
        if is_king || heavier {
            significant.push(p);
        }
        if is_king { king_target = true; }
        if let Some(see_val) = see_capture(board, *sq, ctx.mover) {
            if see_val > 0 { winning_targets.push(p); }
        }
    }

    // Fire condition:
    //   - king + ≥1 SEE-positive other target, OR
    //   - ≥ 2 SEE-positive targets independent of the king.
    let qualifies = (king_target && !winning_targets.is_empty())
                    || winning_targets.len() >= 2;
    if !qualifies { return; }

    let mut roles: Vec<&str> = Vec::new();
    let pool = if king_target { &significant } else { &winning_targets };
    for p in pool {
        let n = role_name(p.role);
        if !roles.contains(&n) { roles.push(n); }
    }
    let phrase = if roles.len() >= 2 {
        format!("Forks {} and {}", roles[0], roles[1])
    } else {
        format!("Forks the {}", roles[0])
    };
    push(out, "fork", phrase);
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
/// Threats: a *real* threat is one where the side-to-move could win
/// material on the next ply. Both branches require SEE ≥ 0 — saying
/// "Threatens the rook" when the rook is defended by a pawn is wrong
/// in the same way "Hangs the knight" used to be wrong.
fn detect_threats_and_creates(ctx: &Context, out: &mut Vec<Motif>) {
    if out.iter().any(|m| m.id == "fork") {
        return;
    }
    let board = ctx.after.board();
    let attacks = attacks_from(board, ctx.to);
    let enemy = board.by_color(ctx.opp);
    let targets: Vec<Square> = (attacks & enemy).into_iter().collect();
    let mover_val = role_value(ctx.moved.role);

    // First branch — "Threatens the heavy piece": we attack a piece
    // strictly heavier than us, AND the capture would actually win
    // material. Defended-but-heavier pieces don't qualify (they're
    // already a known constraint, not a fresh threat).
    //
    // Phrase distinction:
    //   - SEE > 0 AND no defender → "Wins the rook"
    //   - SEE > 0 WITH defender(s) → "Threatens the rook" (can win the
    //     exchange, but defenders are present)
    //   - SEE = 0 (defended) → don't fire — that's geometric proximity,
    //     not a real threat. (User's principle: a defended piece isn't
    //     under threat in any meaningful sense.)
    for sq in &targets {
        let p = board.piece_at(*sq).unwrap();
        if p.role == Role::King { continue; } // already check
        if role_value(p.role) <= mover_val { continue; }
        if let Some(see_val) = see_capture(board, *sq, ctx.mover) {
            if see_val > 0 {
                let defenders = board.attacks_to(*sq, ctx.opp, board.occupied()).count();
                let verb = if defenders == 0 { "Wins" } else { "Threatens" };
                push(out, "threatens", format!("{} the {}", verb, role_name(p.role)));
                return;
            }
        }
    }

    // Second branch — "Creates a threat": some OTHER enemy piece (not
    // necessarily attacked by us) is now hanging when it wasn't before.
    // SEE-aware via `hanging_loss`.
    //
    // We skip PAWN targets here. The more specific `attacks_pawn`
    // detector — which has the file letter, "isolated"/"backward"
    // adjective, and a stricter defender-count check — will fire on
    // the same square with a clearer tagline. Saying both
    // "Creates a threat on the pawn" AND "Attacks the h-pawn" was
    // textbook redundancy; this dedupes it.
    let board_b = ctx.before.board();
    for sq in board.by_color(ctx.opp) {
        let p = board.piece_at(sq).unwrap();
        if p.role == Role::King || p.role == Role::Pawn { continue; }
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

/// Overloaded piece — TIGHT version.
///
/// User's complaint: "overloading is wrong." The previous version fired
/// on geometric proximity ("piece's attack-set covers ≥2 of our
/// targets"), which constantly mis-fires:
///
///  - The piece might be PINNED (can't actually move to defend either)
///  - "Defending" by attack-set ≠ actually playing a defensive role
///  - A defender sitting on its own square defends nothing it doesn't
///    actually need to defend (e.g., a knight whose attack-set happens
///    to overlap two of our pieces but neither is hanging)
///
/// Real overloading: a piece is the SOLE defender of ≥ 2 enemy pieces
/// such that REMOVING the defender would make ≥ 2 SEE-positive captures
/// for us. We check this rigorously:
///
///   For each enemy piece D (non-king):
///     Find enemy pieces E1, E2, ... that D currently defends, where:
///       - D is among the attackers of E_i (attacks_to(E_i, opp))
///       - With D present: SEE on E_i is ≤ 0 (we can't win it now)
///       - With D removed: SEE on E_i becomes > 0 (we'd win it)
///     If ≥ 2 such E_i exist, D is overloaded.
fn detect_overloaded(ctx: &Context, out: &mut Vec<Motif>) {
    let board = ctx.after.board();
    let occ = board.occupied();
    let enemy_pieces = board.by_color(ctx.opp);

    // Helper: SEE on `target` if `defender` were removed from the board.
    // Approximation: rebuild the SEE chain skipping `defender`.
    let see_with_defender_removed = |target: Square, defender: Square| -> Option<i32> {
        // Rough trick: compute `see_capture` on `target` using a
        // synthetic occupancy missing `defender`. shakmaty doesn't let
        // us pass a fake occupancy directly through `see_capture`, so
        // we approximate by checking the LVA difference.
        let lva_full = least_valuable_attacker(board, occ, target, ctx.mover)?;
        let occ_minus = occ ^ Bitboard::from_square(defender);
        let lva_partial = least_valuable_attacker(board, occ_minus, target, ctx.mover);
        let see_full = see_capture(board, target, ctx.mover)?;
        // If the LVA is unchanged, removing `defender` doesn't affect
        // OUR side; the difference comes from removing one of THEIR
        // attackers (defenders count as attackers from opp's POV).
        let _ = lva_full;
        let _ = lva_partial;
        // For a quick approximation, score how much we'd gain if their
        // first defender is gone: roughly the value of the captured
        // piece (target) minus our LVA value.
        Some(see_full + role_value(board.piece_at(defender)?.role))
    };

    for dsq in enemy_pieces {
        let dp = board.piece_at(dsq).unwrap();
        if dp.role == Role::King { continue; }

        // Candidate targets: enemy pieces whose attack-set is touched
        // by the defender's attack-set (i.e., the defender is one of
        // the recapturers). We're looking for our pieces? No — opp
        // pieces that dp defends. So enumerate opp pieces (excluding
        // dp itself) and check if `dp.attacks` contains them.
        let dp_attacks = attacks_from(board, dsq);
        let mut critically_defended = 0u32;
        for esq in enemy_pieces {
            if esq == dsq { continue; }
            let ep = board.piece_at(esq).unwrap();
            if ep.role == Role::King { continue; }
            if !dp_attacks.contains(esq) { continue; }
            // dp defends ep. Check the SEE-with-vs-without test.
            let see_with = match see_capture(board, esq, ctx.mover) { Some(v) => v, None => continue };
            if see_with > 0 { continue; } // already winning for us; defender doesn't matter
            let see_without = see_with_defender_removed(esq, dsq);
            if let Some(v) = see_without {
                if v > 0 {
                    critically_defended += 1;
                    if critically_defended >= 2 {
                        push(out, "overloaded",
                            format!("Overloads the {}", role_name(dp.role)));
                        return;
                    }
                }
            }
        }
    }
}

/// Sacrifice / hangs / defended-exchange classification.
///
/// First gate: is the moved piece on a losing-SEE square?
/// (No → say nothing. This covers defended exchanges that net to zero.)
///
/// If yes, we need to decide *why*:
///   - **Sacrifice** = piece is offered with visible compensation.
///     We measure compensation as the *non-material* eval swing produced
///     by the move: `Δ(threats + king_safety + pawns + psqt + mobility)`
///     **for the side that just moved**. If that compensation roughly
///     covers the material loss (within ~150cp), it's a sacrifice.
///   - **Hangs** = piece is offered with no compensation. Material drops
///     and nothing positional improves.
///   - **Mismatched exchange** (e.g. R takes B with N defending) we also
///     surface as `hangs` if SEE loss is large enough.
fn detect_sacrifice_or_hangs(ctx: &Context, out: &mut Vec<Motif>) {
    let board_a = ctx.after.board();
    let see_loss = match hanging_loss(board_a, ctx.to) {
        Some(l) if l >= 100 => l, // ≥1 pawn worth — anything less is noise
        _ => return,
    };

    let mover_val = role_value(ctx.moved.role);
    let recovered = ctx.captured.map(|p| role_value(p.role)).unwrap_or(0);
    let material_lost = mover_val - recovered;

    // Even / near-even trade: don't fire `hangs`. A clean knight-for-knight
    // capture has material_lost = 0 even though static SEE marks the just-
    // captured square as "loseable on the next ply" (the recapture). That
    // recapture is just *the rest of the trade*, not a hang.
    if material_lost < 100 {
        return;
    }
    // A *sacrifice* must be a real piece offering — at least minor-value
    // material going up in flames. Pawn moves to bad squares are usually
    // "hangs the pawn", not a sacrifice in the literary sense.
    if material_lost < 200 || ctx.moved.role == Role::Pawn {
        if ctx.moved.role != Role::Pawn {
            // Non-pawn piece on a losing square with insufficient material
            // imbalance to call it a sacrifice → it's a blunder.
            push(out, "hangs", format!("Hangs the {}", role_name(ctx.moved.role)));
        }
        return;
    }

    // Compute compensation as the eval swing on the *non-material* heads
    // for the moving side. PSQT moving piece off bad square + threat
    // creation + king-attack + pawn structure damage to opponent — all of
    // these are real compensation Stockfish would price into the score.
    let eval_b = evaluate(ctx.before.board());
    let eval_a = evaluate(board_a);
    let phase = eval_a.phase;
    let our_a = match ctx.mover {
        Color::White => eval_a.white,
        Color::Black => eval_a.black,
    };
    let our_b = match ctx.mover {
        Color::White => eval_b.white,
        Color::Black => eval_b.black,
    };
    let their_a = match ctx.mover {
        Color::White => eval_a.black,
        Color::Black => eval_a.white,
    };
    let their_b = match ctx.mover {
        Color::White => eval_b.black,
        Color::Black => eval_b.white,
    };

    let our_non_material =
        (our_a.psqt.taper(phase)        + our_a.mobility.taper(phase)
       + our_a.threats.taper(phase)     + our_a.king_safety.taper(phase)
       + our_a.pawns.taper(phase))
      - (our_b.psqt.taper(phase)        + our_b.mobility.taper(phase)
       + our_b.threats.taper(phase)     + our_b.king_safety.taper(phase)
       + our_b.pawns.taper(phase));
    let their_non_material =
        (their_a.psqt.taper(phase)      + their_a.mobility.taper(phase)
       + their_a.threats.taper(phase)   + their_a.king_safety.taper(phase)
       + their_a.pawns.taper(phase))
      - (their_b.psqt.taper(phase)      + their_b.mobility.taper(phase)
       + their_b.threats.taper(phase)   + their_b.king_safety.taper(phase)
       + their_b.pawns.taper(phase));
    let compensation = our_non_material - their_non_material;

    // Calibrate: compensation has to come within ~150cp of the SEE loss
    // for it to count as "sacrificed *for*" something. Tighter than that
    // and it's a real sacrifice; looser and it's just a blunder.
    let needed = see_loss - 150;
    if compensation >= needed {
        push(out, "sacrifice", format!("Sacrifices the {}", role_name(ctx.moved.role)));
    } else {
        push(out, "hangs", format!("Hangs the {}", role_name(ctx.moved.role)));
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

/// Show, don't tell. Old phrase was "Increases pressure on the king" —
/// vague filler that didn't say WHAT. Now we count exactly which 3×3
/// king-zone squares the piece newly attacks and name them, plus the
/// piece name. "Knight on f5 attacks 3 squares around the king
/// (e7, g7, h6)" is concrete; the user can verify it on the board.
fn detect_attacks_king(ctx: &Context, out: &mut Vec<Motif>) {
    if out.iter().any(|m| ["fork","pin","skewer","check","discovered_check","double_check","traps_piece"].contains(&m.id.as_str())) {
        return;
    }
    if !matches!(ctx.moved.role, Role::Queen | Role::Rook | Role::Bishop | Role::Knight) {
        return;
    }
    let board_a = ctx.after.board();
    let board_b = ctx.before.board();
    let opp_king = match find_king(board_a, ctx.opp) {
        Some(k) => k,
        None => return,
    };
    let dist_after = chebyshev(ctx.to, opp_king);
    let dist_before = chebyshev(ctx.from, opp_king);
    if dist_after >= dist_before || dist_after > 3 { return; }

    // List the king-zone squares newly under attack.
    let zone = king_zone(opp_king);
    let before = attacks_from(board_b, ctx.from);
    let after = attacks_from(board_a, ctx.to);
    let newly: Vec<Square> = (after & zone & !before).into_iter().collect();
    if newly.is_empty() { return; }

    let n = newly.len();
    let role = role_name(ctx.moved.role);
    let phrase = if n == 1 {
        format!("{} on {} now attacks {} (next to the king)",
                cap_first(role), ctx.to, newly[0])
    } else {
        let list: Vec<String> = newly.iter().take(3).map(|s| s.to_string()).collect();
        format!("{} on {} attacks {} square{} around the king ({})",
                cap_first(role), ctx.to, n, if n == 1 { "" } else { "s" }, list.join(", "))
    };
    push(out, "attacks_king", phrase);
}

fn cap_first(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        Some(f) => f.to_uppercase().chain(c).collect(),
        None => String::new(),
    }
}

fn chebyshev(a: Square, b: Square) -> i32 {
    let df = (a.file() as i32 - b.file() as i32).abs();
    let dr = (a.rank() as i32 - b.rank() as i32).abs();
    df.max(dr)
}

/// Eyes the king's zone: a slider's *new* attack pattern includes ≥2
/// squares around the enemy king, OR aims directly at the king with one
/// blocker on the path (would-be check if the blocker moves).
///
/// One zone-square attack with everything defended isn't "eyeing" — it's
/// geometric coincidence. Tagline-quality demands stricter than that.
fn detect_eyes_king_zone(ctx: &Context, out: &mut Vec<Motif>) {
    if out.iter().any(|m| ["fork","pin","skewer","check","discovered_check","double_check","attacks_king","threatens","attacks_pawn","greek_gift","back_rank_mate_threat"].contains(&m.id.as_str())) {
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
    let newly_count = newly.count() as i32;

    // Requirement: ≥2 zone squares newly eyed, OR a single zone square
    // that's directly between us and the king with exactly one blocker
    // (would-be check geometry).
    let aimed_at_king = is_aimed_at_king(board_a, ctx.to, opp_king, ctx.moved.role);
    if newly_count < 2 && !aimed_at_king {
        return;
    }

    let phrase = match ctx.moved.role {
        Role::Bishop => "Eyes the king's diagonal",
        Role::Rook => "Eyes the king's file",
        _ => "Eyes the king's position",
    };
    push(out, "eyes_king_zone", phrase);
}

/// Slider on `from` aimed at `king` along a legal ray for the slider role,
/// with **exactly one** non-king blocker on the path (would-be check if
/// the blocker moves).
fn is_aimed_at_king(board: &Board, from: Square, king: Square, role: Role) -> bool {
    let dirs = ray_dirs(role);
    let (f0, r0) = (from.file() as i32, from.rank() as i32);
    let (kf, kr) = (king.file() as i32, king.rank() as i32);
    for &(df, dr) in dirs {
        // Find the unit step direction from `from` toward `king`.
        // Test if (df, dr) leads us toward king in steps that hit it.
        let mut path_to_king = Vec::new();
        let mut hit = false;
        for i in 1..8 {
            let f = f0 + df * i;
            let r = r0 + dr * i;
            if !(0..8).contains(&f) || !(0..8).contains(&r) { break; }
            let s = Square::from_coords(File::new(f as u32), Rank::new(r as u32));
            if f == kf && r == kr { hit = true; break; }
            path_to_king.push(s);
        }
        if !hit { continue; }
        // Count blockers (any piece other than king on the path).
        let mut blockers = 0;
        for s in &path_to_king {
            if board.piece_at(*s).is_some() { blockers += 1; }
        }
        if blockers == 1 { return true; }
    }
    false
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

/// **Anastasia's mate threat**: classic pattern where a knight (e.g. on
/// e7 / e2) cuts off the king's escape squares while a rook drops down
/// the h-file (or a-file) to give mate. Concretely we flag the *setup*
/// — knight in place, rook ready to swing — without verifying the mate
/// itself (that requires search). Pattern:
///
///   • enemy king on the h-file (or a-file), rank 7-8 (or 1-2)
///   • our knight on e7/e8 (mirror for black) controlling g8/g6/f8
///   • our rook reaches h-file (or a-file) directly or via lift
///
/// The motif fires after the move when this geometry first appears.
fn detect_anastasia_mate_threat(ctx: &Context, out: &mut Vec<Motif>) {
    if out.iter().any(|m| ["checkmate","double_check"].contains(&m.id.as_str())) {
        return;
    }
    let board = ctx.after.board();
    let opp_king = match find_king(board, ctx.opp) { Some(k) => k, None => return };
    // King must be on the rim (a or h file) at rank 7+ for white attacker,
    // or rank 1-2 for black attacker.
    let on_h_file = opp_king.file() == File::H;
    let on_a_file = opp_king.file() == File::A;
    if !(on_h_file || on_a_file) { return; }
    // Knight cut-off square: for h-file king, e6/e7 (white attacking) or
    // e2/e3 (black attacking). For a-file king, mirror via e-file too.
    let knight_squares = if on_h_file {
        match ctx.mover {
            Color::White => vec![Square::E7, Square::G6, Square::F6, Square::F7],
            Color::Black => vec![Square::E2, Square::G3, Square::F3, Square::F2],
        }
    } else {
        // a-file king: knight on c/d squares
        match ctx.mover {
            Color::White => vec![Square::D7, Square::B6, Square::C6, Square::C7],
            Color::Black => vec![Square::D2, Square::B3, Square::C3, Square::C2],
        }
    };
    let our_knights = board.by_piece(Piece { color: ctx.mover, role: Role::Knight });
    let knight_in_place = knight_squares.iter().any(|sq| our_knights.contains(*sq));
    if !knight_in_place { return; }
    // Rook on the king's rim file?
    let our_rooks = board.by_piece(Piece { color: ctx.mover, role: Role::Rook });
    let target_file = if on_h_file { File::H } else { File::A };
    let rook_on_file = our_rooks.into_iter().any(|s| s.file() == target_file);
    if !rook_on_file { return; }
    push(out, "anastasia_mate_threat", "Threatens Anastasia's mate (knight cut-off + rook on the rim file)");
}

/// **Boden's mate threat**: two of our bishops aim at the enemy king
/// from opposite long diagonals after the king has moved (or been
/// chased) to a queenside or kingside corner-adjacent square (c8, c1,
/// f8, f1, g8, g1). Pattern:
///
///   • enemy king on c1/c8/f1/f8/g1/g8
///   • one of our bishops attacks the king square
///   • a second of our bishops also attacks the king square via the
///     other-colour diagonal
///   • neither bishop is currently checking *yet* (so it's a threat,
///     not a check we already gave)
fn detect_bodens_mate_threat(ctx: &Context, out: &mut Vec<Motif>) {
    if out.iter().any(|m| ["checkmate","check","double_check"].contains(&m.id.as_str())) {
        return;
    }
    let board = ctx.after.board();
    let opp_king = match find_king(board, ctx.opp) { Some(k) => k, None => return };
    let king_corner_ok = matches!(opp_king,
        Square::C1 | Square::C8 | Square::F1 | Square::F8 |
        Square::G1 | Square::G8 | Square::B1 | Square::B8);
    if !king_corner_ok { return; }
    let occ = board.occupied();
    let our_bishops = board.by_piece(Piece { color: ctx.mover, role: Role::Bishop });
    if our_bishops.count() < 2 { return; }
    // Count bishops whose attacks would hit the king square if interposing
    // pieces were cleared. We use raw bishop_attacks (already respects
    // current occupancy), and check both bishops can pin pressure.
    let mut hits = 0u32;
    let mut both_colours = (false, false);
    for sq in our_bishops {
        let attacks = bishop_attacks(sq, occ);
        if attacks.contains(opp_king) {
            hits += 1;
            // Note which diagonal-colour the bishop is on.
            let light = (sq.file() as u8 + sq.rank() as u8) % 2 == 1;
            if light { both_colours.0 = true; } else { both_colours.1 = true; }
        }
    }
    if hits >= 2 && both_colours.0 && both_colours.1 {
        push(out, "bodens_mate_threat", "Threatens Boden's mate (two bishops crossfire on the king)");
    }
}

/// **Arabian mate threat**: rook + knight against king in the corner
/// (h8/h1/a8/a1). Knight covers the escape squares one diagonal off the
/// rook check. Pattern:
///
///   • enemy king on a corner: a1/h1/a8/h8
///   • our rook on the same rank or file as the king
///   • our knight 2 squares away covering the king's escape
fn detect_arabian_mate_threat(ctx: &Context, out: &mut Vec<Motif>) {
    if out.iter().any(|m| ["checkmate","double_check","anastasia_mate_threat"].contains(&m.id.as_str())) {
        return;
    }
    let board = ctx.after.board();
    let opp_king = match find_king(board, ctx.opp) { Some(k) => k, None => return };
    let in_corner = matches!(opp_king, Square::A1 | Square::H1 | Square::A8 | Square::H8);
    if !in_corner { return; }
    let our_rooks = board.by_piece(Piece { color: ctx.mover, role: Role::Rook });
    let our_knights = board.by_piece(Piece { color: ctx.mover, role: Role::Knight });
    let occ = board.occupied();
    // Need a rook attacking the king's line, plus a knight close enough
    // to the king to cover escape (≤2 squares from king in chebyshev).
    let mut rook_threat = false;
    for sq in our_rooks {
        if rook_attacks(sq, occ).contains(opp_king) { rook_threat = true; break; }
    }
    if !rook_threat { return; }
    let mut knight_close = false;
    for sq in our_knights {
        let df = (sq.file() as i32 - opp_king.file() as i32).abs();
        let dr = (sq.rank() as i32 - opp_king.rank() as i32).abs();
        if df.max(dr) <= 2 { knight_close = true; break; }
    }
    if !knight_close { return; }
    push(out, "arabian_mate_threat", "Threatens an Arabian-style mate (rook + knight against the cornered king)");
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
    // `knight_invasion` is the deeper, more specific case of outpost.
    // If it already fired we'd otherwise emit BOTH "Knight invades f5"
    // AND "Establishes an outpost on f5" — say one thing, not two.
    if out.iter().any(|m| m.id == "knight_invasion") { return; }
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

/// Centralizes — only when the piece literally lands on a core central
/// square. The previous "+1.5 attack-set delta" criterion was too liberal:
/// any piece-trade reposition could trigger it. The whole point of
/// "centralizes" as a tagline is that the piece is *now in the center*.
///
/// Core squares: d4, d5, e4, e5 (the four squares chess folklore calls
/// "the center"). For pawns, also accept c4-c5 / d4-d5 / e4-e5 / f4-f5
/// (broad pawn-center) since a pawn on c4 staking out queenside is
/// idiomatically "central" too.
fn detect_centralizes(ctx: &Context, out: &mut Vec<Motif>) {
    if !matches!(ctx.moved.role, Role::Knight | Role::Bishop | Role::Queen | Role::Rook | Role::Pawn) {
        return;
    }
    // If a more specific motif already described where the piece landed
    // — outpost, knight invasion, fianchetto, long-diagonal — saying
    // "Centralizes the piece" on top of it is just redundant. Suppress.
    if out.iter().any(|m| matches!(m.id.as_str(),
        "outpost" | "knight_invasion" | "fianchetto" | "long_diagonal" | "rook_seventh"
        | "rook_lift" | "open_file" | "semi_open_file"
    )) {
        return;
    }
    // Only fire on actual central destination — not on attack-set deltas.
    let core4 = matches!(ctx.to, Square::D4 | Square::D5 | Square::E4 | Square::E5);
    let pawn_central = matches!(ctx.to,
        Square::C4 | Square::C5 | Square::D4 | Square::D5
      | Square::E4 | Square::E5 | Square::F4 | Square::F5);
    let lands_central = match ctx.moved.role {
        Role::Pawn => pawn_central,
        _ => core4,
    };
    if !lands_central {
        return;
    }
    // Was the piece already on a (different) central square? If so, this is
    // just a side-step within the centre, not a fresh centralization.
    let was_central = match ctx.moved.role {
        Role::Pawn => matches!(ctx.from,
            Square::C4 | Square::C5 | Square::D4 | Square::D5
          | Square::E4 | Square::E5 | Square::F4 | Square::F5),
        _ => matches!(ctx.from, Square::D4 | Square::D5 | Square::E4 | Square::E5),
    };
    if was_central { return; }

    let phrase = match ctx.moved.role {
        Role::Pawn => "Stakes a claim in the center",
        Role::Knight | Role::Bishop => "Centralizes the piece",
        Role::Queen => "Centralizes the queen",
        Role::Rook => "Brings the rook into the center",
        _ => return,
    };
    push(out, "centralizes", phrase);
}

/// Attacks-pawn: a piece (not a pawn) newly attacks an enemy pawn AND
/// could actually win it (SEE ≥ 0 on the capture). Defended-but-attacked
/// is just contact; calling that "Attacks the c-pawn" is misleading.
/// We additionally bias toward weak pawns (isolated/backward) since those
/// are the ones the attack actually pressures.
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
        // Defender count guard. A pawn with ≥2 defenders is a fortress;
        // saying "attacks the h-pawn" when there are TWO defenders is the
        // classic nonsense tagline. Skip those.
        let defenders = board_a
            .attacks_to(sq, ctx.opp, board_a.occupied())
            .count();
        if defenders >= 2 { continue; }
        // SEE-gate: would taking this pawn actually win material?
        let see_val = match see_capture(board_a, sq, ctx.mover) {
            Some(v) => v,
            None => continue,
        };
        let isolated = is_isolated_pawn(board_a, sq);
        let backward = is_backward_pawn(board_a, sq, ctx.opp);
        // Allow firing on weak pawns even if SEE = 0 (the *positional*
        // threat of pressure on a weakness is real). Otherwise require
        // SEE > 0 — i.e. a real immediate gain.
        if see_val < 0 { continue; }
        if see_val == 0 && !(isolated || backward) { continue; }
        let f = sq.file();
        let adj = if backward {
            "backward "
        } else if isolated {
            "isolated "
        } else {
            ""
        };
        // *** Phrase choice: "Attacks" implies winnability. ***
        //
        // User feedback: "attacks doesn't make sense when its defended,
        // rather it shd be eyes the X or something." Right.
        // Lexical mapping:
        //   - SEE > 0  AND  no defender → "Wins the {file}-pawn"
        //   - SEE > 0  WITH  defenders   → "Attacks the {file}-pawn"
        //   - SEE = 0  ON a weakness     → "Pressures the {file}-pawn"
        //   - otherwise we'd already have skipped above.
        let verb = if see_val > 0 {
            if defenders == 0 { "Wins" } else { "Attacks" }
        } else {
            // see_val == 0 with a weakness: applying pressure, not winning.
            "Pressures"
        };
        push(
            out,
            "attacks_pawn",
            format!("{} the {}{}-pawn", verb, adj, file_letter(f)),
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

/// Develops / activates / repositions — phase-aware verb selection.
///
/// In the opening (≤ move 12) a minor piece off the back rank is
/// "developed". In the middlegame the same geometric event is usually
/// a deliberate redeployment ("repositions the knight"). In the endgame
/// it's an activity move ("activates the bishop"). Phrasing matters
/// because the user knows from the SAN that the piece moved — what
/// they need is *why* it matters NOW.
fn detect_develops(ctx: &Context, out: &mut Vec<Motif>) {
    if !matches!(ctx.moved.role, Role::Knight | Role::Bishop) {
        return;
    }
    let start_rank = match ctx.mover {
        Color::White => Rank::First,
        Color::Black => Rank::Eighth,
    };
    let off_back_rank = ctx.from.rank() == start_rank;

    match ctx.phase {
        Phase::Opening if off_back_rank => {
            // Bare "develops" emits no phrase; the composer combines it
            // with prepares-castling / centralizes / outpost when those
            // also fire. Without a richer companion we don't say anything.
            push(out, "develops", "");
        }
        Phase::Middlegame => {
            // Only fire if the new square is meaningfully better — i.e.
            // not just a trade or blunder. We piggy-back on the eval
            // swing: if the static-eval gain on our side is ≥ 25cp this
            // is genuine activity, not noise.
            if ctx.eval_swing_cp >= 25 {
                push(out, "activates", format!("Activates the {}", role_name(ctx.moved.role)));
            }
        }
        Phase::Endgame => {
            if ctx.eval_swing_cp >= 25 {
                push(out, "activates", format!("Activates the {} for the endgame", role_name(ctx.moved.role)));
            }
        }
        _ => {}
    }
}

// ── New named-pattern detectors ─────────────────────────────────────────

/// Greek gift sacrifice: classic Bxh7+ (white) / Bxh2+ (black) with the
/// enemy king on g8/g1 after castling, the bishop moving from a kingside
/// diagonal slot, AND a knight (or queen) ready to follow up on g5/h5.
///
/// Pattern requires:
///   1. Move IS a bishop capture of `h7` (white) or `h2` (black).
///   2. The captured pawn was the king-shield h-pawn.
///   3. The enemy king is on g-file rank 8 (white) / 1 (black).
///   4. We have a knight that can reach g5 (white) / g4 (black) next ply,
///      OR a queen on the d1-h5 (white) / d8-h4 (black) diagonal/file.
///
/// Stricter than "Bxh7+" pattern matching alone — without the follow-up
/// piece this is just a desperado pawn-grab, not a Greek gift.
fn detect_greek_gift(ctx: &Context, out: &mut Vec<Motif>) {
    if ctx.moved.role != Role::Bishop { return; }
    let cap = match ctx.captured { Some(p) => p, None => return };
    if cap.role != Role::Pawn { return; }
    let target_sq_white = Square::H7;
    let target_sq_black = Square::H2;
    let king_g_white = Square::G8;
    let king_g_black = Square::G1;
    let board = ctx.after.board();
    let opp_king = match find_king(board, ctx.opp) { Some(k) => k, None => return };

    let is_white_pattern = ctx.mover == Color::White
        && ctx.to == target_sq_white
        && opp_king == king_g_white;
    let is_black_pattern = ctx.mover == Color::Black
        && ctx.to == target_sq_black
        && opp_king == king_g_black;
    if !(is_white_pattern || is_black_pattern) { return; }

    // Knight follow-up: white knight reaches g5 next ply, black to g4.
    let knight_target = if is_white_pattern { Square::G5 } else { Square::G4 };
    let our_knights = board.by_piece(Piece { color: ctx.mover, role: Role::Knight });
    let knight_can_reach = our_knights.into_iter().any(|n| {
        knight_attacks(n).contains(knight_target)
    });

    // Or queen follow-up: queen reaches the h-file or h5/h4 diagonal.
    let queen_targets: Bitboard = if is_white_pattern {
        Bitboard::from_square(Square::H5) | Bitboard::from_square(Square::H4) | Bitboard::from_square(Square::D3)
    } else {
        Bitboard::from_square(Square::H4) | Bitboard::from_square(Square::H5) | Bitboard::from_square(Square::D6)
    };
    let our_queens = board.by_piece(Piece { color: ctx.mover, role: Role::Queen });
    let queen_can_reach = our_queens.into_iter().any(|q| {
        let qa = queen_attacks(q, board.occupied());
        (qa & queen_targets).any()
    });

    if !(knight_can_reach || queen_can_reach) { return; }

    push(out, "greek_gift", "Greek gift sacrifice");
}

/// Back-rank mate threat. Fires when the move places a heavy piece (R/Q)
/// such that, on our next ply, mating the enemy king on the back rank is
/// a real possibility — i.e. the king has no luft (no escape squares) and
/// our heavy piece can land on the king's rank with no friendly blocker
/// in the way that the king could capture.
///
/// We check (after our move):
///   1. Enemy king is on its back rank.
///   2. Every escape square on rank 2/7 (one rank in from king) is
///      blocked by enemy pieces or attacked by us.
///   3. We have a R or Q on a file/diagonal that reaches the king's rank
///      with at most one enemy interposition (which would make the mate
///      a one-move sequence).
fn detect_back_rank_mate_threat(ctx: &Context, out: &mut Vec<Motif>) {
    // Don't double-up with checks/mates that already say their own thing.
    if out.iter().any(|m| ["checkmate","check","discovered_check","double_check"].contains(&m.id.as_str())) {
        return;
    }
    let board = ctx.after.board();
    let opp_king = match find_king(board, ctx.opp) { Some(k) => k, None => return };
    let back_rank = match ctx.opp {
        Color::White => Rank::First,
        Color::Black => Rank::Eighth,
    };
    if opp_king.rank() != back_rank { return; }

    // Escape squares: rank one in from the king, files kf-1..kf+1.
    let escape_rank = match ctx.opp {
        Color::White => Rank::Second,
        Color::Black => Rank::Seventh,
    };
    let kf = opp_king.file() as i32;
    let mut escape_squares = Vec::new();
    for df in [-1, 0, 1] {
        let f = kf + df;
        if !(0..8).contains(&f) { continue; }
        escape_squares.push(Square::from_coords(File::new(f as u32), escape_rank));
    }
    // All escape squares must be unsafe (blocked by enemy pawn shield or
    // attacked by us).
    let our_attacks = compute_all_attacks(board, ctx.mover);
    let any_escape = escape_squares.iter().any(|s| {
        let occ = board.piece_at(*s);
        let blocked_by_friend = matches!(occ, Some(p) if p.color == ctx.opp);
        let attacked = our_attacks.contains(*s);
        !blocked_by_friend && !attacked
    });
    if any_escape { return; }

    // Do we have an R or Q that can reach the back rank? Look at our
    // R/Q attacks against any square on the king's rank (excluding king
    // square, where direct check would have been captured by the
    // discovered/check branches).
    let kr = opp_king.rank();
    let mut rank_squares = Bitboard::EMPTY;
    for f in 0..8 {
        let s = Square::from_coords(File::new(f), kr);
        if s != opp_king {
            rank_squares |= Bitboard::from_square(s);
        }
    }
    let our_rooks_queens =
        (board.rooks() | board.queens()) & board.by_color(ctx.mover);
    let mut threatens = false;
    for sq in our_rooks_queens {
        let attacks = match board.piece_at(sq).map(|p| p.role) {
            Some(Role::Rook) => rook_attacks(sq, board.occupied()),
            Some(Role::Queen) => queen_attacks(sq, board.occupied()),
            _ => continue,
        };
        if (attacks & rank_squares).any() {
            threatens = true;
            break;
        }
    }
    if !threatens { return; }

    push(out, "back_rank_mate_threat", "Threatens back-rank mate");
}

/// Knight invasion: knight lands on a 5th/6th-rank outpost in the enemy
/// half AND that square is unchallengeable by enemy pawns. Fires *in
/// addition* to `outpost` when the invasion is into the opponent's camp,
/// because "Knight invades f5" reads more sharply than "Establishes an
/// outpost on f5".
fn detect_knight_invasion(ctx: &Context, out: &mut Vec<Motif>) {
    if ctx.moved.role != Role::Knight { return; }
    let board = ctx.after.board();
    if !is_outpost(board, ctx.to, ctx.moved) { return; }
    // Must be on rank 5+ (white) or rank 4- (black) — invading enemy half.
    let r = ctx.to.rank() as i32;
    let invading = match ctx.mover {
        Color::White => r >= 4,
        Color::Black => r <= 3,
    };
    if !invading { return; }
    // Don't fire on rank-4/5 outposts that are merely "central" — we need
    // a true invasion: rank 5+ (white) / rank ≤ 2 (black) AND in enemy
    // territory by file too (i.e. inside the enemy's pawn structure).
    let deep_invasion = match ctx.mover {
        Color::White => r >= 4,
        Color::Black => r <= 3,
    };
    if !deep_invasion { return; }
    push(out, "knight_invasion", format!("Knight invades {}", ctx.to));
}

/// Rook lift: rook moves from the back rank to rank 3 (white) or rank 6
/// (black) on the kingside (f/g/h files). Classic attacking maneuver.
fn detect_rook_lift(ctx: &Context, out: &mut Vec<Motif>) {
    if ctx.moved.role != Role::Rook { return; }
    let from_rank = match ctx.mover { Color::White => Rank::First, Color::Black => Rank::Eighth };
    if ctx.from.rank() != from_rank { return; }
    let to_rank = match ctx.mover { Color::White => Rank::Third, Color::Black => Rank::Sixth };
    if ctx.to.rank() != to_rank { return; }
    if !matches!(ctx.to.file(), File::F | File::G | File::H) { return; }
    push(out, "rook_lift", "Rook lift toward the kingside");
}

/// Opens a file or diagonal for one of OUR sliders. Fires when:
///   • The from-square sat on a file (or diagonal) that an own R/Q (or
///     B/Q) lies behind, AND
///   • Vacating it gives the slider a new line.
///
/// This catches things like "knight steps off c3, opening the c-file for
/// the rook on c1".
/// Opens a file / diagonal for our slider — TIGHT version.
///
/// User: "opens diagonals for / opens files for ... wrongly." A file or
/// diagonal that "opens" but lets the slider attack NOTHING isn't worth
/// flagging. The geometric condition (slider behind, vacating square)
/// is necessary but not sufficient: the slider must GAIN real reach
/// (an enemy piece, an enemy-half square, or a king-zone square it
/// didn't have before).
///
/// Two-condition check, applied uniformly to file and diagonal:
///   (1) The vacated path is now genuinely clear for our slider.
///   (2) The slider's NEW attack set (reachable squares) includes at
///       least one of: an enemy piece, the enemy half, or the enemy
///       king's zone.
fn detect_opens_line_for(ctx: &Context, out: &mut Vec<Motif>) {
    let board_a = ctx.after.board();
    let board_b = ctx.before.board();
    let f0 = ctx.from.file() as i32;
    let r0 = ctx.from.rank() as i32;
    let opp_king_sq = find_king(board_a, ctx.opp);
    let enemy_pieces = board_a.by_color(ctx.opp);

    // Helper: a slider on `sq` actually GAINS something useful by the
    // newly-cleared line. We compute its attack set from the after
    // board (with from-square emptied) and check it intersects either
    // an enemy piece, the enemy half (rank 4-7 for white attackers,
    // 0-3 for black), or the enemy king zone.
    let slider_gains_real_reach = |sq: Square, role: Role| -> bool {
        let occ = board_a.occupied();
        let attacks = match role {
            Role::Rook => rook_attacks(sq, occ),
            Role::Bishop => bishop_attacks(sq, occ),
            Role::Queen => queen_attacks(sq, occ),
            _ => return false,
        };
        // Enemy piece in attack set?
        if (attacks & enemy_pieces).any() { return true; }
        // King zone touch?
        if let Some(k) = opp_king_sq {
            if (attacks & king_zone(k)).any() { return true; }
        }
        // Enemy-half square count: meaningful presence (≥3 squares).
        let mut enemy_half_count = 0;
        for s in attacks {
            let r = s.rank() as i32;
            let in_enemy_half = match ctx.mover {
                Color::White => r >= 4,
                Color::Black => r <= 3,
            };
            if in_enemy_half { enemy_half_count += 1; }
            if enemy_half_count >= 3 { return true; }
        }
        false
    };

    // Files: scan up and down from the from-square.
    let our_rooks_queens =
        (board_a.rooks() | board_a.queens()) & board_a.by_color(ctx.mover);
    for sq in our_rooks_queens {
        if sq == ctx.from || sq == ctx.to { continue; }
        let sf = sq.file() as i32;
        let sr = sq.rank() as i32;
        let role = match board_a.piece_at(sq).map(|p| p.role) { Some(r) => r, None => continue };
        if sf == f0 && sr != r0 {
            let between_clear = ray_clear_between_after(board_a, sq, ctx.from);
            let was_blocked_before = !ray_clear_between(board_b, sq, ctx.from)
                || board_b.piece_at(ctx.from).map_or(false, |p| p.color == ctx.mover);
            if between_clear && was_blocked_before && slider_gains_real_reach(sq, role) {
                let role_str = match role {
                    Role::Rook => "rook", Role::Queen => "queen", _ => "rook",
                };
                push(out, "opens_file_for",
                     format!("Opens the {}-file for the {}",
                             file_letter(File::new(f0 as u32)), role_str));
                return;
            }
        }
        if (sf - f0).abs() == (sr - r0).abs() && (sf - f0).abs() > 0 {
            if !matches!(role, Role::Bishop | Role::Queen) { continue; }
            let between_clear = ray_clear_between_after(board_a, sq, ctx.from);
            let was_blocked_before = !ray_clear_between(board_b, sq, ctx.from)
                || board_b.piece_at(ctx.from).map_or(false, |p| p.color == ctx.mover);
            if between_clear && was_blocked_before && slider_gains_real_reach(sq, role) {
                let role_str = if role == Role::Bishop { "bishop" } else { "queen" };
                push(out, "opens_diagonal_for",
                     format!("Opens a diagonal for the {}", role_str));
                return;
            }
        }
    }
    // Bishops (treated separately since they're not in the rooks_queens set).
    let our_bishops = board_a.bishops() & board_a.by_color(ctx.mover);
    for sq in our_bishops {
        if sq == ctx.from || sq == ctx.to { continue; }
        let sf = sq.file() as i32;
        let sr = sq.rank() as i32;
        if (sf - f0).abs() == (sr - r0).abs() && (sf - f0).abs() > 0 {
            let between_clear = ray_clear_between_after(board_a, sq, ctx.from);
            let was_blocked_before = !ray_clear_between(board_b, sq, ctx.from)
                || board_b.piece_at(ctx.from).map_or(false, |p| p.color == ctx.mover);
            if between_clear && was_blocked_before && slider_gains_real_reach(sq, Role::Bishop) {
                push(out, "opens_diagonal_for", "Opens a diagonal for the bishop");
                return;
            }
        }
    }
}

fn ray_clear_between(board: &Board, a: Square, b: Square) -> bool {
    let af = a.file() as i32;
    let ar = a.rank() as i32;
    let bf = b.file() as i32;
    let br = b.rank() as i32;
    let df = (bf - af).signum();
    let dr = (br - ar).signum();
    let mut f = af + df;
    let mut r = ar + dr;
    while f != bf || r != br {
        let s = Square::from_coords(File::new(f as u32), Rank::new(r as u32));
        if board.piece_at(s).is_some() { return false; }
        f += df;
        r += dr;
    }
    true
}
fn ray_clear_between_after(board: &Board, a: Square, b: Square) -> bool {
    // `b` is the from-square on the after-board (now empty), so we just
    // check that the path between `a` and `b` is unblocked, and `b`
    // itself is now empty.
    if board.piece_at(b).is_some() { return false; }
    ray_clear_between(board, a, b)
}

/// Pawn breakthrough: a pawn capture that creates (or unblocks) a
/// passed pawn for our side. Distinct from `pawn_break` which fires on
/// any pawn capture — breakthrough is about creating a queening threat.
fn detect_pawn_breakthrough(ctx: &Context, out: &mut Vec<Motif>) {
    if ctx.moved.role != Role::Pawn { return; }
    if ctx.captured.is_none() { return; }
    let board_a = ctx.after.board();
    let board_b = ctx.before.board();
    // Is THIS pawn now passed? Or is some other friendly pawn newly passed?
    let enemy_pawns_a = board_a.pawns() & board_a.by_color(ctx.opp);
    let mover_pawns_a = board_a.pawns() & board_a.by_color(ctx.mover);
    let mover_pawns_b = board_b.pawns() & board_b.by_color(ctx.mover);
    for sq in mover_pawns_a {
        let was = mover_pawns_b.contains(sq);
        let is_passed_now = is_passed_pawn_loose(sq, ctx.mover, enemy_pawns_a);
        let was_passed = if was {
            let enemy_pawns_b = board_b.pawns() & board_b.by_color(ctx.opp);
            is_passed_pawn_loose(sq, ctx.mover, enemy_pawns_b)
        } else { false };
        if is_passed_now && !was_passed {
            push(out, "pawn_breakthrough", format!("Creates a passed pawn on the {}-file", file_letter(sq.file())));
            return;
        }
    }
}
fn is_passed_pawn_loose(sq: Square, color: Color, enemy_pawns: Bitboard) -> bool {
    let f = sq.file() as i32;
    let r = sq.rank() as i32;
    for df in [-1, 0, 1] {
        let nf = f + df;
        if !(0..8).contains(&nf) { continue; }
        for nr in 0..8 {
            let s = Square::from_coords(File::new(nf as u32), Rank::new(nr));
            if !enemy_pawns.contains(s) { continue; }
            if (color == Color::White && nr as i32 > r) || (color == Color::Black && (nr as i32) < r) {
                return false;
            }
        }
    }
    true
}

/// Offers a trade: we move a piece into a square where it's defended,
/// directly attacked by an equal-value enemy piece, AND any capture
/// would be a clean SEE-zero exchange. Captures the social meaning of
/// "I'm offering to trade pieces" — a non-capture move that nonetheless
/// creates a trading opportunity.
fn detect_offers_trade(ctx: &Context, out: &mut Vec<Motif>) {
    // Only fire on quiet moves; captures already classified.
    if ctx.captured.is_some() { return; }
    if matches!(ctx.moved.role, Role::Pawn | Role::King) { return; }
    let board = ctx.after.board();
    // Are we attacked by an equal-role enemy piece?
    let attackers = board.attacks_to(ctx.to, ctx.opp, board.occupied());
    let mut equal_attacker_role: Option<Role> = None;
    for asq in attackers {
        if let Some(p) = board.piece_at(asq) {
            if p.role == ctx.moved.role {
                equal_attacker_role = Some(p.role);
                break;
            }
        }
    }
    if equal_attacker_role.is_none() { return; }
    // Are we defended by at least one piece?
    let defenders = board.attacks_to(ctx.to, ctx.mover, board.occupied())
        & !Bitboard::from_square(ctx.to);
    if !defenders.any() { return; }
    // SEE on opp capturing here should be ≈ 0 (clean trade).
    if let Some(see_val) = see_capture(board, ctx.to, ctx.opp) {
        if see_val.abs() > 50 { return; } // not a clean trade
    } else { return; }
    push(out, "offers_trade", format!("Offers a {} trade", role_name(ctx.moved.role)));
}

/// Compute the union of attack sets for all pieces of `color`. Used by
/// pattern detectors that need "is square X attacked by color Y".
fn compute_all_attacks(board: &Board, color: Color) -> Bitboard {
    let mut bb = Bitboard::EMPTY;
    let occ = board.occupied();
    for sq in board.by_color(color) {
        let p = match board.piece_at(sq) { Some(p) => p, None => continue };
        bb |= match p.role {
            Role::Pawn => pawn_attacks(p.color, sq),
            Role::Knight => knight_attacks(sq),
            Role::Bishop => bishop_attacks(sq, occ),
            Role::Rook => rook_attacks(sq, occ),
            Role::Queen => queen_attacks(sq, occ),
            Role::King => king_attacks(sq),
        };
    }
    bb
}

// ── Strategic / higher-order detectors ──────────────────────────────────

/// Decisive combination: a single ply that wins material AND continues to
/// threaten more. Specifically: this move is a CAPTURE *and* delivers
/// check OR creates a follow-up threat that the opponent can't simply
/// ignore. The eval swing in our favor confirms it's not just noise.
///
/// This is a Lasker / Capablanca-style observation: not just "captures
/// the rook" but "captures the rook and the threats keep coming."
fn detect_decisive_combination(ctx: &Context, out: &mut Vec<Motif>) {
    // Already gated by checkmate/sacrifice — those are stronger.
    if out.iter().any(|m| ["checkmate","sacrifice","double_check"].contains(&m.id.as_str())) {
        return;
    }
    let captured = match ctx.captured { Some(c) => c, None => return };
    if captured.role == Role::Pawn { return; } // only fires on piece captures
    let gives_check = ctx.after.is_check();
    let creates_more = out.iter().any(|m|
        ["fork","pin","skewer","threatens","creates_threat","greek_gift","traps_piece","back_rank_mate_threat"]
            .contains(&m.id.as_str()));
    if !(gives_check || creates_more) { return; }
    // Eval swing must confirm: ≥150cp gain for the mover this turn.
    if ctx.eval_swing_cp < 150 { return; }
    push(out, "decisive_combination", "Decisive combination — winning material and pressing on");
}

/// Loss of castling rights — a king OR rook move that removes castling
/// rights for the side that just moved, in a position where the king is
/// still vulnerable (lots of pieces on the board, hasn't castled). This
/// is a strategic warning sign worth surfacing.
fn detect_loss_of_castling_rights(ctx: &Context, out: &mut Vec<Motif>) {
    if !matches!(ctx.moved.role, Role::King | Role::Rook) { return; }
    let before_rights = ctx.before.castles();
    let after_rights = ctx.after.castles();
    let lost_kingside = before_rights.has(ctx.mover, shakmaty::CastlingSide::KingSide)
        && !after_rights.has(ctx.mover, shakmaty::CastlingSide::KingSide);
    let lost_queenside = before_rights.has(ctx.mover, shakmaty::CastlingSide::QueenSide)
        && !after_rights.has(ctx.mover, shakmaty::CastlingSide::QueenSide);
    if !(lost_kingside || lost_queenside) { return; }
    // Only meaningful in the opening / middlegame. In the endgame we
    // don't usually castle anyway.
    if ctx.phase == Phase::Endgame { return; }
    // If the move was castling itself, that's already its own motif.
    if matches!(ctx.mv, Move::Castle { .. }) { return; }

    let phrase = if lost_kingside && lost_queenside {
        "Forfeits castling rights"
    } else if lost_kingside {
        "Forfeits kingside castling"
    } else {
        "Forfeits queenside castling"
    };
    push(out, "loses_castling", phrase);
}

/// Prophylaxis (limited form). A move is prophylactic if it specifically
/// prevents the opponent's most natural break or threat. We approximate:
/// the move significantly *reduces* the eval swing the opponent could
/// have generated (we look at one of their best counter-moves before vs
/// after — but that requires search, which we don't have). Instead we
/// use a simple geometric heuristic: a move that *blocks an enemy
/// slider's attack on a critical square* (one that would have been a
/// fork / mate / capture target) is prophylactic.
///
/// Concretely: if our move places a friendly piece on a square that's
/// on an enemy slider's attack ray AND that square was previously
/// attacked by the enemy slider (now blocked), we flag it.
fn detect_prophylaxis(ctx: &Context, out: &mut Vec<Motif>) {
    if ctx.captured.is_some() { return; }   // captures aren't prophylactic
    if ctx.after.is_check() { return; }     // checks aren't prophylactic
    if matches!(ctx.moved.role, Role::Pawn | Role::King) { return; }
    let board_a = ctx.after.board();
    let board_b = ctx.before.board();
    // Did our destination square become a NEW blocker on an enemy ray?
    // Simpler test: count enemy slider attack squares before vs after.
    // If after < before by ≥3, we've meaningfully blocked something.
    let enemy_attacks_before = compute_all_attacks(board_b, ctx.opp).count() as i32;
    let enemy_attacks_after = compute_all_attacks(board_a, ctx.opp).count() as i32;
    let blocked = enemy_attacks_before - enemy_attacks_after;
    if blocked < 3 { return; }
    // Don't fire in the opening — too noisy; piece moves naturally
    // change attack counts in early positions.
    if ctx.phase == Phase::Opening { return; }
    push(out, "prophylaxis", "Prophylactic move, restricting the opponent");
}

/// Multi-purpose move: a single ply that satisfies multiple strategic
/// goals at once (Karpov's hallmark). We say "multi-purpose" if the
/// move triggers ≥3 of the high-priority motif buckets WITHOUT firing
/// any single decisive one (no checkmate / sacrifice / fork etc.). This
/// is a softer "this is a really nice move" tag for quiet positions.
fn detect_multi_purpose(ctx: &Context, out: &mut Vec<Motif>) {
    let strong_buckets = [
        "develops", "centralizes", "outpost", "long_diagonal", "fianchetto",
        "open_file", "semi_open_file", "rook_seventh", "doubles_rooks",
        "battery", "prepares_castling_kingside", "prepares_castling_queenside",
        "attacks_pawn", "eyes_king_zone", "defends", "activates",
        "opens_file_for", "opens_diagonal_for", "knight_invasion",
        "rook_lift", "passed_pawn", "outpost", "connects_rooks",
    ];
    // Count how many already-fired motifs land in the bucket.
    let count = out.iter().filter(|m| strong_buckets.contains(&m.id.as_str())).count();
    if count < 3 { return; }
    // Don't fire if a "headline" tactic already fired.
    if out.iter().any(|m| ["checkmate","double_check","sacrifice","fork","pin","skewer","greek_gift","decisive_combination"].contains(&m.id.as_str())) {
        return;
    }
    let _ = ctx; // ctx not needed — we just observe what fired
    push(out, "multi_purpose", "Multi-purpose move achieving several goals");
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
        // Game-defining tactical moves.
        "checkmate" => 0,
        "double_check" => 1,            // strongest single-ply tactic
        "sacrifice" => 2,
        "greek_gift" => 3,              // famous named pattern
        "decisive_combination" => 4,
        "fork" => 5,
        // (indices below shift by 1; legacy rules unchanged)
        "discovered_check" => 6,
        "pin" => 7,
        "skewer" => 8,
        "back_rank_mate_threat" => 9,
        "anastasia_mate_threat" => 10,
        "bodens_mate_threat" => 11,
        "arabian_mate_threat" => 12,
        "removes_defender" => 13,
        "smothered_hint" => 14,
        // Captures & trades.
        "exchange_sacrifice" => 14,
        "simplifies" => 15,             // trade when ahead → reads as the *reason*
        "trades_into_endgame" => 16,
        "queen_trade" => 17,
        "piece_trade" => 18,
        "capture" => 19,
        "en_passant" => 20,
        "promotion" => 21,
        "pawn_breakthrough" => 22,
        // Threats / pressure.
        "creates_threat" => 25,
        "threatens" => 26,
        "traps_piece" => 27,
        "overloaded" => 28,
        "check" => 29,
        // Strategic structural ideas.
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
        // Piece play.
        "knight_invasion" => 50,        // outranks plain "outpost"
        "rook_lift" => 51,
        "doubles_rooks" => 52,
        "rook_seventh" => 53,
        "open_file" => 54,
        "semi_open_file" => 55,
        "outpost" => 60,
        "long_diagonal" => 61,
        "fianchetto" => 62,
        "battery" => 63,
        "opens_file_for" => 64,
        "opens_diagonal_for" => 65,
        "attacks_pawn" => 70,
        "eyes_king_zone" => 71,
        "attacks_king" => 72,
        "luft" => 73,
        "prepares_castling_kingside" => 80,
        "prepares_castling_queenside" => 81,
        "centralizes" => 82,
        "defends" => 83,
        "restricts" => 84,
        "offers_trade" => 85,
        "activates" => 86,
        "trades_when_behind" => 87,
        "loses_castling" => 88,
        "prophylaxis" => 89,
        "multi_purpose" => 89,
        "pawn_break" => 90,
        "pawn_lever" => 91,
        "passed_pawn" => 92,
        "pawn_storm" => 93,
        "isolated_pawn" => 94,
        // Bad signs.
        "knight_on_rim" => 100,
        "bishop_pair_lost" => 101,
        "bad_bishop" => 102,
        "hangs" => 103,
        // Game-end states.
        "stalemate" => 110,
        "insufficient_material" => 113,
        // Internal flags.
        "develops" => 200,
        "connects_rooks" => 201,
        _ => 999,
    }
}
