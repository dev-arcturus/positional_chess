//! ExplanationBlob — a structured, decomposable description of a chess
//! position designed for downstream consumption by an LLM that writes
//! a grandmaster-level paragraph about *why* one side has the advantage.
//!
//! Architecture:
//!
//!   1. `static_explanation(fen)` — everything we can know without
//!      searching: material, pawn structure, king safety, activity,
//!      line control, immediate static tactics, and high-level themes
//!      that synthesise across heads.
//!   2. (Future) JS-side combiner pulls Stockfish multi-PV in and adds
//!      a `principal_plan` and `comparative` section.
//!
//! Every field in this blob is meant to be human-readable enough that
//! the JSON itself can be eyeballed AND structured enough that an LLM
//! can write fluent prose from it. The hardest part of explaining
//! Stockfish's blackbox is *attribution*: was the +0.7 because of
//! material? Activity? King safety? This blob attributes explicitly.

use crate::eval::{self, evaluate, EvalSide};
use crate::see::{hanging_loss};
use serde::{Deserialize, Serialize};
use shakmaty::{
    attacks::{
        bishop_attacks, king_attacks, knight_attacks, pawn_attacks, queen_attacks, rook_attacks,
    },
    Bitboard, Board, CastlingMode, Chess, Color, File, Piece, Position, Rank, Role, Square,
};

// ── Top-level blob ──────────────────────────────────────────────────────

#[derive(Serialize, Deserialize)]
pub struct Explanation {
    pub fen: String,
    pub side_to_move: String,
    pub move_number: u32,
    pub phase: String,

    // The bottom line, in three forms.
    pub eval_cp: i32,
    pub eval_pawns: f32,
    pub verdict: String,

    // Per-head eval breakdown so the LLM can attribute the score.
    pub eval_breakdown: EvalBreakdownSummary,

    pub material: MaterialAnalysis,
    pub pawn_structure: PawnStructureAnalysis,
    pub king_safety: BothSidesKingSafety,
    pub activity: BothSidesActivity,
    pub line_control: LineControl,
    pub tactics: TacticsAnalysis,
    pub endgame: EndgameAnalysis,
    pub themes: Vec<Theme>,
}

// ── Endgame-specific analysis ──────────────────────────────────────────
//
// These concepts are meaningful only when most pieces are off the board.
// Opposition, key squares, square-of-the-pawn — the textbook
// king-and-pawn-endgame primitives that decide who wins.

#[derive(Serialize, Deserialize, Default)]
pub struct EndgameAnalysis {
    /// True when the position qualifies as endgame phase.
    pub is_endgame: bool,
    /// True for king-and-pawn(s) vs king(-and-pawns) — the textbook
    /// case where opposition / key squares decide.
    pub is_king_pawn_endgame: bool,
    /// Opposition between the kings, if any. "white" / "black" =
    /// who *has* the opposition (i.e., the side NOT to move whose
    /// opponent is forced to give way).
    pub opposition: Option<OppositionInfo>,
    /// Per-side passed-pawn key-square claims.
    pub key_squares: Vec<KeySquareClaim>,
    /// Per-passed-pawn "is the defender's king inside the square?"
    pub square_of_pawn: Vec<SquareOfPawnInfo>,
    /// Free-form one-liners for the UI (e.g. "Kc6 wins the opposition
    /// AND a key square" when those conditions both fire).
    pub summary: String,
}

#[derive(Serialize, Deserialize)]
pub struct OppositionInfo {
    pub kind: String,        // "direct" | "distant" | "diagonal"
    pub holder: String,      // "white" | "black" — who has the opposition
    pub line: String,        // e.g. "e-file", "5th rank", "a1-h8 diagonal"
    pub description: String, // human-readable
}

#[derive(Serialize, Deserialize)]
pub struct KeySquareClaim {
    pub pawn_color: String,
    pub pawn_square: String,
    pub key_squares: Vec<String>,
    /// Which side's king occupies a key square (if any).
    pub controlled_by: Option<String>,
    pub description: String,
}

#[derive(Serialize, Deserialize)]
pub struct SquareOfPawnInfo {
    pub pawn_color: String,
    pub pawn_square: String,
    pub defender_in_square: bool,
    pub description: String,
}

#[derive(Serialize, Deserialize)]
pub struct EvalBreakdownSummary {
    /// White-relative tapered cp, per head.
    pub material_cp: i32,
    pub psqt_cp: i32,
    pub mobility_cp: i32,
    pub pawns_cp: i32,
    pub king_safety_cp: i32,
    pub threats_cp: i32,
    pub imbalance_cp: i32,
}

// ── Material ────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize)]
pub struct MaterialAnalysis {
    pub white: PieceCount,
    pub black: PieceCount,
    pub material_delta_cp: i32,
    pub bishop_pair_white: bool,
    pub bishop_pair_black: bool,
    pub same_color_bishops: bool,
    pub opposite_color_bishops: bool,
    pub minor_pieces_white: u32,
    pub minor_pieces_black: u32,
    pub heavy_pieces_white: u32,
    pub heavy_pieces_black: u32,
    pub summary: String,
}

#[derive(Serialize, Deserialize)]
pub struct PieceCount {
    pub pawns: u32,
    pub knights: u32,
    pub bishops: u32,
    pub rooks: u32,
    pub queens: u32,
}

// ── Pawn structure ──────────────────────────────────────────────────────

#[derive(Serialize, Deserialize)]
pub struct PawnStructureAnalysis {
    pub white: PawnSideAnalysis,
    pub black: PawnSideAnalysis,
    pub light_complex_weak: Option<String>, // "white" / "black"
    pub dark_complex_weak: Option<String>,
    pub iqp_white: bool,
    pub iqp_black: bool,
    pub hanging_pawns_white: bool,
    pub hanging_pawns_black: bool,
    pub summary: String,
}

#[derive(Serialize, Deserialize)]
pub struct PawnSideAnalysis {
    pub islands: u32,
    pub doubled_files: Vec<String>,
    pub isolated: Vec<String>,
    pub backward: Vec<String>,
    pub passed: Vec<String>,
    pub supported: Vec<String>,
    pub holes: Vec<String>,
    pub majority_side: Option<String>, // "queenside" / "kingside"
    pub pawn_chains: u32,
}

// ── King safety ─────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize)]
pub struct BothSidesKingSafety {
    pub white: KingSideAnalysis,
    pub black: KingSideAnalysis,
    pub summary: String,
}

#[derive(Serialize, Deserialize)]
pub struct KingSideAnalysis {
    pub king_square: String,
    pub castled: bool,
    pub castling_rights_kingside: bool,
    pub castling_rights_queenside: bool,
    pub pawn_shield_score: i32, // 0-100, 100 = perfect 3-pawn shield
    pub attacker_count: u32,
    pub attackers: Vec<AttackerRef>,
    pub open_files_to_king: Vec<String>,
    pub half_open_files_to_king: Vec<String>,
    pub weak_diagonals_to_king: Vec<String>,
    pub escape_squares_count: u32,
    pub danger_score: i32, // 0-1000, higher = worse
}

#[derive(Serialize, Deserialize)]
pub struct AttackerRef {
    pub square: String,
    pub role: String,
}

// ── Activity ────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize)]
pub struct BothSidesActivity {
    pub white: ActivitySideAnalysis,
    pub black: ActivitySideAnalysis,
    pub summary: String,
}

#[derive(Serialize, Deserialize)]
pub struct ActivitySideAnalysis {
    pub total_mobility: u32,
    pub squares_in_enemy_half: u32,
    pub central_minor_pieces: u32, // knights+bishops on d/e/c/f central files, ranks 4-5
    pub outposts: Vec<OutpostRef>,
    pub bad_bishop: Option<String>,
    pub passive_pieces: Vec<String>,
    pub long_diagonals_controlled: Vec<String>,
}

#[derive(Serialize, Deserialize)]
pub struct OutpostRef {
    pub square: String,
    pub piece: String,
}

