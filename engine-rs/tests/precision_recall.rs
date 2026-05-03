//! Precision / recall harness over a labelled corpus of (fen, move, motif)
//! triples.
//!
//! ## Why this exists
//!
//! The LLM Council's #1 finding: 70+ motif detectors validated by ~14
//! integration tests is "confident hallucinations wearing Steinitz's coat."
//! Adding more motifs / Nimzowitschian overprotection / Karpovian
//! restriction without measuring the existing detectors produces a
//! confident liar at scale.
//!
//! This harness is the foundation: a hand-curated corpus of positions,
//! each annotated with the motif IDs that MUST fire and MUST NOT fire
//! when the analyzer runs. The test computes per-motif precision and
//! recall, prints a table, and fails CI if any motif drops below the
//! threshold.
//!
//! ## Adding entries
//!
//! Append to `CORPUS` below. Each entry needs a FEN, a UCI move, the
//! motifs that should appear, and the motifs that should NOT appear.
//! Comment why the entry exists — the test failure message includes
//! the description, so future-you doesn't have to reverse-engineer
//! the position to remember the intent.
//!
//! ## Thresholds
//!
//! - `MIN_PRECISION = 0.80` — a motif fires correctly ≥ 80% of the time
//!   when it does fire. Loosened during early build-out; tighten later.
//! - `MIN_RECALL    = 0.70` — when the corpus expects a motif, it actually
//!   fires ≥ 70% of the time.
//! - Motifs with fewer than `MIN_SAMPLES = 3` corpus mentions are excluded
//!   from the threshold gate (statistics are too noisy below this).

use std::collections::BTreeMap;
use shakmaty::{fen::Fen, CastlingMode, Chess, File, Move, Position, Square};

const MIN_PRECISION: f32 = 0.80;
const MIN_RECALL:    f32 = 0.70;
const MIN_SAMPLES:   usize = 3;

#[derive(Debug, Clone, Copy)]
struct Entry {
    fen: &'static str,
    mv: &'static str,
    must_fire: &'static [&'static str],
    must_not_fire: &'static [&'static str],
    description: &'static str,
}

