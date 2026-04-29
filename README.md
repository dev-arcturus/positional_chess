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

- **Browser-side Stockfish 18 (lite, single-threaded WASM)** — depth 12–14 search, MultiPV up to 10, principal variation extraction. ~7 MB WASM, gzipped on the wire.
- **No backend** — pure static deploy. Works offline once the WASM has been fetched once.
- **Eval bar** — clamped to ±10 pawns, mate-aware, updates on every move.
- **Top moves panel** — best 10 candidates ranked by centipawn delta, with PV preview.
- **Move explainer** — Lichess-style win-rate sigmoid + tactical motif detection (fork, pin, discovered check, removal-of-defender, sacrifice). `brilliant` requires top-1 engine choice + sacrifice + win-rate maintained; otherwise top-1 → `best`.
- **FEN load + history scrubber** — paste any FEN, walk forwards/backwards through the move list, flip board.
- **LRU cache** in-memory, keyed on `(fen, depth, multipv)` — scrolling back through your move history is instant after the first pass.
- **Visual hints** — best-move arrow overlay on the board.

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
┌───────────────────────────┐                     ┌──────────────────────────────┐
│  React UI (main thread)   │ ───── postMessage ─▶│  Stockfish WASM (Worker)     │
│  Board.jsx → analysis.js  │ ◀──── postMessage ──│  stockfish-18-lite-single    │
│  - chess.js (rules)       │                     │  - UCI protocol              │
│  - explainer.js (motifs)  │                     │  - depth-12/14 search        │
│  - LRU cache              │                     │                              │
└───────────────────────────┘                     └──────────────────────────────┘
```

Everything happens in the browser. The Worker runs the Stockfish engine; the main thread orchestrates analysis, runs the move explainer, and renders the board. There is no server in the request path.

---

## Tech Stack

| Layer            | Choice                                                            |
| ---------------- | ----------------------------------------------------------------- |
| Framework        | React 19                                                          |
| Build tool       | Vite 7                                                            |
| Styling          | Tailwind CSS 3 + inline styles                                    |
| Chess logic      | [`chess.js`](https://github.com/jhlywa/chess.js) 1.4              |
| Board            | [`react-chessboard`](https://github.com/Clariity/react-chessboard) 4.6 |
| Engine           | [`stockfish`](https://www.npmjs.com/package/stockfish) 18 (lite, single-threaded WASM) |
| Icons            | `lucide-react`                                                    |
| Lint             | ESLint 9 (flat config)                                            |

What is **not** in the stack:
- No backend, no database, no API, no auth, no WebSockets.
- No SharedArrayBuffer / COOP-COEP requirements (we use the single-threaded WASM build).

---

## Project Structure

```
.
├── client/                              # The deployed app
│   ├── public/
│   │   └── stockfish/
│   │       ├── stockfish-18-lite-single.js     # Web Worker entry
│   │       └── stockfish-18-lite-single.wasm   # ~7 MB engine binary
│   ├── src/
│   │   ├── components/
│   │   │   ├── Board.jsx                # Main board, history, FEN input, top-moves wiring
│   │   │   ├── EvalBar.jsx              # Vertical eval bar
│   │   │   ├── TopMoves.jsx             # (currently unused — duplicate of inline UI)
│   │   │   └── MoveExplanation.jsx      # (currently unused)
│   │   ├── engine/                      # ★ The analysis pipeline lives here
│   │   │   ├── engine.js                # Stockfish Worker wrapper (UCI, queue, timeout, LRU cache)
│   │   │   ├── chess.js                 # chess.js helpers (FEN, legal moves, game status)
│   │   │   ├── explainer.js             # Win-rate sigmoid + tactical motif detection
│   │   │   └── analysis.js              # Public API: getTopMoves / getBestMove / explainMoveAt
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
│
├── server/                              # ★ Legacy. Not required to run the app.
│   └── src/
│       ├── engine.js                    # Native Stockfish wrapper (was: Express + child_process)
│       ├── chess.js
│       ├── api.js
│       └── explainer.js
│
├── vercel.json                          # Vercel deploy config
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

## How the Analysis Pipeline Works

### 1. Stockfish WASM Worker (`client/src/engine/engine.js`)
A single Stockfish process runs in a Web Worker. The wrapper:
- Buffers `postMessage` lines so partial UCI responses are never lost.
- Performs a `uci` → `isready` → `readyok` handshake before accepting jobs.
- Enforces a 15-second timeout per job (sends UCI `stop` then rejects, so the queue can't wedge).
- Returns `{ cp, mate }` from `evaluate()` so callers can distinguish `+9.99` pawns from "mate in 3."
- Caches results in an LRU keyed on `(fen, depth, multipv)`.

### 2. Top moves
Sets `setoption name MultiPV value N`, runs a single search, and harvests the deepest `info` line per `multipv` slot.

### 3. The explainer (`client/src/engine/explainer.js`)
- **Win-rate sigmoid** — `winRate(cp) = 100 / (1 + e^(-cp/300))`, the same shape Lichess uses. Thresholds operate on the *win-rate delta* from the mover's perspective.
- **Engine top-1 / top-2 reference** — fetched alongside the eval. The player's move is compared against the engine's top choice; matching it plus a real material sacrifice (the moving piece is now hanging for ≥ 200 cp net) upgrades the verdict to `brilliant`.
- **Tactical motif detection** — fork, pin, discovered check, removal-of-defender, sacrifice.
- **Terminal-state shortcuts** — `chessAfter.isCheckmate()` returns immediately with quality `brilliant`; `isStalemate()` flags accidental stalemates as a blunder when the side was previously winning.
- **Positional factors** — PST-based activity, center occupation, development (gated to `moveNumber ≤ 12`), and king-attack proximity.

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