// ── Line control ────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize)]
pub struct LineControl {
    pub open_files: Vec<FileControl>,
    pub half_open_files_white: Vec<String>, // files black has a pawn on but white doesn't
    pub half_open_files_black: Vec<String>,
    pub long_diagonal_a1h8: Option<String>,
    pub long_diagonal_h1a8: Option<String>,
    pub rook_seventh_white: Vec<String>,
    pub rook_seventh_black: Vec<String>,
    pub seventh_rank_dominant: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct FileControl {
    pub file: String,
    pub controlling_side: Option<String>,
}

// ── Tactics (immediate, no search) ──────────────────────────────────────

#[derive(Serialize, Deserialize)]
pub struct TacticsAnalysis {
    pub hanging_white: Vec<HangingRef>,
    pub hanging_black: Vec<HangingRef>,
    pub pinned_pieces: Vec<PinnedRef>,
    pub pieces_in_check: Option<String>, // "white" / "black"
}

#[derive(Serialize, Deserialize)]
pub struct HangingRef {
    pub square: String,
    pub role: String,
    pub loss_cp: i32,
}

#[derive(Serialize, Deserialize)]
pub struct PinnedRef {
    pub square: String,
    pub role: String,
    pub pinned_to_role: String, // "king" or another role
    pub pinned_to_square: String,
    pub absolute: bool,
}

// ── Themes ──────────────────────────────────────────────────────────────

#[derive(Serialize, Deserialize)]
pub struct Theme {
    pub id: String,
    pub side: String,        // "white" / "black" / "both"
    pub strength: i32,       // 0-100
    pub description: String,
}

// ═══════════════════════════════════════════════════════════════════════
// Top-level entry
// ═══════════════════════════════════════════════════════════════════════

pub fn static_explanation(fen: &str) -> Result<Explanation, String> {
    let parsed: shakmaty::fen::Fen = fen.parse().map_err(|e| format!("bad fen: {}", e))?;
    let pos: Chess = parsed
        .into_position(CastlingMode::Standard)
        .map_err(|e| format!("illegal: {}", e))?;
    let board = pos.board();
    let stm = pos.turn();
    let move_number = pos.fullmoves().get() as u32;

    let e = evaluate(board);
    let phase_qt = e.phase;
    let phase_str = if phase_qt <= 8 { "endgame" }
        else if phase_qt >= 20 && move_number <= 12 { "opening" }
        else { "middlegame" };

    let eval_breakdown = breakdown_summary(&e.white, &e.black, phase_qt);

    let material = analyse_material(board);
    let pawn_structure = analyse_pawn_structure(board);
    let king_safety = analyse_king_safety_both(board);
    let activity = analyse_activity_both(board);
    let line_control = analyse_line_control(board);
    let tactics = analyse_tactics(&pos);
    let endgame = analyse_endgame(board, stm, phase_str);
    let themes = derive_themes(&material, &pawn_structure, &king_safety, &activity, &line_control, &tactics, &endgame, e.final_cp);

    Ok(Explanation {
        fen: fen.to_string(),
        side_to_move: if stm == Color::White { "white".into() } else { "black".into() },
        move_number,
        phase: phase_str.into(),
        eval_cp: e.final_cp,
        eval_pawns: (e.final_cp as f32) / 100.0,
        verdict: verdict_string(e.final_cp),
        eval_breakdown,
        material,
        pawn_structure,
        king_safety,
        activity,
        line_control,
        tactics,
        endgame,
        themes,
    })
}

fn breakdown_summary(white: &EvalSide, black: &EvalSide, phase: i32) -> EvalBreakdownSummary {
    EvalBreakdownSummary {
        material_cp:    white.material.taper(phase)    - black.material.taper(phase),
        psqt_cp:        white.psqt.taper(phase)        - black.psqt.taper(phase),
        mobility_cp:    white.mobility.taper(phase)    - black.mobility.taper(phase),
        pawns_cp:       white.pawns.taper(phase)       - black.pawns.taper(phase),
        king_safety_cp: white.king_safety.taper(phase) - black.king_safety.taper(phase),
        threats_cp:     white.threats.taper(phase)     - black.threats.taper(phase),
        imbalance_cp:   white.imbalance.taper(phase)   - black.imbalance.taper(phase),
    }
}

fn verdict_string(cp: i32) -> String {
    let pawns = (cp.abs() as f32) / 100.0;
    if cp.abs() < 25 { "Roughly equal".into() }
    else if cp.abs() < 75 { format!("Slight edge for {}", if cp > 0 { "White" } else { "Black" }) }
    else if cp.abs() < 200 { format!("{} better (+{:.1})", if cp > 0 { "White" } else { "Black" }, pawns) }
    else if cp.abs() < 500 { format!("{} winning (+{:.1})", if cp > 0 { "White" } else { "Black" }, pawns) }
    else { format!("{} clearly winning ({:+.1})", if cp > 0 { "White" } else { "Black" }, pawns * (if cp > 0 { 1.0 } else { -1.0 })) }
}

// ── Material ────────────────────────────────────────────────────────────

fn analyse_material(board: &Board) -> MaterialAnalysis {
    let white = count_pieces(board, Color::White);
    let black = count_pieces(board, Color::Black);
    let bp_w = white.bishops >= 2;
    let bp_b = black.bishops >= 2;

    // Same / opposite color bishop detection (only meaningful with 1 each).
    let mut same_color = false;
    let mut opp_color = false;
    if white.bishops == 1 && black.bishops == 1 {
        let wb_sq = (board.bishops() & board.by_color(Color::White)).first();
        let bb_sq = (board.bishops() & board.by_color(Color::Black)).first();
        if let (Some(w), Some(b)) = (wb_sq, bb_sq) {
            let w_light = (w.file() as u8 + w.rank() as u8) % 2 == 1;
            let b_light = (b.file() as u8 + b.rank() as u8) % 2 == 1;
            if w_light == b_light { same_color = true; } else { opp_color = true; }
        }
    }

    let minor_w = white.knights + white.bishops;
    let minor_b = black.knights + black.bishops;
    let heavy_w = white.rooks + white.queens;
    let heavy_b = black.rooks + black.queens;

    // Material cp delta using PeSTO mg values for readability.
    let val = |c: &PieceCount| -> i32 {
        (c.pawns as i32 * 100) + (c.knights as i32 * 320) + (c.bishops as i32 * 330)
            + (c.rooks as i32 * 500) + (c.queens as i32 * 900)
    };
    let delta = val(&white) - val(&black);

    let mut summary_parts: Vec<String> = Vec::new();
    if delta.abs() >= 100 {
        summary_parts.push(format!("Material is {} for {} (+{:.1})",
            if delta.abs() < 300 { "slightly off" } else { "off" },
            if delta > 0 { "White" } else { "Black" },
            delta.abs() as f32 / 100.0));
    } else {
        summary_parts.push("Material is even".into());
    }
    if bp_w && !bp_b { summary_parts.push("White has the bishop pair".into()); }
    else if bp_b && !bp_w { summary_parts.push("Black has the bishop pair".into()); }
    if opp_color { summary_parts.push("Opposite-coloured bishops".into()); }

    MaterialAnalysis {
        white, black,
        material_delta_cp: delta,
        bishop_pair_white: bp_w,
        bishop_pair_black: bp_b,
        same_color_bishops: same_color,
        opposite_color_bishops: opp_color,
        minor_pieces_white: minor_w,
        minor_pieces_black: minor_b,
        heavy_pieces_white: heavy_w,
        heavy_pieces_black: heavy_b,
        summary: summary_parts.join("; "),
    }
}

fn count_pieces(board: &Board, color: Color) -> PieceCount {
    let by = board.by_color(color);
    PieceCount {
        pawns: (board.pawns() & by).count() as u32,
        knights: (board.knights() & by).count() as u32,
        bishops: (board.bishops() & by).count() as u32,
        rooks: (board.rooks() & by).count() as u32,
        queens: (board.queens() & by).count() as u32,
    }
}

// ── Pawn structure ──────────────────────────────────────────────────────

fn analyse_pawn_structure(board: &Board) -> PawnStructureAnalysis {
    let white = analyse_pawn_side(board, Color::White);
    let black = analyse_pawn_side(board, Color::Black);

    // *** Agent-existence gate (general philosophy) ***
    //
    // A "weakness" only matters when the opponent has a piece able to
    // exploit it. IQP, hanging pawns, isolated pawns, color-complex —
    // these are middlegame concepts. In a K+P-vs-K endgame, calling
    // the lone d-pawn "isolated" or "an IQP" is meaningless: there
    // are no enemy pieces (other than the king) to attack it.
    //
    // Gate: only flag the structural weakness if the OPPOSING side
    // has at least one minor or heavy piece. Lone-king endings get
    // a clean structural blob.
    let opp_has_force = |color: Color| -> bool {
        let by = board.by_color(color);
        let minors = (board.knights() | board.bishops()) & by;
        let heavies = (board.rooks() | board.queens()) & by;
        (minors | heavies).any()
    };
    let exploit_white = opp_has_force(Color::Black);
    let exploit_black = opp_has_force(Color::White);

    let iqp_w = exploit_white && is_iqp(&pawn_counts_by_file(board, Color::White));
    let iqp_b = exploit_black && is_iqp(&pawn_counts_by_file(board, Color::Black));
    let hp_w  = exploit_white && hanging_pair_present(&pawn_counts_by_file(board, Color::White));
    let hp_b  = exploit_black && hanging_pair_present(&pawn_counts_by_file(board, Color::Black));

    // Color-complex weakness: side has lost a bishop AND ≥3 pawns on
    // that color → that color is structurally weak. Same exploitability
    // gate: a "weak color complex" is meaningless when the opponent has
    // nothing to play on those squares.
    let (light_w, dark_w) = pawns_by_color(board, Color::White);
    let (light_b, dark_b) = pawns_by_color(board, Color::Black);
    let bishops_w_light = bishops_on_color(board, Color::White, true);
    let bishops_w_dark  = bishops_on_color(board, Color::White, false);
    let bishops_b_light = bishops_on_color(board, Color::Black, true);
    let bishops_b_dark  = bishops_on_color(board, Color::Black, false);
    let mut light_weak = None;
    let mut dark_weak = None;
    if exploit_white && !bishops_w_light && light_w >= 3 { light_weak = Some("white".into()); }
    if exploit_black && !bishops_b_light && light_b >= 3 { light_weak = Some("black".into()); }
    if exploit_white && !bishops_w_dark && dark_w >= 3 { dark_weak = Some("white".into()); }
    if exploit_black && !bishops_b_dark && dark_b >= 3 { dark_weak = Some("black".into()); }

    // Same gate on the per-side pawn analysis: prune isolated/backward
    // markers when there's no exploiter. This is what kills "White's
    // pawn on d5 is isolated" in a K+P vs K endgame.
    let mut white_pruned = white;
    let mut black_pruned = black;
    if !exploit_white {
        white_pruned.isolated.clear();
        white_pruned.backward.clear();
    }
    if !exploit_black {
        black_pruned.isolated.clear();
        black_pruned.backward.clear();
    }
    let white = white_pruned;
    let black = black_pruned;

    let mut summary_parts: Vec<String> = Vec::new();
    if iqp_w { summary_parts.push("White has an IQP".into()); }
    if iqp_b { summary_parts.push("Black has an IQP".into()); }
    if !white.passed.is_empty() { summary_parts.push(format!("White passed pawns: {}", white.passed.join(", "))); }
    if !black.passed.is_empty() { summary_parts.push(format!("Black passed pawns: {}", black.passed.join(", "))); }
    if !white.isolated.is_empty() { summary_parts.push(format!("White isolated: {}", white.isolated.join(", "))); }
    if !black.isolated.is_empty() { summary_parts.push(format!("Black isolated: {}", black.isolated.join(", "))); }

    PawnStructureAnalysis {
        white, black,
        light_complex_weak: light_weak,
        dark_complex_weak: dark_weak,
        iqp_white: iqp_w,
        iqp_black: iqp_b,
        hanging_pawns_white: hp_w,
        hanging_pawns_black: hp_b,
        summary: if summary_parts.is_empty() { "Solid pawn structure on both sides".into() } else { summary_parts.join("; ") },
    }
}

fn analyse_pawn_side(board: &Board, color: Color) -> PawnSideAnalysis {
    let pawns = board.pawns() & board.by_color(color);
    let mut counts = [0u8; 8];
    for s in pawns { counts[s.file() as usize] += 1; }

    // Pawn islands: count contiguous file-runs of friendly pawns.
    let mut islands = 0u32;
    let mut in_island = false;
    for &c in &counts {
        if c > 0 && !in_island { islands += 1; in_island = true; }
        else if c == 0 { in_island = false; }
    }

    let mut doubled_files = Vec::new();
    let mut isolated = Vec::new();
    let mut backward = Vec::new();
    let mut passed = Vec::new();
    let mut supported = Vec::new();
    let mut holes = Vec::new(); // squares enemy can never hit with a pawn

    for s in pawns {
        let f = s.file() as usize;
        if counts[f] >= 2 && !doubled_files.iter().any(|x: &String| x == &file_letter_string(f)) {
            doubled_files.push(file_letter_string(f));
        }
        let left = if f > 0 { counts[f - 1] } else { 0 };
        let right = if f < 7 { counts[f + 1] } else { 0 };
        if left == 0 && right == 0 {
            isolated.push(s.to_string());
        }
        if is_backward(board, s, color) { backward.push(s.to_string()); }
        if is_passed(board, s, color) { passed.push(s.to_string()); }
        if is_supported(board, s, color) { supported.push(s.to_string()); }
    }

    // Holes: squares in our territory that no friendly pawn can ever
    // re-defend (because the supporting pawn has been pushed past them
    // or isn't there).
    let enemy_color = color.other();
    for f in 0..8 {
        let advance_rank = match color { Color::White => 5, Color::Black => 2 };
        for r in match color { Color::White => 3..=5, Color::Black => 2..=4 } {
            let sq = Square::from_coords(File::new(f as u32), Rank::new(r));
            // Square owned by `color`'s territory; can opp put a pawn-defended piece here?
            // If neither (f-1) nor (f+1) friendly pawn exists at rank ≤ r (white) / ≥ r (black),
            // it's a hole.
            let supports_present = (f > 0 && counts[f - 1] > 0) || (f < 7 && counts[f + 1] > 0);
            if !supports_present {
                // and there's an enemy pawn that already passed it (file blocking)?
                let _ = advance_rank;
                let _ = enemy_color;
                holes.push(sq.to_string());
                break; // one per file is enough to flag
            }
        }
    }
    holes.sort();

    // Majority side: more pawns on one wing than enemy has on that wing.
    let qside_us: u32 = (counts[0] + counts[1] + counts[2] + counts[3]) as u32;
    let kside_us: u32 = (counts[4] + counts[5] + counts[6] + counts[7]) as u32;
    let mut counts_them = [0u8; 8];
    for s in board.pawns() & board.by_color(color.other()) { counts_them[s.file() as usize] += 1; }
    let qside_them: u32 = (counts_them[0] + counts_them[1] + counts_them[2] + counts_them[3]) as u32;
    let kside_them: u32 = (counts_them[4] + counts_them[5] + counts_them[6] + counts_them[7]) as u32;
    let majority_side = if qside_us > qside_them { Some("queenside".into()) }
        else if kside_us > kside_them { Some("kingside".into()) }
        else { None };

    // Pawn chains: count contiguous diagonal pawn supports.
    let mut chains = 0u32;
    for s in pawns {
        if is_supported(board, s, color) { chains += 1; }
    }

    PawnSideAnalysis {
        islands,
        doubled_files,
        isolated,
        backward,
        passed,
        supported,
        holes,
        majority_side,
        pawn_chains: chains,
    }
}

fn pawn_counts_by_file(board: &Board, color: Color) -> [u8; 8] {
    let mut counts = [0u8; 8];
    for s in board.pawns() & board.by_color(color) { counts[s.file() as usize] += 1; }
    counts
}
fn is_iqp(c: &[u8; 8]) -> bool { c[3] >= 1 && c[2] == 0 && c[4] == 0 }
fn hanging_pair_present(c: &[u8; 8]) -> bool {
    (c[2] >= 1 && c[3] >= 1 && c[1] == 0 && c[4] == 0) ||
    (c[3] >= 1 && c[4] >= 1 && c[2] == 0 && c[5] == 0)
}
fn pawns_by_color(board: &Board, color: Color) -> (u32, u32) {
    let mut light = 0;
    let mut dark = 0;
    for s in board.pawns() & board.by_color(color) {
        if (s.file() as u8 + s.rank() as u8) % 2 == 1 { light += 1; } else { dark += 1; }
    }
    (light, dark)
}
fn bishops_on_color(board: &Board, color: Color, light: bool) -> bool {
    for s in board.bishops() & board.by_color(color) {
        let is_light = (s.file() as u8 + s.rank() as u8) % 2 == 1;
        if is_light == light { return true; }
    }
    false
}
fn is_backward(board: &Board, sq: Square, color: Color) -> bool {
    let f = sq.file() as i32;
    let r = sq.rank() as i32;
    let fwd = if color == Color::White { 1 } else { -1 };
    for df in [-1, 1] {
        let nf = f + df;
        if !(0..8).contains(&nf) { continue; }
        for nr in 0..8 {
            let s = Square::from_coords(File::new(nf as u32), Rank::new(nr));
            if let Some(p) = board.piece_at(s) {
                if p.role == Role::Pawn && p.color == color {
                    if (color == Color::White && nr as i32 <= r) || (color == Color::Black && (nr as i32) >= r) {
                        return false;
                    }
                }
            }
        }
    }
    let r2 = r + 2 * fwd;
    if !(0..8).contains(&r2) { return false; }
    for df in [-1, 1] {
        let nf = f + df;
        if !(0..8).contains(&nf) { continue; }
        let s = Square::from_coords(File::new(nf as u32), Rank::new(r2 as u32));
        if let Some(p) = board.piece_at(s) {
            if p.role == Role::Pawn && p.color != color { return true; }
        }
    }
    false
}
fn is_passed(board: &Board, sq: Square, color: Color) -> bool {
    let enemy = board.pawns() & board.by_color(color.other());
    let f = sq.file() as i32;
    let r = sq.rank() as i32;
    for df in [-1, 0, 1] {
        let nf = f + df;
        if !(0..8).contains(&nf) { continue; }
        for nr in 0..8 {
            let s = Square::from_coords(File::new(nf as u32), Rank::new(nr));
            if !enemy.contains(s) { continue; }
            if (color == Color::White && nr as i32 > r) || (color == Color::Black && (nr as i32) < r) {
                return false;
            }
        }
    }
    true
}
fn is_supported(board: &Board, sq: Square, color: Color) -> bool {
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
fn file_letter_string(f: usize) -> String {
    String::from((b'a' + f as u8) as char)
}

// ── King safety ─────────────────────────────────────────────────────────

fn analyse_king_safety_both(board: &Board) -> BothSidesKingSafety {
    let white = analyse_king_side(board, Color::White);
    let black = analyse_king_side(board, Color::Black);
    let summary = if white.danger_score > black.danger_score + 100 {
        format!("Black king safer (white danger {} vs black {})", white.danger_score, black.danger_score)
    } else if black.danger_score > white.danger_score + 100 {
        format!("White king safer (black danger {} vs white {})", black.danger_score, white.danger_score)
    } else {
        "King safety roughly balanced".into()
    };
    BothSidesKingSafety { white, black, summary }
}

fn analyse_king_side(board: &Board, color: Color) -> KingSideAnalysis {
    let king_sq = match board.king_of(color) {
        Some(s) => s,
        None => {
            return KingSideAnalysis {
                king_square: "??".into(), castled: false,
                castling_rights_kingside: false, castling_rights_queenside: false,
                pawn_shield_score: 0, attacker_count: 0, attackers: vec![],
                open_files_to_king: vec![], half_open_files_to_king: vec![],
                weak_diagonals_to_king: vec![], escape_squares_count: 0,
                danger_score: 0,
            };
        }
    };
    let kf = king_sq.file() as i32;
    let kr = king_sq.rank() as i32;
    let castled = match color {
        Color::White => king_sq == Square::G1 || king_sq == Square::C1,
        Color::Black => king_sq == Square::G8 || king_sq == Square::C8,
    };

    // Pawn shield: 3 squares directly in front of king on king's wing.
    let shield_rank = match color { Color::White => kr + 1, Color::Black => kr - 1 };
    let mut shield_score = 0i32;
    if (0..8).contains(&shield_rank) {
        for df in [-1, 0, 1] {
            let nf = kf + df;
            if !(0..8).contains(&nf) { continue; }
            let s = Square::from_coords(File::new(nf as u32), Rank::new(shield_rank as u32));
            if let Some(p) = board.piece_at(s) {
                if p.role == Role::Pawn && p.color == color { shield_score += 33; }
            }
        }
    }

    // Attacker count in 3x3 zone.
    let mut zone = Bitboard::EMPTY;
    for df in -1..=1 { for dr in -1..=1 {
        let f = kf + df; let r = kr + dr;
        if !(0..8).contains(&f) || !(0..8).contains(&r) { continue; }
        zone |= Bitboard::from_square(Square::from_coords(File::new(f as u32), Rank::new(r as u32)));
    }}
    let occ = board.occupied();
    let enemy = color.other();
    let mut attackers = Vec::new();
    let mut weight: i32 = 0;
    for sq in board.by_color(enemy) {
        let p = match board.piece_at(sq) { Some(p) => p, None => continue };
        let atk = match p.role {
            Role::Pawn => pawn_attacks(p.color, sq),
            Role::Knight => knight_attacks(sq),
            Role::Bishop => bishop_attacks(sq, occ),
            Role::Rook => rook_attacks(sq, occ),
            Role::Queen => queen_attacks(sq, occ),
            Role::King => king_attacks(sq),
        };
        let hits = (atk & zone).count() as i32;
        if hits > 0 {
            attackers.push(AttackerRef {
                square: sq.to_string(),
                role: role_name(p.role).into(),
            });
            weight += hits * match p.role {
                Role::Pawn => 5, Role::Knight => 81, Role::Bishop => 52,
                Role::Rook => 44, Role::Queen => 10, Role::King => 0,
            };
        }
    }

    // Open / half-open files in front of king.
    let mut open_files = Vec::new();
    let mut half_open = Vec::new();
    for df in [-1, 0, 1] {
        let nf = kf + df;
        if !(0..8).contains(&nf) { continue; }
        let mut my_pawns = 0;
        let mut their_pawns = 0;
        for r in 0..8 {
            let s = Square::from_coords(File::new(nf as u32), Rank::new(r));
            if let Some(p) = board.piece_at(s) {
                if p.role == Role::Pawn {
                    if p.color == color { my_pawns += 1; }
                    else { their_pawns += 1; }
                }
            }
        }
        // *** Agent-existence gate ***
        //
        // The previous version added the file to `open_files_to_king` /
        // `half_open_files_to_king` purely on geometric grounds (no own
        // pawn on the file). That fired even when the opponent had no
        // R/Q anywhere — a king "exposed" on a file no enemy slider can
        // ever reach is not actually exposed.
        //
        // Now: only flag the file when the enemy ACTUALLY has a rook or
        // queen capable of operating on it (either already there, or
        // sitting on the file with a clear path of squares it can
        // travel along). Same generalised principle should be applied
        // to every "weakness" / "exposure" claim across the analyzer:
        // a claim must name an agent that can act on it.
        let f_letter = file_letter_string(nf as usize);
        let enemy_has_slider_on_file = enemy_can_use_file(board, nf as u32, enemy);
        if !enemy_has_slider_on_file {
            // Not actionable — the king isn't actually exposed on this
            // file, however empty it looks.
            continue;
        }
        if my_pawns == 0 && their_pawns == 0 { open_files.push(f_letter); }
        else if my_pawns == 0 { half_open.push(f_letter); }
    }

    // Weak diagonals: long diagonals exposed to the king. Only claim if
    // the enemy has a B/Q that can actually swing onto that diagonal.
    let mut weak_diags = Vec::new();
    if king_sq == Square::G1 || king_sq == Square::H1
        || king_sq == Square::G8 || king_sq == Square::H8 {
        if enemy_has_slider_on_long_diag(board, false /* h1-a8 */, enemy) {
            weak_diags.push("h1-a8".into());
        }
    }
    if king_sq == Square::A1 || king_sq == Square::B1
        || king_sq == Square::A8 || king_sq == Square::B8 {
        if enemy_has_slider_on_long_diag(board, true /* a1-h8 */, enemy) {
            weak_diags.push("a1-h8".into());
        }
    }

    // Escape squares: empty squares around the king not attacked by enemy.
    let mut escape_count = 0u32;
    let king_attacks_bb = king_attacks(king_sq);
    let mut enemy_attack_set = Bitboard::EMPTY;
    for s in board.by_color(enemy) {
        if let Some(p) = board.piece_at(s) {
            enemy_attack_set |= match p.role {
                Role::Pawn => pawn_attacks(p.color, s),
                Role::Knight => knight_attacks(s),
                Role::Bishop => bishop_attacks(s, occ),
                Role::Rook => rook_attacks(s, occ),
                Role::Queen => queen_attacks(s, occ),
                Role::King => king_attacks(s),
            };
        }
    }
    for s in king_attacks_bb {
        if let Some(p) = board.piece_at(s) {
            if p.color == color { continue; }
        }
        if !enemy_attack_set.contains(s) { escape_count += 1; }
    }

    let mut danger_score = weight;
    if !castled { danger_score += 50; }
    danger_score += (3 - (shield_score / 33)) * 30; // missing shield pawns
    danger_score += open_files.len() as i32 * 80;
    danger_score += half_open.len() as i32 * 40;
    if escape_count == 0 { danger_score += 100; }

    let cr = match color {
        Color::White => (true, true),
        Color::Black => (true, true),
    };
    let _ = cr; // currently we don't have direct access to castles in this scope

    KingSideAnalysis {
        king_square: king_sq.to_string(),
        castled,
        castling_rights_kingside: false,  // filled via Chess::castles in JS layer if needed
        castling_rights_queenside: false,
        pawn_shield_score: shield_score,
        attacker_count: attackers.len() as u32,
        attackers,
        open_files_to_king: open_files,
        half_open_files_to_king: half_open,
        weak_diagonals_to_king: weak_diags,
        escape_squares_count: escape_count,
        danger_score: danger_score.min(1000),
    }
}

// ── Activity ────────────────────────────────────────────────────────────

fn analyse_activity_both(board: &Board) -> BothSidesActivity {
    let white = analyse_activity(board, Color::White);
    let black = analyse_activity(board, Color::Black);
    let summary = if white.total_mobility > black.total_mobility + 8 {
        format!("White has more piece activity ({} vs {} squares)", white.total_mobility, black.total_mobility)
    } else if black.total_mobility > white.total_mobility + 8 {
        format!("Black has more piece activity ({} vs {} squares)", black.total_mobility, white.total_mobility)
    } else {
        "Activity roughly balanced".into()
    };
    BothSidesActivity { white, black, summary }
}

fn analyse_activity(board: &Board, color: Color) -> ActivitySideAnalysis {
    let occ = board.occupied();
    let mut total_mob = 0u32;
    let mut enemy_half = 0u32;
    let mut central_minors = 0u32;
    let mut outposts = Vec::new();
    let mut bad_bishop = None;
    let mut passive = Vec::new();
    let mut long_diag = Vec::new();

    for sq in board.by_color(color) {
        let p = match board.piece_at(sq) { Some(p) => p, None => continue };
        let attacks = match p.role {
            Role::Pawn => pawn_attacks(p.color, sq),
            Role::Knight => knight_attacks(sq),
            Role::Bishop => bishop_attacks(sq, occ),
            Role::Rook => rook_attacks(sq, occ),
            Role::Queen => queen_attacks(sq, occ),
            Role::King => king_attacks(sq),
        };
        let safe_attacks = attacks & !board.by_color(color);
        total_mob += safe_attacks.count() as u32;

        // Squares in opp half attacked. shakmaty doesn't ship a SOUTH_HALF
        // const so we count manually: ranks 4-7 = white's "attack" half;
        // ranks 0-3 = black's.
        let mut count_in_enemy_half = 0u32;
        for s in safe_attacks {
            let rank = s.rank() as i32;
            let in_opp_half = match color {
                Color::White => rank >= 4,
                Color::Black => rank <= 3,
            };
            if in_opp_half { count_in_enemy_half += 1; }
        }
        enemy_half += count_in_enemy_half;

        if matches!(p.role, Role::Knight | Role::Bishop) {
            let f = sq.file() as i32;
            let r = sq.rank() as i32;
            if (2..=5).contains(&f) && (3..=4).contains(&r) {
                central_minors += 1;
            }
        }

        // Outposts.
        if matches!(p.role, Role::Knight | Role::Bishop) && is_outpost(board, sq, p) {
            outposts.push(OutpostRef { square: sq.to_string(), piece: role_name(p.role).into() });
        }

        // Bad bishop: ≥5 friendly pawns on the bishop's color.
        if p.role == Role::Bishop {
            let light = (sq.file() as u8 + sq.rank() as u8) % 2 == 1;
            let mut blockers = 0;
            for ps in board.pawns() & board.by_color(color) {
                let pl = (ps.file() as u8 + ps.rank() as u8) % 2 == 1;
                if pl == light { blockers += 1; }
            }
            if blockers >= 5 { bad_bishop = Some(sq.to_string()); }
        }

        // Passive: non-king, non-pawn pieces with mobility ≤ 2.
        if matches!(p.role, Role::Knight | Role::Bishop | Role::Rook | Role::Queen) {
            if safe_attacks.count() <= 2 { passive.push(sq.to_string()); }
        }

        // Long-diagonal control (B/Q only).
        if matches!(p.role, Role::Bishop | Role::Queen) {
            let f = sq.file() as i32;
            let r = sq.rank() as i32;
            if f == r { long_diag.push("a1-h8".into()); }
            else if f == 7 - r { long_diag.push("h1-a8".into()); }
        }
    }

    // Dedupe diagonals.
    long_diag.sort(); long_diag.dedup();

    ActivitySideAnalysis {
        total_mobility: total_mob,
        squares_in_enemy_half: enemy_half,
        central_minor_pieces: central_minors,
        outposts,
        bad_bishop,
        passive_pieces: passive,
        long_diagonals_controlled: long_diag,
    }
}

fn is_outpost(board: &Board, sq: Square, piece: Piece) -> bool {
    let r = sq.rank() as i32;
    if piece.color == Color::White && r < 4 { return false; }
    if piece.color == Color::Black && r > 3 { return false; }
    let enemy = piece.color.other();
    let f = sq.file() as i32;
    for df in [-1, 1] {
        let nf = f + df;
        if !(0..8).contains(&nf) { continue; }
        for nr in 0..8 {
            let s = Square::from_coords(File::new(nf as u32), Rank::new(nr));
            if let Some(p) = board.piece_at(s) {
                if p.role == Role::Pawn && p.color == enemy {
                    if piece.color == Color::White && nr as i32 >= r + 1 { return false; }
                    if piece.color == Color::Black && (nr as i32) <= r - 1 { return false; }
                }
            }
        }
    }
    true
}

// ── Line control ────────────────────────────────────────────────────────

fn analyse_line_control(board: &Board) -> LineControl {
    let mut open_files = Vec::new();
    let mut half_w = Vec::new();
    let mut half_b = Vec::new();
    for f in 0..8 {
        let mut my_w = 0; let mut my_b = 0;
        let mut rq_w = false; let mut rq_b = false;
        for r in 0..8 {
            let s = Square::from_coords(File::new(f as u32), Rank::new(r));
            if let Some(p) = board.piece_at(s) {
                if p.role == Role::Pawn {
                    if p.color == Color::White { my_w += 1; } else { my_b += 1; }
                }
                if matches!(p.role, Role::Rook | Role::Queen) {
                    if p.color == Color::White { rq_w = true; } else { rq_b = true; }
                }
            }
        }
        let fl = file_letter_string(f as usize);
        if my_w == 0 && my_b == 0 {
            let ctrl = if rq_w && !rq_b { Some("white".into()) }
                else if rq_b && !rq_w { Some("black".into()) }
                else { None };
            open_files.push(FileControl { file: fl.clone(), controlling_side: ctrl });
        } else {
            if my_w == 0 { half_w.push(fl.clone()); }
            if my_b == 0 { half_b.push(fl.clone()); }
        }
    }

    // Long diagonals. For each, find slider on it with clear path.
    let long_a1h8 = control_of_long_diag(board, true);
    let long_h1a8 = control_of_long_diag(board, false);

    // 7th-rank rooks.
    let mut r7w = Vec::new();
    let mut r7b = Vec::new();
    for sq in board.rooks() & board.by_color(Color::White) {
        if sq.rank() == Rank::Seventh { r7w.push(sq.to_string()); }
    }
    for sq in board.rooks() & board.by_color(Color::Black) {
        if sq.rank() == Rank::Second { r7b.push(sq.to_string()); }
    }
    let seventh_dom = if !r7w.is_empty() && r7b.is_empty() { Some("white".into()) }
        else if !r7b.is_empty() && r7w.is_empty() { Some("black".into()) }
        else { None };

    LineControl {
        open_files,
        half_open_files_white: half_w,
        half_open_files_black: half_b,
        long_diagonal_a1h8: long_a1h8,
        long_diagonal_h1a8: long_h1a8,
        rook_seventh_white: r7w,
        rook_seventh_black: r7b,
        seventh_rank_dominant: seventh_dom,
    }
}

/// "Control" of a long diagonal — strict agent + reach test.
///
/// Old version counted any B/Q sitting on the diagonal whose attack set
/// touched ≥ 4 diagonal squares — but that fired in tons of positions
/// where the diagonal was actually blocked, or where the slider couldn't
/// reach the squares that matter. The user's complaint: "the controlling
/// diagonal is faulty."
///
/// New criterion: a side controls the diagonal iff it has a B/Q on the
/// diagonal whose unblocked reach covers most of the long-diagonal
/// squares (≥ 4 of 8), AND the OPPOSITE side has no comparable presence
/// on the same diagonal. Blockers belonging to the controlling side
/// don't count against them, but enemy pieces sitting on the diagonal
/// neutralise the claim.
fn control_of_long_diag(board: &Board, a1h8: bool) -> Option<String> {
    let occ = board.occupied();
    let mut white_reach = 0;
    let mut black_reach = 0;
    let mut white_obstructs = 0;
    let mut black_obstructs = 0;
    for i in 0..8 {
        let f = i as u32;
        let r = if a1h8 { i as u32 } else { (7 - i) as u32 };
        let s = Square::from_coords(File::new(f), Rank::new(r));
        let p = match board.piece_at(s) { Some(p) => p, None => continue };

        // A B/Q on the diagonal: count its unblocked diagonal coverage.
        if matches!(p.role, Role::Bishop | Role::Queen) {
            let attacks = if p.role == Role::Bishop {
                bishop_attacks(s, occ)
            } else {
                queen_attacks(s, occ)
            };
            let on_diag_attacks = (0..8).filter(|j| {
                let s2 = Square::from_coords(
                    File::new(*j as u32),
                    Rank::new(if a1h8 { *j as u32 } else { (7 - *j) as u32 }),
                );
                attacks.contains(s2) || s2 == s
            }).count();
            // "Control" means ≥ 4 squares of the diagonal are reachable
            // (including the slider's own square). Less than that = the
            // slider is just sitting there, blocked.
            if on_diag_attacks >= 4 {
                if p.color == Color::White { white_reach += 1; } else { black_reach += 1; }
            } else if p.color == Color::White { white_obstructs += 1; }
            else { black_obstructs += 1; }
        } else {
            // Any non-slider piece on the diagonal is a blocker — counts
            // against whichever side it belongs to in terms of fighting
            // for control.
            if p.color == Color::White { white_obstructs += 1; }
            else { black_obstructs += 1; }
        }
    }

    // Side has CLEAR control: their slider has the long reach AND the
    // opponent has no comparable slider AND no enemy obstructs heavily.
    if white_reach > 0 && black_reach == 0 && black_obstructs <= 2 {
        Some("white".into())
    } else if black_reach > 0 && white_reach == 0 && white_obstructs <= 2 {
        Some("black".into())
    } else {
        None
    }
}

// ── Agent-existence helpers ─────────────────────────────────────────────
//
// General philosophy: any "weakness" or "exposure" claim must name a
// real piece that can act on it. These helpers wrap the geometry check
// with an existence check.

/// Does `enemy` have a rook or queen that can operate on file `file`?
/// "Operate" = either already on that file, or it has a free path to
/// reach it within ~3 plies (we approximate: any R/Q whose current
/// attacks intersect the file). This guards `open_files_to_king` so
/// "exposed on the d-file" only fires when there's something to do
/// the exposing.
fn enemy_can_use_file(board: &Board, file: u32, enemy: Color) -> bool {
    let occ = board.occupied();
    let enemies = board.by_color(enemy);
    let rq = (board.rooks() | board.queens()) & enemies;
    for sq in rq {
        // Already on the file?
        if sq.file() as u32 == file { return true; }
        // Or can reach the file in one move? Get attack set, intersect
        // with any square on the file, see if it hits.
        let attacks = match board.piece_at(sq).map(|p| p.role) {
            Some(Role::Rook) => rook_attacks(sq, occ),
            Some(Role::Queen) => queen_attacks(sq, occ),
            _ => continue,
        };
        for r in 0..8 {
            let s = Square::from_coords(File::new(file), Rank::new(r));
            if attacks.contains(s) { return true; }
        }
    }
    false
}

/// Does `enemy` have a bishop or queen that can operate on the long
/// diagonal? a1h8=true means a1-h8 (dark squares), false means h1-a8
/// (light squares).
fn enemy_has_slider_on_long_diag(board: &Board, a1h8: bool, enemy: Color) -> bool {
    let occ = board.occupied();
    let enemies = board.by_color(enemy);
    let bq = (board.bishops() | board.queens()) & enemies;
    for sq in bq {
        let role = match board.piece_at(sq).map(|p| p.role) { Some(r) => r, None => continue };
        let attacks = if role == Role::Bishop { bishop_attacks(sq, occ) } else { queen_attacks(sq, occ) };
        // Already on the diagonal, or attacks one of its squares.
        for i in 0..8 {
            let f = i as u32;
            let r = if a1h8 { i as u32 } else { (7 - i) as u32 };
            let s = Square::from_coords(File::new(f), Rank::new(r));
            if attacks.contains(s) || sq == s { return true; }
        }
    }
    false
}

// ── Tactics ─────────────────────────────────────────────────────────────

fn analyse_tactics(pos: &Chess) -> TacticsAnalysis {
    let board = pos.board();
    let mut hw = Vec::new();
    let mut hb = Vec::new();
    for sq in board.by_color(Color::White) {
        let p = match board.piece_at(sq) { Some(p) => p, None => continue };
        if p.role == Role::King { continue; }
        if let Some(loss) = hanging_loss(board, sq) {
            hw.push(HangingRef { square: sq.to_string(), role: role_name(p.role).into(), loss_cp: loss });
        }
    }
    for sq in board.by_color(Color::Black) {
        let p = match board.piece_at(sq) { Some(p) => p, None => continue };
        if p.role == Role::King { continue; }
        if let Some(loss) = hanging_loss(board, sq) {
            hb.push(HangingRef { square: sq.to_string(), role: role_name(p.role).into(), loss_cp: loss });
        }
    }
    let in_check = if pos.is_check() {
        Some(if pos.turn() == Color::White { "white".into() } else { "black".into() })
    } else { None };

    // Pinned pieces: scan rays from each king, find pieces blocking checks.
    let pinned = collect_pinned(board);

    TacticsAnalysis {
        hanging_white: hw,
        hanging_black: hb,
        pinned_pieces: pinned,
        pieces_in_check: in_check,
    }
}

fn collect_pinned(board: &Board) -> Vec<PinnedRef> {
    let mut out = Vec::new();
    for color in [Color::White, Color::Black] {
        let king_sq = match board.king_of(color) { Some(s) => s, None => continue };
        let occ = board.occupied();
        // For each enemy slider, check if it's aimed at our king through
        // exactly one of our pieces.
        let enemy_sliders =
            (board.bishops() | board.rooks() | board.queens()) & board.by_color(color.other());
        for s in enemy_sliders {
            let role = match board.piece_at(s).map(|p| p.role) { Some(r) => r, None => continue };
            // Only valid ray dirs.
            let dirs: &[(i32,i32)] = match role {
                Role::Rook => &[(1,0),(-1,0),(0,1),(0,-1)],
                Role::Bishop => &[(1,1),(-1,1),(1,-1),(-1,-1)],
                Role::Queen => &[(1,0),(-1,0),(0,1),(0,-1),(1,1),(-1,1),(1,-1),(-1,-1)],
                _ => continue,
            };
            let (sf, sr) = (s.file() as i32, s.rank() as i32);
            for &(df, dr) in dirs {
                let mut blocker: Option<Square> = None;
                let mut found_king = false;
                for i in 1..8 {
                    let f = sf + df * i;
                    let r = sr + dr * i;
                    if !(0..8).contains(&f) || !(0..8).contains(&r) { break; }
                    let sq = Square::from_coords(File::new(f as u32), Rank::new(r as u32));
                    if let Some(p) = board.piece_at(sq) {
                        if p.color == color {
                            // Our piece; if it's the king, slider is checking.
                            // Otherwise it's a candidate blocker.
                            if p.role == Role::King {
                                if blocker.is_some() { found_king = true; }
                                break;
                            }
                            if blocker.is_some() { break; } // two blockers: not pinned
                            blocker = Some(sq);
                        } else {
                            // enemy piece: blocker isn't ours
                            break;
                        }
                    }
                    let _ = occ;
                }
                if found_king {
                    if let Some(bsq) = blocker {
                        if let Some(bp) = board.piece_at(bsq) {
                            out.push(PinnedRef {
                                square: bsq.to_string(),
                                role: role_name(bp.role).into(),
                                pinned_to_role: "king".into(),
                                pinned_to_square: king_sq.to_string(),
                                absolute: true,
                            });
                        }
                    }
                }
            }
        }
    }
    out
}

// ── Endgame analysis ────────────────────────────────────────────────────
//
// The textbook king-and-pawn-endgame primitives: opposition, key squares,
// the square of the pawn. These are what decide K+P-vs-K — a +5.76
// "winning" eval vs +0.22 "drawn" depending on which king move you find,
// and the analyzer should EXPLAIN that.
//
// Definitions used here:
//
//   * **Opposition**: kings on the same file, rank, or diagonal, an
//     ODD number of squares apart (1 or 3 — direct or distant). The
//     side NOT to move has the opposition; the side to move is forced
//     to give way.
//   * **Key squares (for a d/c/e/f-pawn)**: the three squares two ranks
//     ahead of the pawn — for a d-pawn on rank N, the key squares are
//     c(N+2), d(N+2), e(N+2). White king on any of them wins the
//     ending. (For rook pawns the rule is different — handled below.)
//   * **Square of the pawn**: a passed pawn promotes alone unless the
//     defending king can step into a square whose corner is the pawn,
//     side = remaining ranks to promote.

fn analyse_endgame(board: &Board, stm: Color, phase_str: &str) -> EndgameAnalysis {
    if phase_str != "endgame" {
        return EndgameAnalysis::default();
    }

    // King-and-pawn-(-vs-king-)-only endgame check.
    let no_minors_or_heavies = (board.knights() | board.bishops()
                              | board.rooks()   | board.queens()).is_empty();

    let opposition = detect_opposition(board, stm);
    let mut key_squares = Vec::new();
    let mut square_of_pawn = Vec::new();
    let mut summary_parts: Vec<String> = Vec::new();

    if no_minors_or_heavies {
        // Per-passed-pawn key-square + square-of-pawn analysis.
        for color in [Color::White, Color::Black] {
            let pawns = board.pawns() & board.by_color(color);
            for sq in pawns {
                if !is_passed(board, sq, color) { continue; }
                let key = key_squares_for_pawn(sq, color);
                let our_king = board.king_of(color);
                let their_king = board.king_of(color.other());
                let mut controlled_by: Option<String> = None;
                if let Some(k) = our_king {
                    if key.contains(&k) {
                        controlled_by = Some(if color == Color::White { "white".into() } else { "black".into() });
                    }
                }
                if controlled_by.is_none() {
                    if let Some(k) = their_king {
                        if key.contains(&k) {
                            // The defender's king on a "key square" actually denies the
                            // attacker the win — note that nuance.
                            controlled_by = Some(if color == Color::White { "black".into() } else { "white".into() });
                        }
                    }
                }
                let key_strs: Vec<String> = key.iter().map(|s| s.to_string()).collect();
                let owner_cap = if color == Color::White { "White" } else { "Black" };
                let pawn_color_str = if color == Color::White { "white" } else { "black" };
                let description = match controlled_by.as_deref() {
                    Some(c) if c == pawn_color_str =>
                        format!("{}'s king occupies a key square for the {} pawn — winning ending",
                                owner_cap, sq),
                    Some(c) =>
                        format!("{} king on a key square denies {}'s {} pawn its winning route",
                                if c == "white" { "White" } else { "Black" }, owner_cap, sq),
                    None =>
                        format!("Key squares for {}'s {} pawn: {}",
                                owner_cap, sq, key_strs.join(", ")),
                };
                key_squares.push(KeySquareClaim {
                    pawn_color: pawn_color_str.to_string(),
                    pawn_square: sq.to_string(),
                    key_squares: key_strs,
                    controlled_by: controlled_by.clone(),
                    description,
                });

                // Square of the pawn (only meaningful with a lone defender king).
                let defending_king = if color == Color::White {
                    board.king_of(Color::Black)
                } else {
                    board.king_of(Color::White)
                };
                if let Some(dk) = defending_king {
                    let in_sq = defender_in_square(sq, color, dk, stm);
                    let owner_cap = if color == Color::White { "White" } else { "Black" };
                    square_of_pawn.push(SquareOfPawnInfo {
                        pawn_color: if color == Color::White { "white".into() } else { "black".into() },
                        pawn_square: sq.to_string(),
                        defender_in_square: in_sq,
                        description: if in_sq {
                            format!("{}'s king is inside the square of the {} pawn — can catch it",
                                    if color == Color::White { "Black" } else { "White" }, sq)
                        } else {
                            format!("The {} pawn races free — {} king can't catch it without help",
                                    sq, if color == Color::White { "Black" } else { "White" })
                        },
                    });
                }
            }
        }
    }

    // Compose a summary that captures the headline ("Kc6 wins both
    // opposition and a key square"-style synthesis).
    if let Some(o) = &opposition {
        summary_parts.push(format!("{} has the {} opposition",
            cap_first(&o.holder), o.kind));
    }
    for k in &key_squares {
        if let Some(c) = &k.controlled_by {
            if c == &k.pawn_color {
                summary_parts.push(format!("{} king on a key square for the {} pawn",
                    cap_first(c), k.pawn_square));
            }
        }
    }

    EndgameAnalysis {
        is_endgame: true,
        is_king_pawn_endgame: no_minors_or_heavies && (board.pawns()).any(),
        opposition,
        key_squares,
        square_of_pawn,
        summary: summary_parts.join("; "),
    }
}

fn cap_first(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) => c.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}

/// Detect opposition between kings. Returns None if no opposition.
/// Side NOT to move is the holder of the opposition (zugzwang on the
/// side to move).
fn detect_opposition(board: &Board, stm: Color) -> Option<OppositionInfo> {
    let wk = board.king_of(Color::White)?;
    let bk = board.king_of(Color::Black)?;
    let wf = wk.file() as i32; let wr = wk.rank() as i32;
    let bf = bk.file() as i32; let br = bk.rank() as i32;

    let same_file = wf == bf;
    let same_rank = wr == br;
    let same_diag = (wf - bf).abs() == (wr - br).abs();
    if !(same_file || same_rank || same_diag) { return None; }

    let dist = (wf - bf).abs().max((wr - br).abs());
    // Direct opposition: distance 2 (1 square between). Distant: 4.
    let kind = match dist {
        2 => "direct",
        4 => "distant",
        _ => return None,
    };
    // Side NOT to move has the opposition.
    let holder_color = stm.other();
    let holder = if holder_color == Color::White { "white" } else { "black" };
    let line = if same_file { format!("{}-file", file_letter_string(wf as usize)) }
        else if same_rank { format!("rank {}", wr + 1) }
        else { format!("{}-{} diagonal",
            wk.to_string(), bk.to_string()) };
    let kind_word = if same_diag { "diagonal" } else { kind };
    let description = format!("{} has the {} opposition along the {} — {} is in zugzwang",
        cap_first(holder),
        kind_word,
        line,
        if stm == Color::White { "White" } else { "Black" });
    Some(OppositionInfo {
        kind: kind_word.into(),
        holder: holder.into(),
        line,
        description,
    })
}

/// Key squares for a passed pawn.
///
/// For a non-rook pawn on rank R (white-perspective), the canonical
/// key squares are the three squares two ranks ahead: (file-1, R+2),
/// (file, R+2), (file+1, R+2). Standing on any of those guarantees
/// promotion in K+P endings.
///
/// For a rook pawn (a/h file), the rule is different: only the queen-
/// side / kingside corner-of-rank-7 matters and even then it's a draw
/// against the wrong-coloured bishop … we use a simplified rule (rank
/// 8/1 squares plus the adjacent file) since this is mostly used for
/// d/e-pawn cases the user actually plays.
fn key_squares_for_pawn(pawn: Square, color: Color) -> Vec<Square> {
    let f = pawn.file() as i32;
    let r = pawn.rank() as i32;
    let target_r = if color == Color::White { r + 2 } else { r - 2 };
    if !(0..8).contains(&target_r) { return vec![]; }
    let mut out = Vec::new();
    for df in [-1, 0, 1] {
        let nf = f + df;
        if !(0..8).contains(&nf) { continue; }
        out.push(Square::from_coords(File::new(nf as u32), Rank::new(target_r as u32)));
    }
    // Rook-pawn refinement: only one set of key squares actually works.
    // Don't bother for now — caller's main use is d/e/c/f pawns.
    out
}

/// Defender's king in / can reach the square of the pawn.
/// Pawn on (f, r) for `color`. Square side = remaining ranks to promote
/// (counted as ranks of pawn movement). Defender's king is "in the
/// square" if its Chebyshev distance to the promotion square ≤
/// promotion_distance (with a -1 adjustment when it's the defender's
/// move, since they get a tempo).
fn defender_in_square(pawn: Square, pawn_color: Color, defending_king: Square, stm: Color) -> bool {
    let promotion_rank = if pawn_color == Color::White { 7 } else { 0 };
    let promotion_sq = Square::from_coords(pawn.file(), Rank::new(promotion_rank as u32));
    let pf = pawn.file() as i32; let pr = pawn.rank() as i32;
    let promo_dist = (promotion_rank - pr).abs() as i32;
    let dk_f = defending_king.file() as i32;
    let dk_r = defending_king.rank() as i32;
    let king_dist = (dk_f - promotion_sq.file() as i32).abs()
        .max((dk_r - promotion_rank).abs());
    // If it's defender's move, they get one free tempo, so they're in
    // the square if their distance ≤ promo_dist. Otherwise ≤ promo_dist - 1.
    let extra = if stm == pawn_color.other() { 0 } else { 1 };
    let _ = pf;
    king_dist <= (promo_dist - extra)
}

// ── Themes ──────────────────────────────────────────────────────────────

fn derive_themes(
    mat: &MaterialAnalysis,
    pawns: &PawnStructureAnalysis,
    ks: &BothSidesKingSafety,
    act: &BothSidesActivity,
    lc: &LineControl,
    tac: &TacticsAnalysis,
    endgame: &EndgameAnalysis,
    eval_cp: i32,
) -> Vec<Theme> {
    let mut themes = Vec::new();

    // Endgame themes (highest priority when phase is endgame and these
    // fire — opposition / key squares often decide the result).
    if endgame.is_endgame {
        if let Some(o) = &endgame.opposition {
            themes.push(Theme {
                id: "opposition".into(),
                side: o.holder.clone(),
                strength: 70,
                description: o.description.clone(),
            });
        }
        for k in &endgame.key_squares {
            if let Some(c) = &k.controlled_by {
                if c == &k.pawn_color {
                    themes.push(Theme {
                        id: "key_square".into(),
                        side: c.clone(),
                        strength: 80,
                        description: format!("{}'s king occupies a key square for the {} pawn — winning K+P endgame",
                            cap_first(c), k.pawn_square),
                    });
                }
            }
        }
        for sp in &endgame.square_of_pawn {
            if !sp.defender_in_square {
                themes.push(Theme {
                    id: "square_of_pawn".into(),
                    side: sp.pawn_color.clone(),
                    strength: 90,
                    description: format!("The {} passed pawn races free — defender's king is outside the square of the pawn",
                        sp.pawn_square),
                });
            }
        }
    }

    // Material edge.
    if mat.material_delta_cp.abs() >= 100 {
        let side = if mat.material_delta_cp > 0 { "white" } else { "black" };
        let pawns_diff = (mat.material_delta_cp.abs() as f32) / 100.0;
        themes.push(Theme {
            id: "material_edge".into(),
            side: side.into(),
            strength: ((pawns_diff * 25.0).min(100.0)) as i32,
            description: format!("{} is up {:.1} pawns of material",
                if side == "white" { "White" } else { "Black" }, pawns_diff),
        });
    }

    // Bishop pair.
    if mat.bishop_pair_white && !mat.bishop_pair_black {
        themes.push(Theme {
            id: "bishop_pair".into(),
            side: "white".into(), strength: 40,
            description: "White has the bishop pair, valuable in open positions".into(),
        });
    } else if mat.bishop_pair_black && !mat.bishop_pair_white {
        themes.push(Theme {
            id: "bishop_pair".into(),
            side: "black".into(), strength: 40,
            description: "Black has the bishop pair, valuable in open positions".into(),
        });
    }

    // Opposite-coloured bishops (drawish in pure endings, sharp with attackers).
    if mat.opposite_color_bishops {
        themes.push(Theme {
            id: "opposite_color_bishops".into(),
            side: "both".into(), strength: 50,
            description: "Opposite-coloured bishops — drawish in simplified positions, but the side with extra attackers can press hard".into(),
        });
    }

    // King safety.
    let danger_diff = (ks.white.danger_score - ks.black.danger_score).abs();
    if danger_diff >= 80 {
        let side = if ks.white.danger_score < ks.black.danger_score { "white" } else { "black" };
        themes.push(Theme {
            id: "king_safety".into(),
            side: side.into(),
            strength: (danger_diff.min(400) / 4),
            description: format!("{}'s king is meaningfully safer; the opponent has open files / weakened shield / more attackers in the king zone",
                if side == "white" { "White" } else { "Black" }),
        });
    }

    // Activity.
    let mob_diff = (act.white.total_mobility as i32) - (act.black.total_mobility as i32);
    if mob_diff.abs() >= 8 {
        let side = if mob_diff > 0 { "white" } else { "black" };
        themes.push(Theme {
            id: "piece_activity".into(),
            side: side.into(),
            strength: ((mob_diff.abs() * 4).min(100)),
            description: format!("{} has more active pieces, controlling more squares",
                if side == "white" { "White" } else { "Black" }),
        });
    }

    // Space (squares attacked in enemy half).
    let space_diff = (act.white.squares_in_enemy_half as i32) - (act.black.squares_in_enemy_half as i32);
    if space_diff.abs() >= 6 {
        let side = if space_diff > 0 { "white" } else { "black" };
        themes.push(Theme {
            id: "space_advantage".into(),
            side: side.into(),
            strength: ((space_diff.abs() * 5).min(100)),
            description: format!("{} controls more space in the enemy half",
                if side == "white" { "White" } else { "Black" }),
        });
    }

    // Structure: IQP, hanging pawns, color complex.
    if pawns.iqp_white && !pawns.iqp_black {
        themes.push(Theme {
            id: "iqp".into(), side: "black".into(), strength: 30,
            description: "White has an IQP — long-term weakness on d4/d5 to attack, but with active piece play in compensation".into(),
        });
    }
    if pawns.iqp_black && !pawns.iqp_white {
        themes.push(Theme {
            id: "iqp".into(), side: "white".into(), strength: 30,
            description: "Black has an IQP — long-term weakness on d4/d5 to attack, but with active piece play in compensation".into(),
        });
    }
    if let Some(side) = pawns.light_complex_weak.as_ref() {
        themes.push(Theme {
            id: "light_complex".into(),
            side: if side == "white" { "black".into() } else { "white".into() },
            strength: 50,
            description: format!("{}'s light squares are weak (no light-squared bishop, ≥3 pawns on light squares)",
                if side == "white" { "White" } else { "Black" }),
        });
    }
    if let Some(side) = pawns.dark_complex_weak.as_ref() {
        themes.push(Theme {
            id: "dark_complex".into(),
            side: if side == "white" { "black".into() } else { "white".into() },
            strength: 50,
            description: format!("{}'s dark squares are weak (no dark-squared bishop, ≥3 pawns on dark squares)",
                if side == "white" { "White" } else { "Black" }),
        });
    }

    // Line control.
    for f in &lc.open_files {
        if let Some(side) = &f.controlling_side {
            themes.push(Theme {
                id: "open_file_control".into(),
                side: side.clone(), strength: 40,
                description: format!("{} controls the open {}-file",
                    if side == "white" { "White" } else { "Black" }, f.file),
            });
        }
    }
    if let Some(s) = &lc.long_diagonal_a1h8 {
        themes.push(Theme {
            id: "long_diagonal".into(), side: s.clone(), strength: 30,
            description: format!("{} controls the long a1-h8 diagonal",
                if s == "white" { "White" } else { "Black" }),
        });
    }
    if let Some(s) = &lc.long_diagonal_h1a8 {
        themes.push(Theme {
            id: "long_diagonal".into(), side: s.clone(), strength: 30,
            description: format!("{} controls the long h1-a8 diagonal",
                if s == "white" { "White" } else { "Black" }),
        });
    }
    if let Some(s) = &lc.seventh_rank_dominant {
        themes.push(Theme {
            id: "seventh_rank".into(), side: s.clone(), strength: 50,
            description: format!("{} has rook(s) on the {} rank — pigs on the 7th",
                if s == "white" { "White" } else { "Black" },
                if s == "white" { "7th" } else { "2nd" }),
        });
    }

    // Hanging pieces.
    if !tac.hanging_white.is_empty() {
        let total_loss: i32 = tac.hanging_white.iter().map(|h| h.loss_cp).sum();
        themes.push(Theme {
            id: "hanging_pieces".into(), side: "black".into(),
            strength: ((total_loss / 5).min(100)),
            description: format!("White has hanging material: {}",
                tac.hanging_white.iter().map(|h| format!("{} on {}", h.role, h.square)).collect::<Vec<_>>().join(", ")),
        });
    }
    if !tac.hanging_black.is_empty() {
        let total_loss: i32 = tac.hanging_black.iter().map(|h| h.loss_cp).sum();
        themes.push(Theme {
            id: "hanging_pieces".into(), side: "white".into(),
            strength: ((total_loss / 5).min(100)),
            description: format!("Black has hanging material: {}",
                tac.hanging_black.iter().map(|h| format!("{} on {}", h.role, h.square)).collect::<Vec<_>>().join(", ")),
        });
    }

    // Composite verdict — synthesise the leading factor.
    let leading = themes.iter().max_by_key(|t| t.strength);
    if let Some(t) = leading {
        if eval_cp.abs() >= 50 {
            themes.push(Theme {
                id: "leading_factor".into(),
                side: t.side.clone(),
                strength: t.strength,
                description: format!("Leading factor: {}", t.description),
            });
        }
    }

    themes
}

fn role_name(r: Role) -> &'static str {
    match r {
        Role::Pawn => "pawn", Role::Knight => "knight", Role::Bishop => "bishop",
        Role::Rook => "rook", Role::Queen => "queen", Role::King => "king",
    }
}