const CORPUS: &[Entry] = &[
    // ── Tactical motifs ──────────────────────────────────────────────────
    Entry {
        fen: "2k5/8/8/8/8/n7/8/R3K3 b - - 0 1",
        mv: "a3c2",
        must_fire: &["fork", "check"],
        must_not_fire: &[],
        description: "Royal fork: knight from a3 to c2 attacks K on e1 and R on a1",
    },
    Entry {
        fen: "4k3/8/8/4n3/8/8/8/4R2K w - - 0 1",
        mv: "e1e3",
        must_fire: &["pin"],
        must_not_fire: &[],
        description: "Absolute pin: Re3 pins Ne5 to Ke8",
    },
    Entry {
        fen: "4k3/4q3/8/8/8/8/8/R5K1 w - - 0 1",
        mv: "a1e1",
        must_fire: &["pin"],
        must_not_fire: &["skewer"],
        description: "Re1 pins Qe7 to Ke8 (front=Q, back=K → pin not skewer)",
    },
    Entry {
        fen: "3k4/8/8/3N4/8/8/8/3RK3 w - - 0 1",
        mv: "d5f6",
        must_fire: &["discovered_check"],
        must_not_fire: &["double_check"],
        description: "Discovered check: knight from d5 to f6 unmasks Rd1 onto Kd8",
    },

    // ── False-positive guards ────────────────────────────────────────────
    Entry {
        fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        mv: "b1a3",
        must_fire: &["develops", "knight_on_rim"],
        must_not_fire: &["centralizes"],
        description: "Knight to a3 — develops, but Na3 is on the rim, NOT centralizing",
    },
    Entry {
        fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        mv: "g1f3",
        must_fire: &["develops"],
        must_not_fire: &["centralizes", "activates"],
        description: "Nf3: develops only — f3 isn't a core central square; opening so 'activates' shouldn't fire",
    },
    Entry {
        fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        mv: "e2e4",
        must_fire: &["centralizes"],
        must_not_fire: &["develops"],
        description: "e2e4 stakes a claim in the centre. 'Develops' is for minor pieces only.",
    },
    Entry {
        fen: "7k/4p3/5n2/3N4/8/8/8/7K w - - 0 1",
        mv: "d5f6",
        must_fire: &[],
        must_not_fire: &["hangs", "sacrifice"],
        description: "Even knight trade — pawn recaptures. Must NOT fire hangs/sacrifice.",
    },

    // ── Trade nuance ────────────────────────────────────────────────────
    Entry {
        fen: "k7/8/8/8/5n2/3N4/8/3Q3K w - - 0 1",
        mv: "d3f4",
        must_fire: &["simplifies"],
        must_not_fire: &["piece_trade", "hangs"],
        description: "White ahead a queen + knight; trade knights → 'simplifies'",
    },
    Entry {
        fen: "4k3/8/8/8/8/8/4r3/4R2K w - - 0 1",
        mv: "e1e2",
        must_fire: &["trades_into_endgame"],
        must_not_fire: &["hangs"],
        description: "Rook trade in low-phase position → trades_into_endgame",
    },

    // ── Phase awareness ─────────────────────────────────────────────────
    Entry {
        fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        mv: "b1c3",
        must_fire: &["develops"],
        must_not_fire: &["activates"],
        description: "Opening minor move uses 'develops', not 'activates'",
    },

    // ── Positional ──────────────────────────────────────────────────────
    Entry {
        fen: "4k3/8/8/8/8/8/8/5RK1 w - - 0 1",
        mv: "f1f3",
        must_fire: &["rook_lift"],
        must_not_fire: &[],
        description: "Rf1-f3: classic kingside-attack rook lift",
    },
    Entry {
        // detect_long_diagonal requires the bishop to be coming FROM
        // off-diagonal (`from_diag != to_diag`). Bc1-b2 places the
        // bishop on b2 (on a1-h8) coming from c1 (off the long diags).
        fen: "4k3/8/8/8/8/8/8/2B1K3 w - - 0 1",
        mv: "c1b2",
        must_fire: &["long_diagonal"],
        must_not_fire: &[],
        description: "Bishop arrives on the a1-h8 long diagonal (c1 off-diag → b2 on-diag)",
    },
    Entry {
        fen: "rnbqkbnr/pppppppp/8/8/8/6P1/PPPPPP1P/RNBQKBNR w KQkq - 0 1",
        mv: "f1g2",
        must_fire: &["fianchetto"],
        must_not_fire: &[],
        description: "Bishop fianchettoes to g2 (white kingside)",
    },

    // ── Mid-board centralization ────────────────────────────────────────
    Entry {
        fen: "4k3/8/8/8/8/8/3N4/4K3 w - - 0 1",
        mv: "d2e4",
        must_fire: &["centralizes"],
        must_not_fire: &[],
        description: "Knight Nd2-e4 lands on a core central square",
    },

    // ── Castling ────────────────────────────────────────────────────────
    Entry {
        fen: "rnbqk2r/ppppbppp/5n2/4p3/4P3/5N2/PPPPBPPP/RNBQK2R w KQkq - 0 1",
        mv: "e1g1",
        must_fire: &["castles_kingside"],
        must_not_fire: &[],
        description: "O-O for white",
    },
    Entry {
        fen: "r3kbnr/ppp1pppp/2nq4/3p4/3P4/2NQ4/PPP1PPPP/R3KBNR w KQkq - 0 1",
        mv: "e1c1",
        must_fire: &["castles_queenside"],
        must_not_fire: &[],
        description: "O-O-O for white",
    },

    // ── En passant ──────────────────────────────────────────────────────
    Entry {
        fen: "rnbqkbnr/pp1ppppp/8/2pP4/8/8/PPP1PPPP/RNBQKBNR w KQkq c6 0 3",
        mv: "d5c6",
        must_fire: &["en_passant"],
        must_not_fire: &[],
        description: "Pawn captures en passant",
    },

    // ── Promotion ───────────────────────────────────────────────────────
    Entry {
        // Pawn on e7 promotes to e8. Kings well clear of the promotion square.
        fen: "8/4P3/8/8/8/3k4/8/4K3 w - - 0 1",
        mv: "e7e8q",
        must_fire: &["promotion"],
        must_not_fire: &[],
        description: "Pawn promotes to queen",
    },

    // ── Capture with check ──────────────────────────────────────────────
    Entry {
        // Pure rook-vs-rook in low-phase = `trades_into_endgame` not
        // generic `capture` (same role swap → trade family branch).
        // The check still fires on top.
        fen: "8/4r1k1/8/8/8/8/8/4R1K1 w - - 0 1",
        mv: "e1e7",
        must_fire: &["check", "trades_into_endgame"],
        must_not_fire: &["hangs"],
        description: "Rxe7+ — rook trade in low-phase + check",
    },

    // ── Connects rooks via castling ─────────────────────────────────────
    Entry {
        // Bare-bones position: only kings, rooks, pawn shields. After
        // O-O the rook on a1 has a clear view of the rook on f1 (e1
        // empty post-castle) → connects_rooks fires.
        fen: "r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1",
        mv: "e1g1",
        must_fire: &["castles_kingside", "connects_rooks"],
        must_not_fire: &[],
        description: "O-O also connects rooks on a clear back rank",
    },

    // ── Threatens (heavy piece) ─────────────────────────────────────────
    Entry {
        fen: "r3k2r/8/8/8/2N5/8/8/4K3 w kq - 0 1",
        mv: "c4b6",
        must_fire: &["threatens"],
        must_not_fire: &[],
        description: "Nb6 attacks Ra8 with no defender → threatens the rook",
    },

    // ── SEE correctness: defended pawns must NOT be flagged as hanging ──
    // Previously the SEE fold-back ran one extra iteration, producing
    // wrong-sign results for defended-pawn captures. This entry locks
    // the fix in: White's e4 pawn, attacked by Black's f5 pawn AND
    // defended by White's d3 pawn — pawn-for-pawn trade is even,
    // pawn is NOT hanging. Move is a quiet tempo by White's king.
    Entry {
        fen: "4k3/8/8/5p2/4P3/3P4/8/4K3 w - - 0 1",
        mv: "e1d2",
        must_fire: &[],
        must_not_fire: &["hangs", "sacrifice"],
        description: "Defended pawn (1 atk, 1 def, both pawns) — must NOT be hanging",
    },

    // ── Same SEE invariant with stronger defenders ─────────────────────
    // White e4 pawn defended by knight on d2 + bishop on c2 + queen on
    // d1, attacked by black knight on f6. Knight-for-pawn = -200 for
    // black; pawn safely defended.
    Entry {
        fen: "4k3/8/5n2/8/4P3/8/2BNQ3/4K3 b - - 0 1",
        mv: "e8d8",
        must_fire: &[],
        must_not_fire: &["hangs"],
        description: "Pawn over-defended (pawn + 3 minors/queens), 1 knight attacker — not hanging",
    },
];

