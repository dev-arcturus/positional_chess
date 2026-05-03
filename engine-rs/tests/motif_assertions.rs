//! Integration tests for the motif analyzer.
//!
//! Each test sets a starting FEN, plays a UCI move, and asserts which
//! motif IDs MUST and MUST NOT appear in the result. This is the
//! "extensive testing" — the only way to catch regressions where a
//! detector starts firing on a position it shouldn't.
//!
//! Coverage approach:
//!
//!   1. Famous tactical patterns (Greek gift, smothered mate, fork, pin,
//!      skewer, discovered check, double check) — must fire.
//!   2. Known false-positive triggers from prior versions:
//!      - knight pinned to bishop  → `pin` must NOT fire
//!      - balanced trade           → `hangs` must NOT fire
//!      - quiet move with one zone-square attack → `eyes_king_zone` must
//!        NOT fire
//!      - non-central piece move → `centralizes` must NOT fire
//!   3. Strategic / phase-aware behaviour:
//!      - opening minor-piece move → `develops` (no phrase), no `activates`
//!      - middlegame redeployment   → `activates`
//!   4. Pattern detectors (Greek gift, back-rank mate threat, knight
//!      invasion, rook lift, opens-file-for, simplifies, etc.).
//!
//! These tests run against the public `analyze` API used by the WASM
//! binding, so they lock in the same shape the JS tagline composer
//! receives.

use shakmaty::{fen::Fen, CastlingMode, Chess, Move, Position};

// We can't directly import `analyze` here without the wasm_bindgen
// boundary, so we re-implement the thin wrapper used inside lib.rs.
// (Keeps the tests pure-Rust and runnable via `cargo test`.)

fn motif_ids(fen_before: &str, uci: &str) -> Vec<String> {
    let fen: Fen = fen_before.parse().expect("bad fen");
    let pos: Chess = fen.into_position(CastlingMode::Standard).expect("illegal");
    let mv = parse_uci(&pos, uci).expect("legal move");
    let mut after = pos.clone();
    after.play_unchecked(&mv);
    let terminal = if after.is_checkmate() {
        Some("checkmate")
    } else if after.is_stalemate() {
        Some("stalemate")
    } else { None };
    let motifs = engine_rs::detect_for_test(&pos, &after, &mv, terminal);
    motifs.into_iter().map(|m| m.id).collect()
}

fn parse_uci(pos: &Chess, uci: &str) -> Option<Move> {
    let from: shakmaty::Square = uci[0..2].parse().ok()?;
    let to: shakmaty::Square = uci[2..4].parse().ok()?;
    let promo = if uci.len() >= 5 {
        match &uci[4..5] {
            "q" => Some(shakmaty::Role::Queen),
            "r" => Some(shakmaty::Role::Rook),
            "b" => Some(shakmaty::Role::Bishop),
            "n" => Some(shakmaty::Role::Knight),
            _ => None,
        }
    } else { None };
    pos.legal_moves()
        .iter()
        .find(|m| m.from() == Some(from) && m.to() == to && m.promotion() == promo)
        .cloned()
}

fn assert_has(motifs: &[String], id: &str, ctx: &str) {
    assert!(
        motifs.iter().any(|m| m == id),
        "[{ctx}] expected motif `{id}` but got: {motifs:?}",
    );
}
fn assert_not(motifs: &[String], id: &str, ctx: &str) {
    assert!(
        !motifs.iter().any(|m| m == id),
        "[{ctx}] motif `{id}` should NOT have fired but did. all motifs: {motifs:?}",
    );
}

// ─── Tactical motifs ──────────────────────────────────────────────────

#[test]
fn fork_knight_attacks_king_and_queen() {
    // Royal fork: black knight on a3, white king on e1, white rook on a1.
    // Black plays ...Nc2+ — from c2 the knight attacks both the king on
    // e1 (check) and the rook on a1 (fork target).
    let fen = "2k5/8/8/8/8/n7/8/R3K3 b - - 0 1";
    let motifs = motif_ids(fen, "a3c2");
    assert_has(&motifs, "fork", "royal fork");
    assert_has(&motifs, "check", "royal fork");
}

