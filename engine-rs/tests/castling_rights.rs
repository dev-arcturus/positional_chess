//! Regression test for `KingSideAnalysis.castling_rights_*`.
//!
//! Before this fix, both fields in the explanation blob were
//! hard-coded to `false` for every position because the analysis
//! function only had access to `&Board` and not `&Chess`. The
//! correct values should reflect the FEN's castling rights field
//! per side.

use engine_rs::explain_for_test;

#[test]
fn starting_position_all_rights() {
    let e = explain_for_test(
        "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    )
    .expect("FEN parses");
    let w = &e.king_safety.white;
    let b = &e.king_safety.black;
    assert!(w.castling_rights_kingside, "white still has O-O");
    assert!(w.castling_rights_queenside, "white still has O-O-O");
    assert!(b.castling_rights_kingside, "black still has O-O");
    assert!(b.castling_rights_queenside, "black still has O-O-O");
}

#[test]
fn white_kingside_only_after_a1_loss() {
    // White has only kingside (`Kkq` in FEN — uppercase = white, lowercase
    // = black). White lost queenside (rook moved off a1, say). Black
    // still has both.
    let e = explain_for_test(
        "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w Kkq - 0 1",
    )
    .expect("FEN parses");
    let w = &e.king_safety.white;
    let b = &e.king_safety.black;
    assert!(w.castling_rights_kingside);
    assert!(!w.castling_rights_queenside);
    assert!(b.castling_rights_kingside);
    assert!(b.castling_rights_queenside);
}

#[test]
fn black_queenside_only_after_h8_loss() {
    let e = explain_for_test(
        "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQq - 0 1",
    )
    .expect("FEN parses");
    let w = &e.king_safety.white;
    let b = &e.king_safety.black;
    assert!(w.castling_rights_kingside);
    assert!(w.castling_rights_queenside);
    assert!(!b.castling_rights_kingside);
    assert!(b.castling_rights_queenside);
}

#[test]
fn no_rights_after_both_kings_moved() {
    // FEN `-` for castling rights → neither side can castle.
    let e = explain_for_test(
        "r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w - - 0 1",
    )
    .expect("FEN parses");
    let w = &e.king_safety.white;
    let b = &e.king_safety.black;
    assert!(!w.castling_rights_kingside);
    assert!(!w.castling_rights_queenside);
    assert!(!b.castling_rights_kingside);
    assert!(!b.castling_rights_queenside);
}

#[test]
fn castled_position_has_no_remaining_rights() {
    // After O-O for white. King on g1, rook on f1 — castling rights
    // gone for both sides of white.
    let e = explain_for_test(
        "r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R4RK1 b kq - 0 1",
    )
    .expect("FEN parses");
    let w = &e.king_safety.white;
    assert!(!w.castling_rights_kingside);
    assert!(!w.castling_rights_queenside);
    assert!(w.castled, "white king on g1 reads as castled");
}