// ── Harness ─────────────────────────────────────────────────────────────

#[derive(Default, Debug)]
struct Stats {
    expected_count: usize,    // # corpus entries that expected this motif (must_fire)
    fired_when_expected: usize, // TP — fired AND was expected
    fired_when_forbidden: usize,// FP — fired AND was in must_not_fire
    silent_when_expected: usize,// FN — should have fired but didn't
    silent_when_forbidden: usize,// TN — was in must_not_fire AND didn't fire
}

impl Stats {
    fn precision(&self) -> Option<f32> {
        let denom = self.fired_when_expected + self.fired_when_forbidden;
        if denom == 0 { None } else { Some(self.fired_when_expected as f32 / denom as f32) }
    }
    fn recall(&self) -> Option<f32> {
        let denom = self.fired_when_expected + self.silent_when_expected;
        if denom == 0 { None } else { Some(self.fired_when_expected as f32 / denom as f32) }
    }
}

fn motif_ids(entry: &Entry) -> Result<Vec<String>, String> {
    let fen: Fen = entry.fen.parse().map_err(|e| format!("bad fen: {}", e))?;
    let pos: Chess = fen.into_position(CastlingMode::Standard)
        .map_err(|e| format!("illegal position: {:?}", e))?;
    let mv = parse_uci(&pos, entry.mv)
        .ok_or_else(|| format!("illegal move {}", entry.mv))?;
    let mut after = pos.clone();
    after.play_unchecked(&mv);
    let terminal = if after.is_checkmate() {
        Some("checkmate")
    } else if after.is_stalemate() {
        Some("stalemate")
    } else { None };
    let motifs = engine_rs::detect_for_test(&pos, &after, &mv, terminal);
    Ok(motifs.into_iter().map(|m| m.id).collect())
}

fn parse_uci(pos: &Chess, uci: &str) -> Option<Move> {
    let from: Square = uci[0..2].parse().ok()?;
    let to:   Square = uci[2..4].parse().ok()?;
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
        .find(|m| {
            if m.from() != Some(from) { return false; }
            if m.promotion() != promo { return false; }
            // Castling: shakmaty's `to()` returns the rook square in
            // some configurations, while UCI clients normally write
            // "e1g1" (king destination). Accept both.
            if let Move::Castle { king, rook } = m {
                let kside = king.file() < rook.file();
                let king_dest = if kside {
                    Square::from_coords(File::G, king.rank())
                } else {
                    Square::from_coords(File::C, king.rank())
                };
                return to == king_dest || to == *rook;
            }
            m.to() == to
        })
        .cloned()
}

