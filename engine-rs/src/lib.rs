//! Research-grade explainable positional-chess analyzer.
//!
//! Every detector here is engine-free: it operates on a `shakmaty::Chess`
//! position with proper bitboard attack tables and a real Static Exchange
//! Evaluation. Goals:
//!
//!   1. **Correctness over coverage.** Every motif has a tight, formal
//!      definition. We'd rather miss something than say something false
//!      ("knight pinned to bishop" — bishop ≈ knight, so it's not a real pin).
//!   2. **SEE-aware.** Captures, sacrifices, hanging pieces, fork detection
//!      and trapped-piece detection all consult Static Exchange Evaluation
//!      so that *defended* targets aren't reported as hanging.
//!   3. **Composable.** The analyzer returns a list of `Motif` records
//!      with `id`, `phrase`, and `priority`. The caller (JS) does the
//!      composition; that lets us A/B presentation cheaply.
//!
//! Public API:
//!
//!   `analyze(fen_before: &str, uci: &str) -> JsValue`
//!     Returns: `{ san, motifs: [{id, phrase, priority}], fen_after, terminal? }`
//!
//! All motif IDs match the JavaScript-side priority array so existing
//! presentation code keeps working.

use serde::{Deserialize, Serialize};
use shakmaty::{fen::Fen, CastlingMode, Chess, Position};
use wasm_bindgen::prelude::*;

mod eval;
mod motifs;
mod piece_value;
mod see;
mod util;

use motifs::{detect_all, Motif};

// ── Public API ──────────────────────────────────────────────────────────────

/// Result of analyzing a single move.
#[derive(Serialize, Deserialize)]
pub struct AnalysisResult {
    pub san: String,
    pub fen_after: String,
    pub motifs: Vec<Motif>,
    pub terminal: Option<&'static str>,
}

/// Analyze one move from a starting FEN.
///
/// Returns a JSON object describing every motif that fires, suitable for
/// JS-side composition. On any parsing error returns `{ error: "..." }`.
#[wasm_bindgen]
pub fn analyze(fen_before: &str, uci: &str) -> JsValue {
    match analyze_inner(fen_before, uci) {
        Ok(result) => serde_wasm_bindgen::to_value(&result).unwrap_or(JsValue::NULL),
        Err(e) => {
            let err = serde_json::json!({ "error": e });
            serde_wasm_bindgen::to_value(&err).unwrap_or(JsValue::NULL)
        }
    }
}

/// Analyze a sequence of UCI moves starting from a FEN.
///
/// Same shape as `analyze`, but returns an array of results — one per ply.
#[wasm_bindgen]
pub fn analyze_pv(start_fen: &str, ucis: Vec<JsValue>, plies: u32) -> JsValue {
    let max = plies.min(ucis.len() as u32) as usize;
    let mut results: Vec<AnalysisResult> = Vec::with_capacity(max);
    let mut fen = start_fen.to_string();
    for js_uci in ucis.into_iter().take(max) {
        let uci: String = match serde_wasm_bindgen::from_value(js_uci) {
            Ok(s) => s,
            Err(_) => break,
        };
        match analyze_inner(&fen, &uci) {
            Ok(r) => {
                fen = r.fen_after.clone();
                results.push(r);
            }
            Err(_) => break,
        }
    }
    serde_wasm_bindgen::to_value(&results).unwrap_or(JsValue::NULL)
}

/// Static evaluation of a position. Returns the same `Eval` struct as the
/// internal evaluator: phase, per-side breakdown, final centipawn score.
///
/// Use this to attribute "why is this position +0.7?" to specific terms
/// (material, psqt, mobility, pawns, king_safety, threats, imbalance).
#[wasm_bindgen]
pub fn evaluate_fen(fen: &str) -> JsValue {
    match parse_board(fen) {
        Ok(pos) => {
            let e = eval::evaluate(pos.board());
            serde_wasm_bindgen::to_value(&e).unwrap_or(JsValue::NULL)
        }
        Err(e) => {
            let err = serde_json::json!({ "error": e });
            serde_wasm_bindgen::to_value(&err).unwrap_or(JsValue::NULL)
        }
    }
}

/// Per-piece contribution to the static evaluation. Returns one entry per
/// non-king piece on the board: `value_cp` (side-relative), plus the
/// breakdown by head (material / psqt / mobility / pawns / king_safety /
/// threats / imbalance). This is what the heatmap renders.
#[wasm_bindgen]
pub fn piece_contributions(fen: &str) -> JsValue {
    match parse_board(fen) {
        Ok(pos) => {
            let pcs = piece_value::piece_contributions(pos.board());
            serde_wasm_bindgen::to_value(&pcs).unwrap_or(JsValue::NULL)
        }
        Err(e) => {
            let err = serde_json::json!({ "error": e });
            serde_wasm_bindgen::to_value(&err).unwrap_or(JsValue::NULL)
        }
    }
}

/// Single-piece contribution at a square. Convenience for hover tooltips
/// that don't need the full board scan.
#[wasm_bindgen]
pub fn piece_value_at(fen: &str, square: &str) -> JsValue {
    let pos = match parse_board(fen) {
        Ok(p) => p,
        Err(e) => {
            let err = serde_json::json!({ "error": e });
            return serde_wasm_bindgen::to_value(&err).unwrap_or(JsValue::NULL);
        }
    };
    let sq: shakmaty::Square = match square.parse() {
        Ok(s) => s,
        Err(_) => return JsValue::NULL,
    };
    match piece_value::piece_contribution(pos.board(), sq) {
        Some(c) => serde_wasm_bindgen::to_value(&c).unwrap_or(JsValue::NULL),
        None => JsValue::NULL,
    }
}

/// Quick smoke-test export so JS can confirm the WASM binding is alive.
#[wasm_bindgen]
pub fn version() -> String {
    "engine-rs 0.2.0 (HCE)".to_string()
}

fn parse_board(fen: &str) -> Result<Chess, String> {
    let f: Fen = fen.parse().map_err(|e: shakmaty::fen::ParseFenError| format!("bad fen: {}", e))?;
    f.into_position(CastlingMode::Standard).map_err(|e| format!("illegal: {}", e))
}

// ── Internals ──────────────────────────────────────────────────────────────

fn analyze_inner(fen_before: &str, uci: &str) -> Result<AnalysisResult, String> {
    let fen: Fen = fen_before
        .parse()
        .map_err(|e| format!("bad fen: {}", e))?;
    let pos: Chess = fen
        .into_position(CastlingMode::Standard)
        .map_err(|e| format!("illegal position: {}", e))?;

    let mv = util::parse_uci(&pos, uci)?;
    let san = util::move_to_san(&pos, &mv);

    let mut after = pos.clone();
    after.play_unchecked(&mv);

    // Terminal short-circuit.
    let terminal = if after.is_checkmate() {
        Some("checkmate")
    } else if after.is_stalemate() {
        Some("stalemate")
    } else if after.is_insufficient_material() {
        Some("insufficient_material")
    } else {
        None
    };

    let motifs = if terminal == Some("checkmate") {
        vec![Motif {
            id: "checkmate".into(),
            phrase: "Delivers checkmate".into(),
            priority: 0,
        }]
    } else {
        detect_all(&pos, &after, &mv, terminal)
    };

    let fen_after = Fen::from_position(after, shakmaty::EnPassantMode::Legal).to_string();

    Ok(AnalysisResult {
        san,
        fen_after,
        motifs,
        terminal,
    })
}