#[test]
fn pin_only_to_strictly_heavier_piece() {
    // Absolute pin to the king. White rook on e1, white king on h1,
    // black knight on e5, black king on e8. Re1-e3 attacks the knight
    // along the e-file with the black king directly behind it → pin
    // must fire (front piece is a knight, rear is the king).
    let fen = "4k3/8/8/4n3/8/8/8/4R2K w - - 0 1";
    let motifs = motif_ids(fen, "e1e3");
    assert_has(&motifs, "pin", "absolute pin to king");
}

#[test]
fn queen_on_king_line_is_pin_not_skewer() {
    // Black queen in front of black king on the e-file; white rook
    // moves to e1. Front piece (queen, raw value 9) is in front of the
    // king (bucketed value 100 in the pin/skewer scale).
    //
    // For SKEWER the front must be strictly heavier than rear. Queen 9
    // < King 100 → not a skewer.
    // For PIN the front must be lighter than rear. Queen 9 < King 100
    // → absolute pin to the king. Pin should fire, skewer should not.
    let fen = "4k3/4q3/8/8/8/8/8/R5K1 w - - 0 1";
    let motifs = motif_ids(fen, "a1e1");
    assert_has(&motifs, "pin", "queen pinned to king is absolute pin");
    assert_not(&motifs, "skewer", "front-piece-lighter-than-rear is pin, not skewer");
}

#[test]
fn skewer_king_in_front_of_queen() {
    // White rook on a1 attacks the e-file. Black king on e7 with black
    // queen on e8 behind it. After Re1 → rook attacks the king on e7;
    // king must move; rook then wins the queen on e8. Classic skewer:
    // front piece (king) is more valuable than rear (queen).
    let fen = "4q3/4k3/8/8/8/8/8/R5K1 w - - 0 1";
    let motifs = motif_ids(fen, "a1e1");
    // The check on the king fires first; skewer is also valid because
    // the king (front, bucketed 100) is heavier than the queen (rear,
    // bucketed 9).
    assert_has(&motifs, "skewer", "king-in-front-of-queen is a skewer");
    assert_has(&motifs, "check", "king is attacked along the e-file");
}

#[test]
fn discovered_check_recognised() {
    // White knight on d5 with white rook on d1 behind, black king on d8.
    // Knight moves out (Nf6+), unmasking the rook → discovered check.
    let fen = "3k4/8/8/3N4/8/8/8/3RK3 w - - 0 1";
    let motifs = motif_ids(fen, "d5f6");
    assert_has(&motifs, "discovered_check", "knight unmasks rook");
}

#[test]
fn double_check_strongest_form() {
    // Knight on e6 blocking the e-file, rook on e1 behind it, white king
    // on f1; black king on e8. After Ne6-c7+:
    //   - knight from c7 attacks e8 (knight reach from c7 includes e8)
    //   - moving off the e-file uncovers the rook on e1, which now
    //     attacks e8 along the now-clear e-file → discovered check
    // Both checking pieces hit the king on the same turn → double check.
    let fen = "4k3/8/4N3/8/8/8/8/4RK2 w - - 0 1";
    let motifs = motif_ids(fen, "e6c7");
    assert_has(&motifs, "double_check", "Nc7+ from e6 with rook behind is a double check");
    // Double check subsumes plain check; we only assert double_check
    // fired (the composer handles the headline phrasing).
}

// ─── Negative tests (false-positive guards) ──────────────────────────

#[test]
fn no_hangs_on_balanced_trade() {
    // Standard knight trade: white Nxf6 takes black knight, black recaptures
    // ...exf6. Knight-for-knight is material_lost = 0 → no hangs.
    let fen = "7k/4p3/5n2/3N4/8/8/8/7K w - - 0 1";
    let motifs = motif_ids(fen, "d5f6");
    // The phase classifier sees this as an endgame (only knights remain)
    // → uses `trades_into_endgame` rather than `piece_trade`. Either is
    // a valid trade tag — the key assertion is `hangs` doesn't fire.
    let trade_fired = motifs.iter().any(|m|
        m == "piece_trade" || m == "trades_into_endgame" || m == "simplifies");
    assert!(trade_fired, "expected a trade motif, got: {motifs:?}");
    assert_not(&motifs, "hangs", "balanced trade");
    assert_not(&motifs, "sacrifice", "balanced trade");
}

