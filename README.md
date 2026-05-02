# Chess Analysis Studio

A browser-based chess analysis tool. **Stockfish runs in the browser via WebAssembly** — there is no backend. Load any position, see the engine's evaluation in real time, browse top candidate moves with their principal variations, and get a plain-language explanation of *why* a move is good, bad, or brilliant.

This is the kind of analysis cockpit you'd find on Lichess, scaled down to a single-page app you can self-host on any static host (or Vercel — see [Deploy to Vercel](#deploy-to-vercel)).

> **Heads-up:** the `server/` directory is now **legacy**. The full analysis pipeline lives in `client/src/engine/`. The server is kept around as reference for the same logic — you do not need to run it.

---

## Table of Contents

- [Highlights](#highlights)
- [Demo Flow](#demo-flow)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Running Locally](#running-locally)
- [Deploy to Vercel](#deploy-to-vercel)
- [Public API (`client/src/engine/`)](#public-api-clientsrcengine)
- [How the Analysis Pipeline Works](#how-the-analysis-pipeline-works)
- [Known Gaps and Problems](#known-gaps-and-problems)
- [Roadmap / Future Work](#roadmap--future-work)
- [Contributing](#contributing)
- [License](#license)

---

## Highlights

### Engine + analysis

- **Browser-side Stockfish 18 (lite, single-threaded WASM)** — configurable depth 6–22, MultiPV 1–10, principal variation extraction. ~7 MB engine WASM, ~150 KB analyzer WASM. No backend.
- **Custom Rust+WASM static evaluator (HCE)** with PeSTO-tuned material + piece-square tables, mobility, pawn-structure, king-safety, threats, imbalance heads — phased between middlegame and endgame quanta. Drives the heatmap, hanging-piece detection, and the eval-breakdown bars below the board.
- **70+ motif detectors** in Rust covering tactical patterns (fork / pin / skewer / discovered check / double check / Greek gift / Anastasia's mate / Boden's mate / Arabian-style mate / smothered-mate threat / back-rank mate threat / decisive combination), captures and trades (simplifies / trades-into-endgame / trades-when-behind / exchange sacrifice / piece trade / queen trade), pawn structure (IQP / hanging pawns / passed / supported / backward / isolated / colour-complex weakness / pawn breakthrough / pawn break / pawn lever / pawn storm), piece play (knight invasion / outpost / rook lift / battery / opens-file-for / opens-diagonal-for / fianchetto / long diagonal / rook on 7th / open + half-open files / doubles rooks), king attack (attacks king / eyes king zone / luft / pawn shield), strategic (loses castling / prophylaxis / multi-purpose / activates / centralises / develops / connects rooks).
- **SEE-aware everywhere.** "Threatens the rook" only fires if Rxr would actually win material. "Attacks the h-pawn" only fires if defenders < 2 AND SEE ≥ 0. "Hangs the knight" only fires when material is *actually* losing — clean trades don't trigger it.
- **Pattern-recognising tagline composer** (JS). Named patterns subsume their components: when `greek_gift` fires, the tagline is "Greek gift sacrifice — Bxh7+!", not the bare `sacrifice + check`. When `decisive_combination` fires, it's the headline. Pair-join with `phrasesOverlap()` deduplicates two phrases that mention the same role / file-pawn / square.
- **14 Rust integration tests** (`engine-rs/tests/motif_assertions.rs`) lock in false-positive guards: balanced trades don't fire `hangs`, single zone-square attacks don't fire `eyes_king_zone`, opening minor moves use `develops` not `activates`, simplifies fires when ahead, trades-into-endgame in low-phase positions, etc.

### Explanation blob (LLM-ready)

- **Structured `ExplanationBlob`** — material / pawn-structure / king-safety / activity / line-control / immediate-tactics / themes / verdict / per-head eval breakdown. Returned by the new WASM export `explain_position(fen)`.
- **Engine-augmented enrichment** (JS) — Stockfish multi-PV results are layered on top to add `engine_attack_potential` (king-attack signal from what fraction of top moves target the king zone) and `principal_plan` (engine's PV walked move-by-move with motifs, key squares, inferred theme).
- **GM-style narrative** synthesised from the blob — verdict, leading factor, eval breakdown, material, king safety with engine attack potential, activity, pawn structure, line control, tactics, engine plan — every claim grounded in the structured blob so a downstream LLM can verify and embellish without inventing facts.
- **Copy JSON** button beside the narrative copies the full blob (~10–30 KB) to the clipboard for pasting into ChatGPT / Claude / etc.

### UI

- **Two-column layout** with a 600 px board, 36 px eval bar flush with the board height (numeric label inside the bar on the loser's side), and a 400 px right-column analysis panel.
- **Captured-pieces strips** above and below the board — render captured pieces as inline-SVG silhouettes (consistent across font fallbacks); only the leading side renders the `+N` material pill.
- **Position-quality bars** below the board — bipolar bars for Activity, Mobility, King safety, Threats, Structure, Imbalance — decompose the *non-material* eval. Hover any label to see a custom tooltip explaining what that head measures.
- **Engine-driven Attack potential bar** + **Engine plan section** below the quality bars — the principal variation rendered as SAN chips, key squares listed, theme one-liner.
- **Top-moves summary header** above the scrollable details list:
  - **Engine consensus** one-liner derived from the dominant motif kind across all top moves.
  - **Quality circles row** — one circle per top move, coloured + iconographed by the move's dominant character (tactical / king attack / capture / positional / check / castling / defensive / promotion / structural / mate / quiet). Click to select; hover for tooltip with rank, SAN, motif IDs.
- **Engine settings panel** (gear icon in toolbar) — sliders for search depth (6–22) and top-moves count (1–10), persisted to localStorage.
- **Custom SVG move-quality icons** (brilliant / great / best / excellent / inaccuracy / mistake / blunder / missed-mate) replace inconsistently-rendering Unicode glyphs.
- **Lichess-style move history** with piece icons, opening name lookup (~40 named openings), arrow-key + keyboard navigation.
- **Hold ⇧ Shift (or start dragging) to reveal positional values.** Numeric badges on every piece showing its contextual worth (in pawns), colour-interpolated by significance.
- **Live "what-if" preview during drag.** Each piece's worth updates to show how it'd change if you complete the move.
- **Hanging-piece warnings + Best-move green ring + Material balance + king safety + phase indicator** in the toolbar.
- **LRU cache** for engine results, keyed on `(fen, depth, multipv)` — scrolling history is instant after the first pass.

---

## Demo Flow

1. Open the page → Stockfish WASM loads in a Web Worker (~1–2 s on first visit; cached afterwards).
2. Starting position renders, eval bar at `0.0`.
3. Make a move on the board → engine re-evaluates → eval bar swings, top-moves list refreshes.
4. Click any move in the top-moves list → blue arrow shows the suggestion, explainer opens with rating + reasoning.
5. Paste a FEN → board jumps to that position; analysis follows.
6. Step backwards through history → state rewinds; cached evaluations make this instant.

---

## Architecture

```
┌────────────────────────────────────────────┐                  ┌────────────────────────┐
│  React UI (main thread)                    │ ── postMessage ▶ │  Stockfish WASM        │
│  ───────────────────────────────           │ ◀── postMessage ─│  (Web Worker)          │
│  Board.jsx                                 │                  │  stockfish-18-lite     │
│   ├─ EvalBar.jsx                           │                  │  - UCI protocol        │
│   ├─ CapturedStrip.jsx                     │                  │  - depth 6-22 (config) │
│   ├─ PositionQualityBars.jsx               │                  │  - MultiPV 1-10        │
│   ├─ MoveCharacter.jsx (circles)           │                  └────────────────────────┘
│   ├─ SettingsPanel.jsx                     │                              ▲
│   ├─ Tooltip.jsx                           │                              │
│   ├─ ChessPieceIcon.jsx (SVG)              │                              │
│   └─ QualityIcon.jsx (SVG)                 │                              │
│                                            │                              │
│  client/src/engine/  (analysis pipeline)   │                              │
│   ├─ engine.js          (UCI worker wrapper, LRU, configurable depth)─────┘
│   ├─ chess.js           (chess.js helpers)
│   ├─ explainer.js       (Lichess win-rate sigmoid + classifier
│   │                      with obvious-recapture guard)
│   ├─ analysis.js        (getTopMoves, explainMoveAt — public API)
│   ├─ analyzer-rs.js     (WASM bridge: analyze, explain_position,
│   │                      composeTagline, evaluate_fen)
│   ├─ full-explanation.js (engine-augmented blob: attack potential,
│   │                       principal plan, GM narrative)
│   ├─ openings.js        (FEN-keyed opening dictionary)
│   ├─ taglines.js        (legacy JS taglines — fallback)
│   └─ wasm-rs/           (build artefact: engine_rs.js + .wasm)
│                                                                          ▲
│  engine-rs/  (Rust → WASM, the analytical core)                          │
│   ├─ src/lib.rs           (wasm_bindgen exports)─────────────────────────┘
│   ├─ src/eval.rs          (HCE: material/PSQT/mobility/pawns/king/threats/imbalance)
│   ├─ src/motifs.rs        (70+ motif detectors)
│   ├─ src/explanation.rs   (ExplanationBlob composition)
│   ├─ src/piece_value.rs   (per-piece contextual valuation for the heatmap)
│   ├─ src/see.rs           (Static Exchange Evaluation)
│   ├─ src/util.rs          (square / file / colour helpers)
│   ├─ tests/motif_assertions.rs (14 integration tests)
│   └─ build.sh             (wasm-pack + wasm-opt with bulk-memory +
│                            nontrapping-float-to-int features)
└────────────────────────────────────────────┘
```

Everything happens in the browser. The Stockfish Worker runs the search; the main thread runs the WASM-Rust analyzer for static evaluation, motif detection, and explanation-blob composition; React orchestrates the UI. There is no server in the request path.

---

## Tech Stack

| Layer                        | Choice                                                            |
| ---------------------------- | ----------------------------------------------------------------- |
| Framework                    | React 19                                                          |
| Build tool                   | Vite 7                                                            |
| Styling                      | Tailwind CSS 3 + inline styles + a small `index.css` of reusable component classes (`.icon-btn`, `.status-pill`, `.history-token`, `.top-move-row`, `.thin-scroll`, `.analysis-panel`) |
| Chess logic                  | [`chess.js`](https://github.com/jhlywa/chess.js) 1.4              |
| Board                        | [`react-chessboard`](https://github.com/Clariity/react-chessboard) 4.6 |
| Engine                       | [`stockfish`](https://www.npmjs.com/package/stockfish) 18 (lite, single-threaded WASM) — runs in a Web Worker |
| **Analytical core**          | **Rust → WebAssembly** (`engine-rs/`). Exposes `analyze`, `analyze_pv`, `evaluate_fen`, `explain_position`, `piece_contributions`, `piece_value_at` to JS via `wasm-bindgen`. ~150 KB raw / ~37 KB gzipped. |
| Rust crates                  | `shakmaty` (chess rules), `wasm-bindgen` + `serde-wasm-bindgen` + `serde_json` (FFI), `serde` (struct serialisation) |
| Icons                        | `lucide-react` for UI controls; **inline SVG** for chess pieces (`ChessPieceIcon.jsx`) and move-quality glyphs (`QualityIcon.jsx`) so they render consistently across font fallbacks |
| Build pipeline (Rust → WASM) | `wasm-pack build --release --target web`, post-processed by `wasm-opt -O3` with bulk-memory + nontrapping-float-to-int features enabled (see `engine-rs/build.sh`) |
| Tests                        | `cargo test --release` against `engine-rs/tests/motif_assertions.rs` — 14 integration tests for the motif analyzer |
| Lint                         | ESLint 9 (flat config) for JS                                     |

What is **not** in the stack:
- No backend, no database, no API, no auth, no WebSockets.
- No SharedArrayBuffer / COOP-COEP requirements (we use the single-threaded WASM build).
- No external chess-piece SVG library — pieces are inline-rendered from path data we ship.

---

## Project Structure

```
.
├── client/                                       # The deployed app
│   ├── public/
│   │   └── stockfish/
│   │       ├── stockfish-18-lite-single.js       # Web Worker entry
│   │       └── stockfish-18-lite-single.wasm     # ~7 MB engine binary
│   ├── src/
│   │   ├── components/
│   │   │   ├── Board.jsx                         # Main board, two-column layout, captured strips,
│   │   │   │                                     # quality bars, top-moves circles, last-move card
│   │   │   ├── EvalBar.jsx                       # 36 px flat eval bar with inside-bar label
│   │   │   ├── CapturedStrip.jsx                 # Above- and below-board piece strips
│   │   │   ├── PositionQualityBars.jsx           # Bipolar bars per HCE head + Attack potential
│   │   │   │                                     # + GM narrative + Engine plan section
│   │   │   ├── MoveCharacter.jsx                 # Top-moves circle component + engineConsensus()
│   │   │   ├── SettingsPanel.jsx                 # Gear-icon dropdown: depth + multi-PV sliders
│   │   │   ├── Tooltip.jsx                       # Hover-triggered floating popover (portal)
│   │   │   ├── ChessPieceIcon.jsx                # 12 inline-SVG chess piece silhouettes
│   │   │   └── QualityIcon.jsx                   # 8 inline-SVG move-quality glyphs
│   │   ├── engine/                               # ★ The JS analysis layer
│   │   │   ├── engine.js                         # Stockfish Worker wrapper (UCI, queue, timeout,
│   │   │   │                                     # LRU cache, configurable depth via localStorage)
│   │   │   ├── chess.js                          # chess.js helpers (FEN, legal moves, status)
│   │   │   ├── explainer.js                      # Win-rate sigmoid + classifier (with obvious-
│   │   │   │                                     # recapture + only-legal-move guards)
│   │   │   ├── analysis.js                       # Public API: getTopMoves / explainMoveAt
│   │   │   ├── analyzer-rs.js                    # WASM bridge: analyze, explain_position,
│   │   │   │                                     # composeTagline (with phrasesOverlap dedup)
│   │   │   ├── full-explanation.js               # Engine-augmented blob:
│   │   │   │                                     #   engine_attack_potential
│   │   │   │                                     #   principal_plan (PV walked + theme)
│   │   │   │                                     #   composeNarrative (GM-style summary)
│   │   │   ├── openings.js                       # ~40-position opening dictionary
│   │   │   ├── taglines.js                       # Legacy JS taglines (fallback)
│   │   │   └── wasm-rs/                          # Built artefacts (engine_rs.js, .wasm)
│   │   ├── index.css                             # Tailwind + reusable component classes
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
│
├── engine-rs/                                    # ★ Rust → WASM analytical core
│   ├── src/
│   │   ├── lib.rs                                # wasm_bindgen exports
│   │   ├── eval.rs                               # HCE: 7 heads, phased mg/eg
│   │   ├── motifs.rs                             # 70+ motif detectors + composer priority table
│   │   ├── explanation.rs                        # ExplanationBlob composition
│   │   ├── piece_value.rs                        # Per-piece contextual valuation (heatmap)
│   │   ├── see.rs                                # Static Exchange Evaluation
│   │   └── util.rs                               # Square / file / colour helpers
│   ├── tests/
│   │   └── motif_assertions.rs                   # 14 integration tests
│   ├── build.sh                                  # wasm-pack + wasm-opt pipeline
│   ├── Cargo.toml
│   └── pkg/                                      # wasm-pack output (gitignored)
│
├── server/                                       # ★ Legacy. Not required to run the app.
│   └── src/                                      # Reference for the old Node-server pipeline.
│       ├── engine.js
│       ├── chess.js
│       ├── api.js
│       └── explainer.js
│
├── vercel.json                                   # Vercel deploy config
├── .gitignore
└── README.md
```

---

## Prerequisites

- **Node.js 20+** (Node 20.19 / 22.12 recommended for Vite 7).
- A modern browser with WebAssembly support (Chromium, Firefox, Safari, Edge — anything from the last ~5 years).

That's it. **No Stockfish system binary, no server, no Docker.**

---

## Installation

```bash
git clone <your-fork-url> chess_project
cd chess_project/client
npm install
```

`npm install` will download the `stockfish` package; the WASM file used at runtime is already checked into `client/public/stockfish/` (it's content-addressable and ~7 MB).

---

## Running Locally

```bash
cd client
npm run dev          # Vite dev server, usually http://localhost:5173
```

Open the URL Vite prints. First load fetches the WASM (~7 MB, gzipped to ~3 MB on the wire). Subsequent loads use the browser's HTTP cache.

### Production build

```bash
npm run build        # outputs to client/dist/  (~7.3 MB total: WASM dominates)
npm run preview      # serve the built bundle locally
```

---

## Deploy to Vercel

The repo ships with a [`vercel.json`](./vercel.json) that handles the monorepo layout:

- `installCommand`: `cd client && npm ci`
- `buildCommand`: `cd client && npm run build`
- `outputDirectory`: `client/dist`
- Long-lived `Cache-Control` headers on `/stockfish/*` and `/assets/*` (both are content-addressable).

### One-shot deploy

```bash
npm i -g vercel        # if you don't have it
vercel                 # follow the prompts; pick the right team/project name
vercel --prod          # promote to production
```

### Or via the Vercel dashboard

1. **Import** the GitHub repo at <https://vercel.com/new>.
2. Leave **Root Directory** at the repo root (`vercel.json` handles the rest).
3. Click **Deploy**.

That's the entire pipeline. No environment variables, no add-ons, no backend service. The deployed URL serves the static SPA and the WASM, and Stockfish runs in every visitor's browser.

### Other static hosts

The same pattern works on Netlify, Cloudflare Pages, GitHub Pages, S3+CloudFront, or any static host — point them at `client/dist` after running `npm run build`. You may want to set `Cache-Control: public, max-age=31536000, immutable` on `/stockfish/*` and `/assets/*` to match the Vercel headers.

---

## Public API (`client/src/engine/`)

`client/src/engine/analysis.js` is the orchestration layer the UI talks to. The shapes match what the (legacy) server endpoints used to return, so the rest of the app didn't have to change much.

```js
import {
  getTopMoves,
  getBestMove,
  explainMoveAt,
} from './engine/analysis';

// Top N candidate moves for a position (1 ≤ N ≤ 10)
const r = await getTopMoves(fen, 10);
// → { fen, eval_cp, mate, moves: [{ rank, move, san, eval_cp, eval_pawns, pv, isMate, mateIn }, ...] }

// Best move plus principal variation
const r = await getBestMove(fen);
// → { fen, bestMove, san, from, to, eval_cp, mate, pv: [san, ...] }

// Explain a move you just made
const r = await explainMoveAt(fen, 'e2e4');
// → { san, summary, details, quality, factors, motifs, evalBefore, evalAfter, evalDelta, winRateDelta, isTopMove }
```

`quality` is one of: `brilliant | great | best | good | neutral | inaccuracy | mistake | blunder`.
`motifs` is a subset of: `capture | check | checkmate | stalemate | fork | pin | discovered-check | removal-of-defender | sacrifice | castling-kingside | castling-queenside | en-passant | promotion | threefold-repetition | fifty-move-rule | insufficient-material`.

For lower-level access, `client/src/engine/engine.js` exposes `evaluate(fen, depth)`, `analyzeMultiPV(fen, n, depth)`, and `getBestMove(fen, depth)` directly on the Stockfish wrapper.

---

## How positional values are computed

The headline visualization is the **per-piece pawn-value badge** that
appears when you hold Shift. The number on each piece is what the engine
thinks the position would lose if the piece were removed. Concretely, for
a piece on square *S* belonging to side *C*:

```
baseEval     = Stockfish.evaluate(fen, depth=10)
evalWithout  = Stockfish.evaluate(fenWithoutPieceOn(S), depth=10)
delta_cp(S)  = baseEval − evalWithout   if C is white
             = evalWithout − baseEval   if C is black
delta_cp(S)  = clamp(delta_cp(S), −1500, +1500)
```

Two corrections protect the math from mate-encoded scores (the engine
returns ≈ ±100,000 cp for "mate in N"):

1. `ownerValue(eval)` translates either side of the eval to a sane
   owner-relative value. Mate scores fold into ±1000 (owner mates / owner
   gets mated), cp values clamp at ±1500. This stops the naïve subtraction
   from blowing up to ≈ ±1000 pawns.
2. The final `delta_cp` is clamped to **±500 cp** (5 pawns). 5 is enough
   to convey "very important" without making every piece around a mating
   attack read identically as `+15.0` (which conveys no information).

**Delta during drag** is the same thing for the post-move position: when
you hover over a legal destination, every piece's `delta_cp` is recomputed
on the hypothetical post-move FEN and we show the difference vs. its
current value, in pawns. ~16 engine evals per hover, cached per FEN.

## Color interpolation (significance-aware)

Both the labels and (formerly) the square tints use a single significance
curve, but the **scale depends on the piece type** so that a –80 cp drop
on a rook reads lighter than the same drop on a bishop:

```
relative   = |delta_cp| / typical_piece_value
magnitude  = 1 − exp(−relative · calibration)
color      = lerp(white, sign>0 ? green-500 : red-500, magnitude)
```

`typical_piece_value` is `{p:100, n:300, b:320, r:500, q:900}`. We use
`calibration=2` for absolute piece-worth labels and `calibration=3` for
deltas (small swings on big pieces stay near-white; small swings on small
pieces saturate fast). Calibration was tuned against the design intent
"60 cp should read as considerable":

| Piece    | −80 cp  | relative | magnitude (c=3) | result        |
| -------- | ------- | -------- | --------------- | ------------- |
| Pawn     | −80     | 0.80     | 0.91            | strong red    |
| Bishop   | −80     | 0.25     | 0.53            | clear red     |
| Knight   | −80     | 0.27     | 0.55            | clear red     |
| Rook     | −80     | 0.16     | 0.38            | light red     |
| Queen    | −80     | 0.09     | 0.23            | barely tinted |

That matches intuition: an 80 cp drop is small for a queen, big for a pawn.

## Label rendering

- Big (22 px) bold monospace, centered in each square.
- No drop-shadow. Instead a heavy (4 px) text-stroke painted **before** the
  fill in opaque black (`rgba(0, 0, 0, 0.92)`), with bright fills (white
  for ~0, green-300 / red-300 for saturated swings). `paint-order: stroke
  fill` keeps the colored fill crisp on top of the stroke. This is the
  same approach used for legible subtitles on photo/video — it works on
  any underlying square color or piece icon without competing with them.

## Keyboard shortcuts

| Key                | Action                                       |
| ------------------ | -------------------------------------------- |
| `⇧ Shift` (hold)   | Reveal piece-value heatmap                   |
| `←` or `↑`         | Previous position (history)                  |
| `→` or `↓`         | Next position (history)                      |

Heatmap is **also** automatically on while a piece is being dragged, so
the Shift-and-drag combo doesn't fight with the browser's drag handlers
— you can just grab a piece and the live preview kicks in.

## Motif catalog (~50 detectors)

`client/src/engine/taglines.js` runs every top move (and the first 3 plies
of its PV) through `quickExplain` — pure chess.js + geometry, no engine
calls. The catalog below describes what each detector actually checks.
Detectors are conservative: they prefer to miss a motif than to fire a
wrong one.

### Tactical
- `checkmate` / `stalemate` — chess.js terminal-state methods.
- `fork` — moved piece attacks ≥ 2 enemy pieces, at least one is the
  king or worth more than the moving piece.
- `pin` — sliding piece's outward ray contains an enemy piece, then a
  more valuable enemy piece behind it.
- `skewer` — same ray, but the first enemy is more valuable than the
  second (forces the bigger piece to move and lose the smaller).
- `discovered_check` — opponent is in check and the checker is **not**
  the moved piece.
- `sacrifice` — moving piece is left hanging (cheapest attacker < piece
  value) for net material loss ≥ 200 cp.
- `threatens` — moved piece attacks a single enemy piece worth more
  than itself.
- `creates_threat` — an opponent piece that wasn't hanging before is
  now hanging.
- `defends` — a friendly piece that was hanging before is no longer
  hanging.
- `traps_piece` — among the enemy pieces our moved piece attacks, at
  least one has zero safe moves (every legal move lands on a hanging
  square). Validated by actually applying each candidate move and
  checking the resulting hanging state.
- `hangs` — the moving piece itself is left hanging (and didn't recoup
  enough material to count as a sacrifice).

### Captures and trades
- `queen_trade` — queen captures queen.
- `piece_trade` — captured piece is the same type as the mover.
- `exchange_sacrifice` — rook captures minor piece (or vice versa via
  the SEE-style sacrifice path).
- `capture` — generic, when none of the more-specific trade motifs fire.
- `en_passant`, `promotion` — flag-driven.

### King area
- `castles_kingside` / `castles_queenside`.
- `connects_rooks` — after castling, both rooks share the back rank
  with no pieces between them.
- `attacks_king` — moved piece is now closer to the enemy king than
  before, and within 3 squares (only fires when no stronger tactical
  motif applies).
- `luft` — back-rank king + a pawn within two files of it advances by
  one square. Standard "make a hole for the king" idea.
- `pawn_storm` — a pawn move on the same wing as the enemy king,
  advanced past its starting rank, with at least one **other** friendly
  pawn already advanced on the same wing.

### Pieces
- `develops` — knight or bishop moves off the back rank in the opening
  (move number ≤ 12).
- `centralizes` — actual gain in central-square attack count of ≥ 1.5
  (core central squares d4/d5/e4/e5 count double). Doesn't fire just
  because a piece lands on d4 — only when the move *increases* central
  control.
- `outpost` — knight/bishop moves to a square no enemy pawn can ever
  attack, **and** that's either pawn-supported or on rank 5+ (white) /
  rank 4– (black).
- `fianchetto` — bishop to b2/g2 (white) or b7/g7 (black).
- `knight_on_rim` — knight ends on the a- or h-file in the opening
  (move number ≤ 16). Anti-pattern.
- `bad_bishop` — bishop ends on a position where ≥ 5 friendly pawns
  share its color complex (it's hemmed in by its own pawns).
- `bishop_pair_lost` — moving bishop is captured/traded such that we go
  from 2 bishops to 1, while opponent had 2.

### Rooks and files
- `doubles_rooks` — two same-color rooks on the same file after the
  move.
- `open_file` / `semi_open_file` — rook to a file with no friendly
  pawns; "semi-open" if there are enemy pawns on it, "open" if neither.
- `rook_seventh` — rook on its 7th rank (rank 7 for white, rank 2 for
  black).
- `battery` — sliding piece moves so it shares a ray with another
  same-color slider AND that ray terminates at an enemy king, queen, or
  rook. Doesn't fire on aimless line-up.

### Pawn structure
- `pawn_break` — pawn captures another piece.
- `pawn_lever` — single-step pawn push that lands diagonally adjacent
  to an enemy pawn (next move can capture).
- `passed_pawn` — pawn ends on a square with no enemy pawn ahead in
  the same or adjacent files.
- `doubled_pawns_them` — capturing creates a doubled pawn for the
  opponent on the captured file.
- `isolated_pawn` — pawn ends on a file where no friendly pawn occupies
  either adjacent file.
- `backward_pawn_them` — an enemy pawn that wasn't backward before
  becomes backward after the move (no friendly pawn behind on adjacent
  files, and the front square is blocked or covered by an enemy pawn).

### Strategic / contextual
- `restricts` — opponent's pseudo-legal-move count drops by ≥ 4 after
  the move.
- `tempo` — composite: develops + (threatens / attacks_king / creates_threat).

### Fallback policy: silence over filler
If we can't say something *non-obvious* about a move, the tagline is
**empty** and the panel just renders the SAN + eval. Generic phrasing
like "Repositions the rook to b1" or "Pushes the a-pawn to a4" simply
restates the move notation — better to stay silent.

The fallback ladder only emits text for two specific cases:

- **Strong activity gain or loss** (≥ 4 squares attacked Δ): "Activates
  the knight (eyes 9 squares)" / "Pulls the rook back into a passive role"
- **Pawn pushes that materially do something**: 7th-rank push, or a push
  that newly attacks an enemy piece on a diagonal

Anything quieter — back-rank shuffles, pawn moves with no immediate
target — gets no tagline.

### High-signal positional detectors (added this pass)
- **`prepares_castling_kingside` / `_queenside`** — minor piece moves
  off the back rank, freeing the path between king and rook on a side
  where castling rights still exist. Combined with `develops` to
  produce "Develops the bishop, preparing to castle kingside".
- **`attacks_pawn`** — the moved piece *newly* attacks an enemy pawn.
  Surfaces the pawn's weakness when applicable: "Attacks the backward
  d-pawn", "Attacks the isolated c-pawn".
- **`eyes_king_zone`** — long-range piece (B/R/Q) whose newly-attacked
  squares include any of the 3×3 zone around the enemy king. Combined
  with `develops` to produce "Develops the bishop, eyeing the king's
  position".

### Combined phrasing
Some motif pairs read more naturally combined:

- `castles_kingside` + `connects_rooks` → "Castles kingside, connecting the rooks"
- `capture` + `discovered_check` → "Captures the X with discovered check"
- `capture` + `check` → "Captures the X with check"
- `develops` + `threatens` → "Develops the knight with tempo (threatens the bishop)"
- `develops` + `outpost` → "Develops the knight, establishes an outpost on f5"

## Original motif catalog (taglines)

`client/src/engine/taglines.js` runs every top move through `quickExplain`
— pure chess.js + geometry, no engine calls. Each move gets a short
tagline composed from up to two of the highest-priority motifs detected:

**Tactical**: `checkmate`, `sacrifice`, `fork`, `pin`, `skewer`,
`discovered_check`, `removal_of_defender`, `hangs`, `threatens`, `defends`.

**Trades & captures**: `queen_trade`, `piece_trade`, `exchange_sacrifice`,
`capture`, `en_passant`, `promotion`.

**King**: `castles_kingside`, `castles_queenside`, `connects_rooks`,
`attacks_king`, `check`.

**Rooks & files**: `doubles_rooks`, `open_file`, `semi_open_file`,
`rook_seventh`, `battery`.

**Pieces & development**: `develops`, `centralizes`, `outpost`,
`fianchetto`, `tempo`.

**Pawn play**: `pawn_break`, `pawn_lever`, `passed_pawn`, `pawn_storm`,
`doubled_pawns_them`, `isolated_pawn`.

**Endgame states**: `stalemate`, `threefold_repetition`, `fifty_move`,
`insufficient_material`.

Tagline composition picks the top 1–2 motifs by priority and joins them
with a comma. So a knight move that captures a pawn and attacks the queen
reads "Captures the pawn, threatens the queen" (capture > threatens in
priority).

`explainPV` runs `quickExplain` for the first 3 plies of the engine's
preferred line, building a mini-narrative under the selected move:

```
1. Nf3   Develops the knight, threatens the bishop
   Nc6   Develops the knight
   Bb5   Pins the knight to the king
```

## Hanging-piece detection

For every non-king piece on the board, we ask chess.js for `attackers()`
and `defenders()` and apply a cheap-attacker test: if there's any attacker
worth less than the piece itself, the piece is hanging (cheapest exchange
loses material). Hanging squares get a red inset `boxShadow` so loose
pieces are immediately visible.

## Best-move green ring

When you click or pick up a piece, we look at the engine's top move from
the current top-moves response. If it starts on the same square, the
destination square gets a **green inset ring** (the same trick used for
hanging pieces but in green, not red). This gives an instant "is this
the move?" answer without having to read the analysis panel.

## King safety (0–9 overlay on each king)

Pure-FEN heuristic, no engine calls. Components:

- **Pawn shield** (max 6) — pawns directly in front of the king on the
  three files `[kf-1, kf, kf+1]`. A pawn one rank ahead scores 2; two
  ranks ahead scores 1. (So `f2 g2 h2` for a kingside-castled white
  king = 2+2+2 = 6.)
- **Open files near king** — files in `{kf-1, kf, kf+1}` with no
  friendly pawn anywhere. Each one deducts 1.5 points.
- **Attacker weight** — enemy pieces attacking any of the 9 squares in
  the king's 3×3 zone. Pieces are weighted `p:1, n:2, b:2, r:3, q:4`,
  with each attack instance deducting 0.5 points.
- **Castled bonus** — `+1.5` if the king is on the g- or c-file at the
  back rank.
- **Central exposure penalty** — `-3` if the king is on file 2–5 and
  rank 2–5 (out in the middle of the board).

```
raw   = shield − 1.5·openFiles − 0.5·attackerWeight
        + (castled ? 1.5 : 0) − (central ? 3 : 0)
score = round( (clamp(raw, -12, 8) + 12) / 20 · 9 )
```

Rendered as a single digit on each king's square (32 px, heavy black
stroke + bright fill). 0 = wide-open king, 9 = locked-down safe. Color
interpolated from saturated red at 0 through white near 4–5 through
saturated green at 9.

## Material balance + phase

Both are derived from the FEN with no engine calls:

- **Material delta** = sum of `{p:1, n:3, b:3, r:5, q:9}` for white minus
  same for black, displayed as a small green/red badge near the eval.
- **Phase**: `opening` if non-pawn-non-king material is ≥ 30 and move
  number ≤ 12, `endgame` if material ≤ 14, otherwise `middlegame`. Shows
  as an uppercase tag in the header.

## Move classification (Lichess-style)

The classifier matches Lichess's `lila` exactly for the win-rate sigmoid
and the loss thresholds:

```
winRate(cp) = 100 / (1 + exp(-0.00368208 · clamp(cp, -1000, +1000)))
loss        = winRate(bestMoveCp) − winRate(playedMoveCp)   (mover POV, in pp)
```

Loss thresholds (in win-rate percentage points), Lichess values:

| Loss     | Verdict      |
| -------- | ------------ |
| `< 10`   | `good`       |
| `< 20`   | `inaccuracy` |
| `< 30`   | `mistake`    |
| `≥ 30`   | `blunder`    |

On top of the loss ladder we layer three contextual judgments:

- **`brilliant`** — the played move is the engine's top-1 AND it
  involves a real material sacrifice (cheap-attacker check via SEE)
  AND the position wasn't already won (`wrBefore < 85`).
- **`great`** — top-1 with `onlyMoveGap ≥ 10` (the second-best
  alternative is at least 10 pp worse). Catches "only move that holds".
- **`missed_mate`** — the engine's top move had a mate score and the
  played move did not. Surfaces missed forced mates that the loss
  ladder alone might rate as `good` (because both positions are still
  100 % winning by win-rate).

Final ladder, in priority order:

```
brilliant > great > best > missed_mate > {good, inaccuracy, mistake, blunder}
```

`best` is the consolation for top-1 moves that don't qualify as
brilliant or great. Anything not top-1 falls through to either
`missed_mate` (if the engine had a mate that we missed) or the loss
ladder.

## Last-move analysis card

Whenever the user lands on a non-starting position (move played, history
nav, FEN load), the analysis panel's top card runs the full
`explainMoveAt` on the move that produced the current position and shows:

- **Quality badge**: `brilliant` / `great` / `best` / `good` / `neutral`
  / `inaccuracy` / `mistake` / `blunder` — color-coded.
- **Win-rate loss vs. best** if not the engine's top choice.
- Summary + details (uses the same `explainer.js` pipeline that drives
  the click-a-move-to-explain flow).
- "Better was X" line when the played move wasn't best.

## How the Analysis Pipeline Works

### 1. Stockfish WASM Worker (`client/src/engine/engine.js`)
A single Stockfish process runs in a Web Worker. The wrapper:
- Buffers `postMessage` lines so partial UCI responses are never lost.
- Performs a `uci` → `isready` → `readyok` handshake before accepting jobs.
- Enforces a 30-second timeout per job (sends UCI `stop` then rejects, so the queue can't wedge).
- Returns `{ cp, mate }` from `evaluate()` so callers can distinguish `+9.99` pawns from "mate in 3."
- Caches results in an LRU keyed on `(fen, depth, multipv)`.
- Reads default depth + MultiPV from `localStorage` so the in-app **Settings** panel can change them without code changes.

### 2. Top-moves multi-PV
Sets `setoption name MultiPV value N`, runs a single search, and harvests the deepest `info` line per `multipv` slot. Each line is annotated by `analyzer-rs.js`'s `analyzeMove(fen, uci)` which returns `{ san, motifs[], fen_after, ... }`. Tagline composition runs in JS via `composeTagline()`.

### 3. Static evaluator (Rust → WASM, `engine-rs/src/eval.rs`)
A hand-crafted evaluator (HCE) with 7 heads, phased between middlegame and endgame quanta (0..=24):

| head           | what it scores                                                   |
| -------------- | ---------------------------------------------------------------- |
| `material`     | PeSTO-tuned mg/eg piece values                                   |
| `psqt`         | Piece-square tables — knights central, rooks on open files, kings safe in mg / active in eg |
| `mobility`     | Counts of safe attack squares per piece type                     |
| `pawns`        | Islands, doubled, isolated, backward, supported, passed, holes   |
| `king_safety`  | Pawn shield, attacker count + weight, open + half-open files     |
| `threats`      | Lower-value attacker bonuses (knights threatening rooks, etc.)   |
| `imbalance`    | Bishop-pair bonus, opposite-coloured-bishop adjustment, knight-vs-bishop fits |

The evaluator is the source of truth for:
- The eval bar (final cp, white-relative).
- The position-quality bars below the board (per-head deltas).
- Per-piece contextual valuation (`piece_contributions`, `piece_value_at`) used by the heatmap.
- The `phase` classification consumed by motifs (opening / middlegame / endgame).

### 4. Motif analyzer (Rust → WASM, `engine-rs/src/motifs.rs`)
Given (`before`, `after`, `mv`, optional terminal) returns a `Vec<Motif { id, phrase, priority }>`. Each motif is a **rigorous** detector with explicit false-positive guards:

- **Threats / captures**: SEE-aware everywhere. `threatens` only fires if the capture would actually win material. `attacks_pawn` requires defender count < 2 AND SEE ≥ 0. `hangs` doesn't fire on clean trades.
- **Tactical patterns**: fork (≥ 2 SEE-positive targets or king + ≥ 1 SEE-positive), pin (bucketed-value strict), skewer (front strictly heavier), discovered check, double check (split from discovered), Greek gift (Bxh7+ / Bxh2+ with king + follow-up piece), Anastasia's mate (rim-king + knight cut-off + rook), Boden's mate (king + crossfire bishops), Arabian-style (corner + rook + knight ≤ 2), back-rank mate threat (no luft + heavy piece on rank), smothered mate hint, decisive combination (capture + check / threat + ≥ 150 cp swing).
- **Pawn structure**: IQP, hanging pawns (c+d / d+e), passed, supported, backward, isolated, holes, color-complex weakness, pawn breakthrough (capture creates passer), pawn break, pawn lever, pawn storm.
- **Piece play**: knight invasion (deep enemy half + outpost), outpost (suppressed when knight_invasion fired), rook lift (back rank → rank 3/6 on f/g/h), opens-file-for / opens-diagonal-for, fianchetto, long diagonal, rook on 7th, open + half-open files, doubles rooks, battery.
- **King attack**: attacks-king (range + distance), eyes-king-zone (requires ≥ 2 zone squares OR check-line geometry), luft (only fires on real back-rank threats), pawn shield.
- **Strategic / phase-aware**: loses-castling (non-castling K/R move that forfeits rights), prophylaxis (move drops enemy attack count by ≥ 3), multi-purpose (≥ 3 strong-bucket motifs without a headline tactic), activates (middlegame/endgame with eval gain ≥ 25cp), centralises (only on d4/d5/e4/e5; suppressed by outpost / knight_invasion / fianchetto / long_diagonal / rook_seventh / rook_lift / open_file / semi_open_file), develops (opening only), connects rooks.
- **Trade nuance**: simplifies (trade while ≥ +200cp ahead), trades-into-endgame (low-phase same-role swap), trades-when-behind (≤ −200cp), queen trade, piece trade, exchange sacrifice.

A single priority table (`priority_of(id)`) drives the JS composer's ordering.

### 5. The composer (`client/src/engine/analyzer-rs.js`)
`composeTagline(rustResult)` produces the final tagline:
1. **Named patterns subsume their components.** When `greek_gift`, `decisive_combination`, `smothered_hint`, `back_rank_mate_threat`, `anastasia_mate_threat`, `bodens_mate_threat`, `arabian_mate_threat`, or `double_check` fires, that's the headline — supporting motifs are dropped.
2. **Forced/forcing combos** read better as one phrase: "Forks knight and rook with check", "Removes the defender, leaving it undefended", "Rook lift — joining the king attack", "Simplifies by trading knights with check".
3. **Pair fallback with `phrasesOverlap()`** dedup — if the top-2 phrases mention the same role / file-pawn / square, only the higher-priority one wins.
4. **Single phrase** when only one visible motif fired.
5. **Empty** when nothing meaningful fired (better silence than filler).

### 6. ExplanationBlob (`engine-rs/src/explanation.rs`)
The new WASM export `explain_position(fen)` returns a structured blob designed for downstream LLM consumption:

| section            | content                                                          |
| ------------------ | ---------------------------------------------------------------- |
| `material`         | per-side piece counts, bishop pair, opposite-coloured bishops, minor/heavy summary, cp delta, human summary |
| `pawn_structure`   | per side: islands, doubled, isolated, backward, passed, supported, holes, majority side, chains. IQP + hanging pawns + colour-complex flags |
| `king_safety`      | per king: castled, pawn shield 0–100, attacker count + list, open + half-open files to king, weak diagonals, escape-square count, **0–1000 danger score** |
| `activity`         | per side: mobility, squares-in-enemy-half (space), central minors, outposts, bad bishop, passive pieces, long-diagonal control |
| `line_control`     | open files w/ controller, half-open files, long diagonals controller, rooks-on-7th, 7th-rank dominance |
| `tactics`          | hanging pieces with SEE loss, pinned pieces with absolute flag, in-check side |
| `themes`           | synthesised high-level insights with 0–100 strength + description (material edge, bishop pair, king safety, piece activity, space, IQP, colour complex, open files, long diagonals, 7th rank, hanging pieces, leading factor) |
| `eval_breakdown`   | white-relative tapered cp per HCE head                           |
| `verdict`          | one-line summary string                                          |

### 7. Engine-augmented blob (JS, `client/src/engine/full-explanation.js`)
`buildFullExplanation(fen)` combines the static blob with Stockfish multi-PV results:
- **`engine_attack_potential`** — what fraction of the engine's top moves target the king zone (via attacks_king / eyes_king_zone / check / fork / sacrifice / Greek gift / etc. motifs). Drives the "Attack potential" bar in the UI.
- **`principal_plan`** — the engine's PV walked move-by-move, each annotated with motifs and a one-line headline. Plus key squares (visited ≥ 2 times) and an inferred theme (kingside_attack / simplification / piece_activity / pawn_advance / tactics).
- **GM-style narrative** — `composeNarrative(blob)` synthesises a multi-paragraph summary: verdict opener (with move number + phase grounding), leading factor, eval breakdown, material, king safety with engine attack potential, activity, pawn structure, line control, tactics, engine plan. Every claim grounded in the structured blob.

### 8. The classifier (`client/src/engine/explainer.js`)
- **Win-rate sigmoid** — `winRate(cp) = 100 / (1 + e^(-0.00368208·cp))`, the Lichess-exact form. Thresholds operate on the *win-rate delta* from the mover's perspective.
- **Engine top-1 / top-N reference** — fetched alongside the eval. The player's move is compared against the engine's top choice.
- **`brilliant`** — top-1 engine choice + real (SEE-based) sacrifice + complexity ≥ 2 + position not already decided.
- **`great`** — top engine choice in a critical / only-move position. **Demoted to `best`** when the move is an obvious recapture (capture with SEE ≥ 0 AND recovered ≥ moved − 50) or when there's only one legal move — even an only-move isn't a brilliant find if it's mechanical.
- **`missed_mate`** — best move had mate but the played move didn't.
- **`blunder`** — drops winning to losing (wrBefore ≥ 75 → wrPlayed ≤ 35) or raw loss past Lichess threshold.
- **Lichess-style symbols + colour-coded pills + animated SVG quality icons** in the last-move card.

---

## Known Gaps and Problems

### Performance
- **WASM Stockfish runs at ~30-50% of native speed.** Single-threaded by choice — using the multi-threaded build would require setting Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy headers and accepting the deployment complexity. At depth 12 the single-threaded build still answers in well under a second on a modern laptop.
- **First-load WASM download is ~7 MB** (about 3 MB gzipped on the wire). Aggressive `Cache-Control` minimises this on repeat visits.

### Client polish
- **API URL** is no longer used (axios is dead code in `package.json` — should be removed).
- **`alert()` for invalid FEN.** Inline error UI would be friendlier and testable.
- **Auto-promotion to queen.** The engine and explainer support under-promotion, but the UI never offers a knight/rook/bishop choice.
- **Fixed 520 × 520 board.** No responsive layout, unusable on mobile.
- **Tailwind is configured but barely used.** Either commit to Tailwind or drop the dev dependency.
- **`TopMoves.jsx` and `MoveExplanation.jsx` are unused.** The equivalent UI is inlined into `Board.jsx`.
- **No accessibility pass.**
- **Game-status flags** (checkmate / stalemate / threefold / 50-move / insufficient material) are surfaced by the explainer but not rendered in dedicated UI.

### Chess-specific gaps
- **No PGN import/export.**
- **No opening book or endgame tablebase** (Stockfish does the work even for trivial positions).
- **No play-vs-engine / multiplayer / persistence.** This is an analysis cockpit, not a game server.
- **Skewer detection** is approximated by the pin detector; a dedicated motif would be cleaner.

### Cross-cutting
- **No tests.** The explainer's tactical motif logic in particular has enough heuristics that snapshot tests on hand-picked positions would be the highest-leverage place to start.

---

## Roadmap / Future Work

### Quick wins
- [ ] Remove unused `axios` dependency from `client/package.json`.
- [ ] Replace `alert()` for invalid FEN with inline error UI.
- [ ] Render the explainer's `motifs[]` array as chips on the move-explanation panel (factors are already rendered).
- [ ] Surface game-end states (checkmate / stalemate / threefold / 50-move / insufficient material) in the UI.
- [ ] Delete or wire up `TopMoves.jsx` / `MoveExplanation.jsx`.

### Medium-effort improvements
- [ ] **Responsive board** (percentage / `vmin`-based layout).
- [ ] **Under-promotion modal.** Ask the user which piece on pawn promotion.
- [ ] **PGN import/export.** Trivial with `chess.js`.
- [ ] **Engine controls UI.** Expose depth + MultiPV in a settings panel.
- [ ] **First test suite.** Snapshot tests for the explainer (each motif on a hand-picked position).
- [ ] **Multi-threaded Stockfish.** Switch to `stockfish-18-lite.js` (multi-threaded build) and add COOP/COEP headers in `vercel.json` for ~2-4× search speedup.
- [ ] **Loading UX.** Show a small "Loading engine…" indicator on first visit while the WASM downloads.
- [ ] **Service worker / PWA install.** Cache the WASM offline-first; the app already works offline once loaded.

### Bigger directions
- [ ] **Play-vs-engine mode.** Use Stockfish's `setoption name Skill Level` to dial difficulty; add a clock UI.
- [ ] **Game review mode.** Walk a full PGN, run the explainer on every move, surface the worst blunders.
- [ ] **Opening explorer.** Polyglot book lookups so opening moves don't waste engine time.
- [ ] **Endgame tablebase.** Syzygy 6-piece via a remote service (or WASM tablebase if available).
- [ ] **Multiplayer.** Would require a backend — at that point the legacy `server/` code becomes useful again.
- [ ] **Better tactical detection.** Real Static Exchange Evaluation (SEE) for sacrifice scoring; explicit skewer / zwischenzug recognition.

---

## Contributing

This is a personal project for now. If you fork it:

1. Open an issue describing the change you want to make.
2. Keep PRs focused — one fix or feature per branch.
3. If you touch the explainer's heuristics, please add a test (once the test harness exists) so future contributors don't accidentally invalidate your tuning.

---

## License

No license file is currently included. Until one is added, treat the code as **all rights reserved** by the original author.

The bundled Stockfish WASM is licensed under **GPL-3.0** ([Stockfish](https://github.com/official-stockfish/Stockfish), [stockfish.js](https://github.com/nmrugg/stockfish.js)).
