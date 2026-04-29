# Chess Analysis Studio

A browser-based chess **analysis and visualization tool** that pairs a React UI with a Node/Express backend driving a [Stockfish](https://stockfishchess.org/) engine over UCI. Load any position, see the engine's evaluation in real time, browse the top candidate moves with their principal variations, and get a plain-language explanation of *why* a move is good, bad, or brilliant.

This is **not** a chess server (you cannot play against another human or against the engine yet — see [Roadmap](#roadmap--future-work)). It is an analysis cockpit: think Lichess Analysis Board, scaled down, self-hostable, and easier to extend.

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
- [Configuration](#configuration)
- [API Reference](#api-reference)
- [How the Analysis Pipeline Works](#how-the-analysis-pipeline-works)
- [Development](#development)
- [Known Gaps and Problems](#known-gaps-and-problems)
- [Recent Server Overhaul](#recent-server-overhaul)
- [Roadmap / Future Work](#roadmap--future-work)
- [Contributing](#contributing)
- [License](#license)

---

## Highlights

- **Stockfish-powered evaluation** — depth 12–14 search, MultiPV up to 10, principal variation extraction.
- **Eval bar** — clamped to ±10 pawns, mate-aware (`M3`, `-M5`), updates on every move.
- **Top moves panel** — best 10 candidate moves ranked by centipawn delta, with PV preview and color-coded ratings.
- **Move explainer** — heuristic + engine hybrid that classifies a move as *brilliant / good / neutral / inaccuracy / mistake / blunder* and surfaces contributing factors (capture, check, piece activity, center control, development, castling, king attack).
- **Position heatmaps** — per-piece value heatmap, mobility heatmap (where can this piece usefully go?), and move-preview heatmap (what does the position look like after this move?).
- **FEN load + history scrubber** — paste any FEN, walk forwards/backwards through the move list, flip board.
- **Visual hints** — best-move arrow overlay on the board.

---

## Demo Flow

1. Start the server (Stockfish boots, queue ready).
2. Open the client → starting position renders, eval bar at `0.0`.
3. Make a move on the board → engine re-evaluates → eval bar swings, top-moves list refreshes.
4. Click any move in the top-moves list → blue arrow shows the suggestion, explainer opens with rating + reasoning.
5. Paste a FEN → board jumps to that position; analysis follows.
6. Step backwards through history → state rewinds; analysis recomputes for the past position.

---

## Architecture

```
┌──────────────────┐    HTTP/JSON    ┌──────────────────────┐    UCI/stdio    ┌────────────────┐
│  React + Vite    │ ──────────────▶ │  Express API server  │ ──────────────▶ │  Stockfish     │
│  (chess.js,      │ ◀────────────── │  (job queue,         │ ◀────────────── │  child process │
│  react-chess     │                 │  explainer logic)    │                 │                │
│  board)          │                 │                      │                 │                │
└──────────────────┘                 └──────────────────────┘                 └────────────────┘
```

- The **client** holds game state (current FEN, history index, board orientation) and delegates *all* engine work to the server via REST.
- The **server** owns a single Stockfish process and serializes evaluation requests through an in-memory job queue, so requests never collide on the engine's stdin/stdout.
- The **explainer** is a server-side module that combines the engine's evaluation delta with hand-coded heuristics (piece-square tables, mobility scoring, tactical motifs) to produce human-readable verdicts.

---

## Tech Stack

### Client
| Layer            | Choice                                            |
| ---------------- | ------------------------------------------------- |
| Framework        | React 19                                          |
| Build tool       | Vite 7                                            |
| Styling          | Tailwind CSS 3 + inline styles                    |
| Chess logic      | [`chess.js`](https://github.com/jhlywa/chess.js) 1.4 |
| Board            | [`react-chessboard`](https://github.com/Clariity/react-chessboard) 4.6 |
| HTTP             | Axios                                             |
| Icons            | `lucide-react`                                    |
| Lint             | ESLint 9 (flat config)                            |

### Server
| Layer            | Choice                                            |
| ---------------- | ------------------------------------------------- |
| Runtime          | Node.js (≥ 18 recommended)                        |
| Framework        | Express 5                                         |
| Engine           | Stockfish (any UCI-compatible build)              |
| Engine bridge    | `child_process.spawn` + custom UCI parser         |
| Chess logic      | `chess.js` (same as client, for parity)           |
| Misc             | `cors`, `dotenv`                                  |

### What is **not** in the stack (yet)
- No database, ORM, cache, or persistence layer.
- No WebSocket / Socket.IO — all communication is request/response.
- No authentication, sessions, or user model.
- No test runner on either side.

---

## Project Structure

```
.
├── client/                       # React + Vite frontend
│   ├── public/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Board.jsx           # Board, history, FEN input, top-moves wiring
│   │   │   ├── EvalBar.jsx         # Vertical eval bar with mate handling
│   │   │   ├── TopMoves.jsx        # Candidate move list (currently unused)
│   │   │   └── MoveExplanation.jsx # Move verdict panel (currently unused)
│   │   ├── App.jsx
│   │   ├── App.css
│   │   ├── index.css
│   │   └── main.jsx
│   ├── index.html
│   ├── eslint.config.js
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── vite.config.js
│   └── package.json
│
├── server/                       # Node + Express backend
│   ├── src/
│   │   ├── api.js                  # All REST routes
│   │   ├── chess.js                # Helpers around chess.js
│   │   ├── engine.js               # Stockfish UCI wrapper + job queue
│   │   └── explainer.js            # Move classification + heuristics
│   ├── index.js                    # Entry point (port 3000)
│   └── package.json
│
├── .gitignore
└── README.md                     # ← you are here
```

---

## Prerequisites

- **Node.js 18+** (Node 20 LTS recommended).
- **Stockfish** binary on your `$PATH`, **or** a path supplied via the `STOCKFISH_PATH` env var.
  - macOS: `brew install stockfish`
  - Debian/Ubuntu: `sudo apt-get install stockfish`
  - Windows: download from [stockfishchess.org/download](https://stockfishchess.org/download/) and either add to `PATH` or set `STOCKFISH_PATH`.
- A modern browser (Chromium/Firefox/Safari current).

---

## Installation

```bash
# clone
git clone <your-fork-url> chess_project
cd chess_project

# server deps
cd server
npm install

# client deps
cd ../client
npm install
```

> **Note on package managers**: the server currently has both `package-lock.json` and `yarn.lock` checked in. Pick one (npm *or* yarn) and delete the other to avoid drift. See [Known Gaps and Problems](#known-gaps-and-problems).

---

## Running Locally

You need **two** terminals — one for the server, one for the client.

**Terminal 1 — start the engine + API:**

```bash
cd server
node index.js
# → "Stockfish engine ready"
# → "Server listening on http://localhost:3000"
```

**Terminal 2 — start the Vite dev server:**

```bash
cd client
npm run dev
# → Vite dev server on http://localhost:5173
```

Open <http://localhost:5173> in your browser.

### Production build

```bash
cd client
npm run build      # outputs to client/dist/
npm run preview    # serves the built bundle locally
```

The server has no build step — run it directly with `node index.js` (or wrap it in `pm2`, `systemd`, Docker, etc. — none of which is provided yet).

---

## Configuration

| Variable                | Where    | Default       | Purpose                                                  |
| ----------------------- | -------- | ------------- | -------------------------------------------------------- |
| `STOCKFISH_PATH`        | server   | `stockfish`   | Path to the Stockfish binary.                            |
| `PORT`                  | server   | `3000`        | HTTP port the API listens on.                            |
| `CORS_ORIGIN`           | server   | *(any)*       | Restrict CORS (e.g. `https://chess.example.com`).        |
| `STOCKFISH_POOL_SIZE`   | server   | `1`           | Number of Stockfish processes for parallel analysis.     |
| `STOCKFISH_TIMEOUT_MS`  | server   | `15000`       | Hard timeout per engine job (kills the search).          |
| `STOCKFISH_CACHE_SIZE`  | server   | `1000`        | Max entries in the engine LRU cache (keyed by FEN+depth).|
| API base URL            | client   | `http://localhost:3000/api` | Hard-coded in [`Board.jsx`](client/src/components/Board.jsx). |

`dotenv` is loaded at server startup, so dropping a `.env` file in `server/` works. There is no `.env.example` shipped yet.

---

## API Reference

All endpoints are `POST` and accept/return JSON. Base path: `/api`. There is also a `GET /health` that returns `{ ok: true }`.

| Endpoint                | Body                                | Returns                                                                 |
| ----------------------- | ----------------------------------- | ----------------------------------------------------------------------- |
| `POST /api/eval`        | `{ fen }`                           | `{ eval_cp, mate, status }` — White-POV centipawn eval, mate-in-N (or `null`), and game-state flags. |
| `POST /api/best-move`   | `{ fen }`                           | `{ bestMove, san, from, to, eval_cp, mate, pv[] }`                      |
| `POST /api/top-moves`   | `{ fen, count? }` *(count: 1–10)*   | `{ eval_cp, mate, moves: [{ rank, move, san, eval_cp, eval_pawns, pv, isMate, mateIn }] }` |
| `POST /api/explain-move`| `{ fen, move }` *(move in UCI, e.g. `e2e4` or `e7e8q`)* | `{ san, summary, details, quality, factors, motifs, evalBefore, evalAfter, evalDelta, winRateDelta, isTopMove }` |
| `POST /api/piece-values`| `{ fen }`                           | `{ eval_cp, pieces: [{ square, type, color, delta_cp, delta_pawns }] }` |
| `POST /api/heatmap/current`  | `{ fen }`                      | Grid of per-square values for both sides.                               |
| `POST /api/heatmap/mobility` | `{ fen, square }`              | Grid of move evaluations for the piece on `square` (de-duped destinations). |
| `POST /api/heatmap/preview`  | `{ fen, from, to }`            | Piece-value grid for the position **after** the proposed move.          |

**Errors**:
- `400` — invalid input (missing/malformed FEN, invalid square, out-of-range `count`).
- `504` — Stockfish search timed out (controlled by `STOCKFISH_TIMEOUT_MS`).
- `500` — internal/engine failure with a `message` field.

**Quality values returned by `/api/explain-move`**: `brilliant`, `great`, `best`, `good`, `neutral`, `inaccuracy`, `mistake`, `blunder`. **Motifs** is an array drawn from: `capture`, `check`, `checkmate`, `stalemate`, `fork`, `pin`, `discovered-check`, `removal-of-defender`, `sacrifice`, `castling-kingside`, `castling-queenside`, `en-passant`, `promotion`, `threefold-repetition`, `fifty-move-rule`, `insufficient-material`.

---

## How the Analysis Pipeline Works

### 1. The Stockfish wrapper (`server/src/engine.js`)
A pool of Stockfish processes is spawned at server boot (size controlled by `STOCKFISH_POOL_SIZE`). Each worker maintains a FIFO job queue so requests never collide on the engine's stdin. The wrapper:
- Buffers stdout across chunk boundaries so `info` / `bestmove` lines are always parsed whole.
- Performs a `uci` → `isready` → `readyok` handshake before accepting jobs.
- Enforces a per-job timeout (`STOCKFISH_TIMEOUT_MS`) — on hit, sends UCI `stop` and rejects, so the queue can't wedge.
- Returns `{ cp, mate }` from `evaluate()` so callers can distinguish "+9.99 pawns" from "mate in 3."
- Yields control between jobs via `setImmediate` to avoid recursive stack growth under burst.
- An LRU cache keyed on `(fen, depth, multipv)` short-circuits repeated analysis.

### 2. Top moves (`/api/top-moves`)
Sets `setoption name MultiPV value N`, runs a single search, and harvests the deepest `info` line per `multipv` slot. Each candidate is converted to SAN and surfaces both `cp` and `mate` fields.

### 3. The explainer (`server/src/explainer.js`)
Classifies a move via:
- **Win-rate sigmoid** — `winRate(cp) = 100 / (1 + e^(-cp/300))`, the same shape Lichess uses. Thresholds operate on the *win-rate delta* from the mover's perspective, so a 30cp drop near equality is treated very differently from a 30cp drop in a +5 pawn position.
- **Engine top-1 / top-2 reference** — fetched alongside the eval. The player's move is compared against the engine's top choice; matching the top choice plus a real material sacrifice (the moving piece is now hanging for ≥ 200cp net) upgrades the verdict to `brilliant`.
- **Tactical motif detection** — fork (≥ 2 enemy pieces attacked with king or higher-value targets), pin (sliding piece pins a less-valuable piece in front of a more-valuable one), discovered check (king is in check by a piece that didn't move), removal-of-defender (captured piece was the only defender of a friendly piece that's now hanging).
- **Terminal-state shortcuts** — `chessAfter.isCheckmate()` returns immediately with quality `brilliant`; `isStalemate()` flags accidental stalemates as a blunder when the side was previously winning.
- **Positional factors** — PST-based activity, center occupation, development (gated to `moveNumber ≤ 12`), and king-attack proximity. All `value_pawns` units are pawns for consistency.

### 4. Heatmaps
Three flavors:
- **Current** — for each non-king piece, hypothetically remove it and re-evaluate; the delta is its "value" in this exact position.
- **Mobility** — for each legal target square of a chosen piece, evaluate the resulting position and grade it. Promotion variants are de-duped to a single destination so the search runs once per square instead of four times.
- **Preview** — apply a candidate move, then run the *current* heatmap on the resulting position.

The engine cache absorbs repeated lookups (e.g. scrolling history through the same positions), making heatmap interactions feel near-instant after the first pass.

---

## Development

### Lint
```bash
cd client && npm run lint
```
The server has no lint config.

### Tests
There are none. `server/package.json` has the placeholder `"test": "echo \"Error: no test specified\" && exit 1"`. Adding tests is one of the highest-leverage next steps — see [Roadmap](#roadmap--future-work).

### Debugging Stockfish
If the engine seems unresponsive, log every UCI line at the wrapper layer — the boundary between Node and the child process is the most common source of bugs. Watch out for partial reads on stdout; lines must be split on `\n` and accumulated until terminator events (`bestmove`, `readyok`).

---

## Known Gaps and Problems

The server backend has been hardened recently (see [Recent Server Overhaul](#recent-server-overhaul)). Most remaining issues are on the client and around polish/testing.

### Client (where most of the remaining work lives)
- **API URL is hard-coded** in [`Board.jsx`](client/src/components/Board.jsx). Production deployment requires a code change. Should be `import.meta.env.VITE_API_URL` with a fallback.
- **`alert()` for invalid FEN.** Browser alert for FEN errors. Inline error states would be friendlier and testable.
- **Auto-promotion to queen.** The server now accepts a `promotion` parameter in moves, but the client UI never offers under-promotion (knight/rook/bishop).
- **Fixed 520 × 520 board.** No responsive layout, unusable on mobile.
- **Tailwind is configured but barely used.** Either commit to Tailwind or drop the dev dependency.
- **`TopMoves.jsx` and `MoveExplanation.jsx` are unused.** The equivalent UI is inlined into `Board.jsx`. Delete them or refactor `Board.jsx` to use them.
- **No loading or error states** while Stockfish initializes (~1s on cold start) or while a long search runs.
- **No accessibility pass** — no ARIA labels, no keyboard navigation, color-only eval indicators.
- **Game-status flags from `/api/eval`** (checkmate / stalemate / threefold / 50-move-rule / insufficient material) are now returned by the server but not surfaced in the UI.
- **New `quality` values** (`brilliant`, `best`, `great`) and `motifs` (fork, pin, discovered-check, sacrifice, …) returned by `/api/explain-move` are not rendered yet.

### Server (smaller items remaining)
- **No rate limiting.** A single client could still pin all Stockfish workers — though the per-job timeout (`STOCKFISH_TIMEOUT_MS`) caps individual damage.
- **Bad-FEN robustness on the engine itself.** Validation now happens at the API edge, but if Stockfish ever crashes mid-job, the worker isn't auto-restarted (the pool member becomes unusable). A worker-respawn loop would help long uptimes.
- **`removePiece` can produce illegal positions** (e.g. removing a pinned defender leaves the side-to-move's king in check). Stockfish will still evaluate but the result is meaningless. Used only by the heatmap endpoints.

### Cross-cutting
- **No tests.** Engine wrapper, explainer (now with tactical motifs), and API contract are all untested. Snapshot tests for the explainer on known positions would be the highest-leverage place to start.
- **No PGN import/export.** You can paste a FEN, but you can't paste a full PGN.
- **No opening book or endgame tablebase.** Stockfish does the work even for trivial positions.
- **No draw-offer / resign / play-mode flow** — the project is still analysis-only.
- **`server/node_modules/` history still in git.** The current `HEAD` is clean (untracked + gitignored), but the deletion isn't committed yet — `git status` shows ~600 staged removals waiting for a commit.

---

## Recent Server Overhaul

The server modules (`engine.js`, `chess.js`, `api.js`, `explainer.js`, `index.js`) were rewritten recently. Highlights:

**Reliability**
- stdout buffering across chunk boundaries (no more silently dropped `info` lines).
- `uci` → `isready` → `readyok` handshake before accepting jobs.
- Per-job timeout that sends UCI `stop` and rejects, so the queue never wedges.
- `setImmediate`-based queue draining (no recursive stack growth).
- Graceful `SIGINT` / `SIGTERM` handlers that close the HTTP server and `quit` Stockfish cleanly.
- `PORT` and `CORS_ORIGIN` env vars are now honored.

**Performance**
- LRU cache (size `STOCKFISH_CACHE_SIZE`, default 1000) keyed on `(fen, depth, multipv)`. Heatmap re-renders on the same position are now near-instant.
- Stockfish process pool (`STOCKFISH_POOL_SIZE`, default 1) with least-busy dispatch — set to 4 for ~4× faster heatmaps on multi-core hardware.
- Mobility heatmap de-dupes promotion squares so a pawn with 4 promotion variants triggers 1 search instead of 4.

**API correctness**
- `validateFen` middleware on every endpoint. Bad FEN now returns `400`, never reaches the engine.
- `count` for `/api/top-moves` validated as an integer in `[1, 10]` (returns `400` otherwise instead of silently capping).
- `/api/eval` now returns `{ eval_cp, mate, status }` — mate-in-N is no longer flattened to ±9999cp, and game-state flags are exposed.
- `piece-values` and `heatmap/current` now share a single `computePieceValues` helper.
- `504` returned on engine timeout (with message), `400` on bad input, `500` only on truly unexpected failures.

**Explainer rewrite**
- Win-rate sigmoid (`100 / (1 + e^(-cp/300))`) for quality classification — same shape Lichess uses. A 30cp drop near equality is now treated very differently from the same drop at +5 pawns.
- Real terminal-state handling: `isCheckmate()` returns `quality: 'brilliant'` with a clear summary; `isStalemate()` flags accidental stalemates as a blunder when previously winning.
- Castling detected via `chess.js` move flags, not SAN string match (no more breakage on `O-O+` / `O-O#`).
- Tactical motif detection: **fork**, **pin**, **discovered check**, **removal of defender**, **sacrifice**.
- "Brilliant" upgrade requires (a) move equals engine top choice, (b) sacrifice detected, (c) win-rate doesn't drop. Otherwise an engine-top move gets `quality: 'best'`.
- "Development" only fires through move 12 — `Nf3` on move 30 no longer gets credit for "developing".
- All factor `value_pawns` are in pawns (consistent units).
- Dead `analyzePosition` removed.

---

## Roadmap / Future Work

Grouped by likely effort and value. Most server-side quick wins from the previous version of this list have been completed (see [Recent Server Overhaul](#recent-server-overhaul)).

### Quick wins (a day or less)
- [ ] Move the API base URL into a Vite env var (`VITE_API_URL`) with a localhost fallback.
- [ ] Replace `alert()` for invalid FEN with inline error UI.
- [ ] Add a `.env.example` documenting `STOCKFISH_PATH`, `PORT`, `CORS_ORIGIN`, `STOCKFISH_POOL_SIZE`, `STOCKFISH_TIMEOUT_MS`, `STOCKFISH_CACHE_SIZE`.
- [ ] Surface server-returned `status` (checkmate/stalemate/threefold/50-move/insufficient material) in the UI.
- [ ] Render the new `quality` values (`brilliant`, `best`, `great`) and `motifs` array on the move-explanation panel.
- [ ] Delete or wire up `TopMoves.jsx` and `MoveExplanation.jsx`.
- [ ] Commit the staged `server/node_modules/` deletion so `git log` stops carrying ~600 dead files.

### Medium-effort improvements
- [ ] **Responsive board.** Switch the chessboard width to a percentage / `vmin`-based layout.
- [ ] **Under-promotion UI.** Modal for choosing promotion piece on the 8th/1st rank (the server already accepts the `promotion` parameter).
- [ ] **PGN import/export.** Trivial with `chess.js` — round-trip the move list.
- [ ] **Engine controls UI.** Expose depth, MultiPV, and pool size in a settings panel.
- [ ] **First test suite.** Snapshot tests for the explainer (each motif on a hand-picked position), contract tests for the API, and an integration test that boots Stockfish and runs a known mate-in-2.
- [ ] **Linter for the server** (ESLint + minimal config).
- [ ] **Worker auto-restart.** If a Stockfish process crashes, respawn it instead of leaving a dead pool member.
- [ ] **Rate limiting** on the API (e.g. `express-rate-limit`).
- [ ] **Dockerfile + docker-compose** so the engine, API, and client come up with one command.
- [ ] **Accessibility pass** — ARIA labels, keyboard piece movement, eval bar text alternative.

### Bigger directions
- [ ] **Play-vs-engine mode.** The engine wrapper is already there; you mostly need a "computer move" loop, a difficulty slider (Stockfish skill level / `Elo`), and a clock UI.
- [ ] **Multiplayer over WebSocket.** Express → Socket.IO or `ws`. Match rooms, move broadcasting, optional spectators.
- [ ] **Persistence.** Postgres or SQLite for users, games, and saved analyses. Probably needs auth too.
- [ ] **Auth.** Even a simple session/JWT layer once persistence exists.
- [ ] **Game review mode.** Walk a full PGN, classify each move using the explainer, surface the worst blunder with the engine's preferred line.
- [ ] **Opening explorer.** Polyglot book or Lichess masters DB lookups so opening moves don't waste engine time.
- [ ] **Endgame tablebase.** Syzygy 6-piece for perfect play in K+P+P-style endings.
- [ ] **Better tactical detection.** Real Static Exchange Evaluation (SEE) for sacrifice scoring; skewer detection (currently lumped into pins); zwischenzug / intermezzo recognition.
- [ ] **Cloud-hosted demo.** Fly.io / Render / Railway-style deploy, with origin-restricted CORS.

---

## Contributing

This is a personal project right now, so there is no formal contribution process. If you fork it:

1. Open an issue describing the change you want to make.
2. Keep PRs focused — one fix or one feature per branch.
3. If you touch the explainer's heuristics, please add a snapshot test (once the test harness exists) so future contributors don't accidentally invalidate your tuning.

---

## License

No license file is currently included. Until one is added, treat the code as **all rights reserved** by the original author. If you want others to use, fork, or contribute, add an `MIT` or `Apache-2.0` `LICENSE` file at the repository root.