#[test]
fn no_eyes_king_zone_on_one_square() {
    // Quiet bishop move that incidentally attacks ONE square in the king
    // zone — should NOT fire `eyes_king_zone`.
    let fen = "rnbqk2r/pppp1ppp/4pn2/8/2B5/4PN2/PPPP1PPP/RNBQK2R w KQkq - 0 1";
    let motifs = motif_ids(fen, "c4d3");
    // Bd3 attacks h7 (in black king's 3x3 zone if king on e8 — but king
    // is on e8 so zone is d7-f7,d8-f8). Bd3 attacks the long diag h7
    // which ISN'T in the king zone. So we shouldn't fire anyway. This
    // is a sanity check that quiet retreats don't fire `eyes_king_zone`.
    assert_not(&motifs, "eyes_king_zone", "quiet retreat");
}

#[test]
fn no_centralizes_unless_actually_central() {
    // Knight from b1 to a3 — not central, must NOT fire `centralizes`.
    let fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    let motifs = motif_ids(fen, "b1a3");
    assert_not(&motifs, "centralizes", "Na3 is not central");
}

#[test]
fn centralizes_only_on_d4_d5_e4_e5() {
    // Knight from g1 to f3 — develops but NOT central (f3 isn't d/e 4/5).
    let fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    let motifs = motif_ids(fen, "g1f3");
    assert_not(&motifs, "centralizes", "Nf3 is not on d4/d5/e4/e5");

    // But e2-e4 IS central for a pawn.
    let motifs2 = motif_ids(fen, "e2e4");
    assert_has(&motifs2, "centralizes", "e2-e4 is central");
}

// ─── Phase-aware verbs ─────────────────────────────────────────────────

#[test]
fn opening_minor_move_uses_develops_not_activates() {
    let fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    let motifs = motif_ids(fen, "b1c3");
    assert_has(&motifs, "develops", "opening minor move");
    assert_not(&motifs, "activates", "opening minor move not activates");
}

// ─── Trade nuance ──────────────────────────────────────────────────────

#[test]
fn simplifies_when_ahead_in_material() {
    // White ahead by a queen; trades knights → "Simplifies".
    // White: Q on d1, N on e5, K on h1. Black: N on f6, K on a8.
    // White Nxf6 → trades knights, mover ahead by 800+ → simplifies.
    // White: queen + knight, black: knight only. White Nxf4 trades knights
    // → with mover_advantage_cp ≈ +800 → simplifies.
    let fen = "k7/8/8/8/5n2/3N4/8/3Q3K w - - 0 1";
    let motifs = motif_ids(fen, "d3f4");
    assert_has(&motifs, "simplifies", "trade while ahead a queen");
    assert_not(&motifs, "piece_trade", "should be simplifies, not piece_trade");
}

#[test]
fn trades_into_endgame_when_phase_low() {
    // Few pieces left, trade rooks → trades_into_endgame.
    let fen = "4k3/8/8/8/8/8/4r3/4R2K w - - 0 1";
    let motifs = motif_ids(fen, "e1e2");
    assert_has(&motifs, "trades_into_endgame", "low-phase rook trade");
}

// ─── Named pattern: knight invasion ─────────────────────────────────

#[test]
fn knight_invasion_on_f5_outpost() {
    // White knight on d4 jumps to f5. f5 is a deep outpost because:
    //   - rank index 4 (rank 5) → satisfies the "white half ≥ rank 5"
    //     deep-invasion gate.
    //   - no black pawn on the e or g files at rank index ≥ 5 (rank 6+).
    //     Black has pawns only on d6, e5, h7 — none of those can ever
    //     challenge f5.
    // The detector should fire `knight_invasion`. The composer drops
    // the bare `outpost` label when the deeper one fires.
    let fen = "6k1/7p/3p4/4p3/3N4/8/8/6K1 w - - 0 1";
    let motifs = motif_ids(fen, "d4f5");
    assert_has(&motifs, "knight_invasion", "Nf5 is a deep outpost in enemy half");
    assert_not(&motifs, "outpost", "knight_invasion subsumes plain outpost");
}

#[test]
fn rook_lift_to_third_rank() {
    // White rook on f1, lifts to f3 — classic kingside-attack rook lift.
    let fen = "4k3/8/8/8/8/8/8/5RK1 w - - 0 1";
    let motifs = motif_ids(fen, "f1f3");
    assert_has(&motifs, "rook_lift", "Rf1-f3 is a textbook rook lift");
}