#[test]
fn corpus_precision_recall() {
    let mut stats: BTreeMap<String, Stats> = BTreeMap::new();
    let mut failures: Vec<String> = Vec::new();

    for (i, e) in CORPUS.iter().enumerate() {
        let fired = match motif_ids(e) {
            Ok(v) => v,
            Err(err) => {
                failures.push(format!(
                    "[#{i}] {} — corpus setup error: {err}", e.description
                ));
                continue;
            }
        };
        let fired_set: std::collections::HashSet<String> = fired.iter().cloned().collect();

        for mid in e.must_fire.iter() {
            let s = stats.entry((*mid).to_string()).or_default();
            s.expected_count += 1;
            if fired_set.contains(*mid) {
                s.fired_when_expected += 1;
            } else {
                s.silent_when_expected += 1;
                failures.push(format!(
                    "[#{i}] {} — expected `{mid}` but only got: {fired:?}",
                    e.description,
                ));
            }
        }
        for mid in e.must_not_fire.iter() {
            let s = stats.entry((*mid).to_string()).or_default();
            if fired_set.contains(*mid) {
                s.fired_when_forbidden += 1;
                failures.push(format!(
                    "[#{i}] {} — forbade `{mid}` but it fired (all motifs: {fired:?})",
                    e.description,
                ));
            } else {
                s.silent_when_forbidden += 1;
            }
        }
    }

    // Print the precision / recall table for visibility — this shows up in
    // `cargo test -- --nocapture` and on failure.
    eprintln!();
    eprintln!("┌────────────────────────────────────┬──────┬───────┬──────────┬──────┬─────────┐");
    eprintln!("│ motif                              │ TP   │ FN    │ FP       │ TN   │ P  /  R │");
    eprintln!("├────────────────────────────────────┼──────┼───────┼──────────┼──────┼─────────┤");
    for (id, s) in &stats {
        let p = s.precision().map(|v| format!("{:.2}", v)).unwrap_or_else(|| "—".into());
        let r = s.recall().map(|v| format!("{:.2}", v)).unwrap_or_else(|| "—".into());
        eprintln!(
            "│ {:34} │ {:>4} │ {:>5} │ {:>8} │ {:>4} │ {:>4} / {:>4} │",
            id, s.fired_when_expected, s.silent_when_expected,
            s.fired_when_forbidden, s.silent_when_forbidden, p, r
        );
    }
    eprintln!("└────────────────────────────────────┴──────┴───────┴──────────┴──────┴─────────┘");
    eprintln!("CORPUS SIZE: {} positions", CORPUS.len());
    eprintln!();

    // Threshold-gate. Only motifs with ≥ MIN_SAMPLES corpus mentions are
    // gated so we don't fail on noisy 1-or-2 sample IDs.
    let mut threshold_failures: Vec<String> = Vec::new();
    for (id, s) in &stats {
        let n_seen = s.fired_when_expected + s.fired_when_forbidden;
        let n_expected = s.expected_count;
        if n_seen + n_expected < MIN_SAMPLES { continue; }
        if let Some(p) = s.precision() {
            if p < MIN_PRECISION {
                threshold_failures.push(format!(
                    "motif `{id}` precision {p:.2} < {MIN_PRECISION:.2} (TP={} FP={})",
                    s.fired_when_expected, s.fired_when_forbidden,
                ));
            }
        }
        if let Some(r) = s.recall() {
            if r < MIN_RECALL {
                threshold_failures.push(format!(
                    "motif `{id}` recall {r:.2} < {MIN_RECALL:.2} (TP={} FN={})",
                    s.fired_when_expected, s.silent_when_expected,
                ));
            }
        }
    }

    // Print individual must_fire / must_not_fire violations on failure.
    if !failures.is_empty() {
        eprintln!("\nIndividual corpus violations:");
        for f in &failures { eprintln!("  • {f}"); }
    }
    assert!(failures.is_empty(),
        "{} corpus violations (see stderr). The motif analyzer's output \
         doesn't match the labelled expectations.", failures.len());
    assert!(threshold_failures.is_empty(),
        "Per-motif thresholds violated:\n{}", threshold_failures.join("\n"));
}
