import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';
import {
  RefreshCw, RotateCcw, ChevronLeft, ChevronRight,
  Shuffle,
} from 'lucide-react';
import EvalBar from './EvalBar';
import QualityIcon from './QualityIcon';
import ChessPieceIcon from './ChessPieceIcon';
import SettingsPanel from './SettingsPanel';
import AboutPosition from './AboutPosition';
import { explainPosition, isReady as wasmIsReady } from '../engine/analyzer-rs';
import { buildFullExplanation } from '../engine/full-explanation';
import { pickRandomPosition } from '../engine/positions';
import { topConsequenceLine } from '../engine/connectors';
import {
  getTopMoves,
  explainMoveAt,
} from '../engine/analysis';
import { getPieceValues, streamDestinationValues } from '../engine/heatmap';
import { findOpeningFromHistory } from '../engine/openings';

// Replace the leading piece letter in a SAN with the matching unicode chess
// glyph (white pieces for white moves, black for black). Pawns are left as
// algebraic ("e4", "exd5"). O-O / O-O-O are passed through unchanged.
// Move-history rendering: strip the leading piece letter from SAN and
// return the bare move suffix. The token component pairs this with a
// `<ChessPieceIcon>` so the piece glyph renders consistently as SVG.
//
// Returns `{ piece: ?'k'|'q'|'r'|'b'|'n', rest }` — a render-friendly tuple.
function sanWithPieces(san, isWhiteMove) {
  if (!san) return { piece: null, rest: san || '' };
  if (san.startsWith('O-')) return { piece: null, rest: san };
  const head = san[0];
  const PIECE_LETTERS = { K: 'k', Q: 'q', R: 'r', B: 'b', N: 'n' };
  const piece = PIECE_LETTERS[head];
  if (piece) return { piece, rest: san.slice(1) };
  return { piece: null, rest: san };
}

// Standard piece values used to scale "how much should we worry about this
// change?" per piece. An 80cp drop on a rook is small (16%); on a bishop
// it's significant (25%). Color saturation reflects that.
const TYPICAL_PIECE_CP = { p: 100, n: 300, b: 320, r: 500, q: 900, k: 900 };

// Magnitude curve: 1 - exp(-relative * calibration), where `relative` is
// |delta_cp| / typical_piece_value. Calibrations:
//   c=3 (deltas, more conservative): 16% rel → 0.38, 25% → 0.53, 50% → 0.78
//   c=2 (absolute piece worth):      50% → 0.63, 100% → 0.86, 200% → 0.98
// So a -80cp swing on a rook (16% rel, c=3) is lightly tinted (~0.38),
// while -80cp on a bishop (25% rel, c=3) is meaningfully red (~0.53).
function magnitudeRelative(cp, pieceType, calibration) {
  const typical = TYPICAL_PIECE_CP[pieceType] || 100;
  const relative = Math.abs(cp) / typical;
  return 1 - Math.exp(-relative * calibration);
}
function lerp(a, b, t) { return a + (b - a) * t; }

// White → red/green text color. Brighter base so near-zero values
// pop against the dark stroke even on light squares; high-saturation
// targets so big swings are unmissable.
function colorForCp(cp, pieceType = 'q', calibration = 3) {
  const mag = magnitudeRelative(cp, pieceType, calibration);
  const W = [255, 255, 255];                            // pure white base
  const TARGET = cp >= 0 ? [134, 239, 172] : [252, 165, 165]; // green-300 / red-300
  const r = Math.round(lerp(W[0], TARGET[0], mag));
  const g = Math.round(lerp(W[1], TARGET[1], mag));
  const b = Math.round(lerp(W[2], TARGET[2], mag));
  return `rgb(${r}, ${g}, ${b})`;
}

// (Random-position library now lives in `client/src/engine/positions.js`
//  and includes Saavedra, Réti, Lucena, Philidor, Vancura, Kasparov–
//  Topalov, Marshall–Capablanca, Polugaevsky–Nezhmetdinov, classic
//  studies, and pawn-structure templates. Keep the previous inline
//  list as a fallback in case positions.js fails to load.)
const RANDOM_POSITIONS_FALLBACK = [
  // — Openings (just out of theory) —
  // Italian, Giuoco Pianissimo
  'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 4 4',
  // Sicilian Najdorf
  'rnbqkb1r/1p2pppp/p2p1n2/8/3NP3/2N5/PPP2PPP/R1BQKB1R w KQkq - 0 6',
  // Queen's Gambit Declined, Orthodox
  'rnbqk2r/ppp1bppp/4pn2/3p4/2PP4/2N2N2/PP2PPPP/R1BQKB1R w KQkq - 0 5',
  // French Defense, Tarrasch
  'rnbqkb1r/pp3ppp/4pn2/2pp4/3P4/2N1PN2/PPP2PPP/R1BQKB1R w KQkq - 0 5',
  // King's Indian Defense
  'rnbqk2r/ppp1ppbp/3p1np1/8/2PPP3/2N2N2/PP3PPP/R1BQKB1R b KQkq - 1 5',
  // Caro-Kann, Panov-Botvinnik
  'rnbqkbnr/pp2pppp/2p5/3p4/2PPP3/8/PP3PPP/RNBQKBNR b KQkq - 0 3',
  // Sveshnikov Sicilian
  'r1bqkb1r/5ppp/p1np1n2/1p2p3/4P3/N1N5/PPP2PPP/R1BQKB1R w KQkq - 0 8',
  // London System
  'rnbqkb1r/ppp1pppp/5n2/3p4/3P1B2/5N2/PPP1PPPP/RN1QKB1R b KQkq - 2 3',
  // English Opening
  'rnbqkb1r/pppp1ppp/4pn2/8/2P5/2N2N2/PP1PPPPP/R1BQKB1R b KQkq - 3 3',
  // King's Gambit Accepted
  'rnbqkbnr/pppp1ppp/8/8/4Pp2/8/PPPP2PP/RNBQKBNR w KQkq - 0 3',
  // — Sharp middlegames —
  // Italian-style attack with c3-d4 push
  'r1bqk2r/pp1pbppp/2n2n2/2p5/3PP3/2P2N2/PP3PPP/RNBQKB1R w KQkq - 1 7',
  // King's Indian middlegame, both sides castled
  'r1bq1rk1/ppp1npbp/2np2p1/4p3/2PPP3/2N1BN2/PP1QBPPP/R3K2R w KQ - 1 8',
  // Sicilian Dragon middlegame
  'r1bq1rk1/pp2ppbp/2np1np1/8/3NP3/2N1B3/PPPQBPPP/R3K2R w KQ - 4 9',
  // Tactical position with queens still on
  'r2qkb1r/1p1n1ppp/p2p1n2/4p3/4P3/1NN5/PPP1BPPP/R1BQ1RK1 w kq - 0 9',
  // Late middlegame, queens off, active rooks
  '2r3k1/p4p1p/1p1q2p1/3p4/3P4/1B3Q2/P4PPP/2R3K1 w - - 0 24',
  // — Endgames —
  // Rook + pawn endgame (Lucena-ish setup)
  '4k3/p4p2/1p2p3/2p5/8/2P5/PP3PP1/3R2K1 w - - 0 1',
  // Knight vs bishop endgame
  '8/4kpp1/8/3n4/2B5/8/4KPP1/8 w - - 0 1',
  // King + pawn endgame, opposition
  '8/8/8/3k4/3P4/3K4/8/8 w - - 0 1',
  // Minor-piece middlegame, balanced
  'r1b2rk1/ppp2ppp/2n2n2/3pp3/8/2NPPN2/PPP2PPP/R1B2RK1 w - - 0 9',
  // Queen + rook endgame
  '6k1/5ppp/8/8/8/2Q5/5PPP/4R1K1 w - - 0 1',
];

// Fallback retained for safety; preferred path goes through the imported
// `pickRandomPosition` from positions.js.
function pickRandomPositionFallback() {
  return RANDOM_POSITIONS_FALLBACK[Math.floor(Math.random() * RANDOM_POSITIONS_FALLBACK.length)];
}

export default function Board() {
  // Position state
  const [fen, setFen] = useState('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  const [inputFen, setInputFen] = useState(fen);
  const [orientation, setOrientation] = useState('white');

  // Move history for back/forward
  const [moveHistory, setMoveHistory] = useState([{ fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', san: null }]);
  const [historyIndex, setHistoryIndex] = useState(0);

  // Analysis state
  const [evalCp, setEvalCp] = useState(null);
  const [evalMate, setEvalMate] = useState(null);
  const [gameResult, setGameResult] = useState(null);  // '1-0' / '0-1' / '½-½' / null
  const [loading, setLoading] = useState(false);
  const [topMoves, setTopMoves] = useState([]);
  const [topMovesLoading, setTopMovesLoading] = useState(false);

  // Selected move for analysis
  const [selectedMoveIndex, setSelectedMoveIndex] = useState(null);
  const [explanation, setExplanation] = useState(null);
  const [explanationLoading, setExplanationLoading] = useState(false);

  // (Hint state removed — the analysis panel on the right shows the top
  // moves with arrows; a separate Hint button is redundant.)

  // Opening name (looked up by FEN over the entire history; once you're
  // out of book, the last-known opening sticks).
  const [openingName, setOpeningName] = useState(null);

  // Comprehensive structured POSITION explanation blob.
  //
  // Rolled out in two waves so the UI never has to wait on engine
  // analysis to render *something*:
  //   1. **Static layer** — `explainPosition(fen)`, returns ~1ms.
  //      Sets `posExplanation` immediately so the AboutPosition
  //      panel draws.
  //   2. **Engine-augmented layer** — `buildFullExplanation(fen)` runs
  //      Stockfish multi-PV in the background and overlays
  //      `engine_attack_potential`, `principal_plan`, and engine-derived
  //      themes on top of the static blob. Replaces `posExplanation`
  //      when ready (typically within 1-2 seconds).
  //
  // We *also* keep the previous-position blob (`prevPosExplanation`)
  // so the consequence-connectors module can diff before/after across
  // the played move. That diff is what lets us say "trading queens
  // quenches Black's attack" or "Castles, but White's king is now on
  // an open file" — second-order effects only visible when you
  // compare two snapshots, not in either alone.
  const [posExplanation, setPosExplanation] = useState(null);
  const [prevPosExplanation, setPrevPosExplanation] = useState(null);
  React.useEffect(() => {
    if (!wasmIsReady() || !fen) return;
    let cancelled = false;
    // Capture the current (about-to-become-previous) blob BEFORE we
    // overwrite it with the new fen's blob. The lambda runs inside
    // the same effect tick so React's batching keeps this consistent.
    setPrevPosExplanation(prev => posExplanation || prev);
    const handle = setTimeout(() => {
      if (cancelled) return;
      // Fast path.
      const staticE = explainPosition(fen);
      if (!cancelled && staticE) setPosExplanation(staticE);
      // Slow path.
      buildFullExplanation(fen).then(full => {
        if (!cancelled && full) setPosExplanation(full);
      }).catch(() => { /* static is enough */ });
    }, 0);
    return () => { cancelled = true; clearTimeout(handle); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fen]);

  // (`lastMoveConsequence` was here, but it referenced `lastMoveAnalysis`
  //  which is declared further down — that triggers a temporal-dead-zone
  //  ReferenceError at render time. Moved below the lastMoveAnalysis
  //  declaration.)

  // Click-to-select with legal-move indicators (also set during drag).
  const [selectedSquare, setSelectedSquare] = useState(null);

  // Drag state — tracked separately from selectedSquare so we know when
  // we're inside a drag gesture (live-preview only fires during drag).
  const [isDragging, setIsDragging] = useState(false);
  const [dragHover, setDragHover] = useState(null);

  // Heatmap is hidden by default — the board stays clean. Hold Shift to
  // reveal piece-worth labels. When the keyboard listener flips this
  // flag, the existing useEffect fires the engine and labels appear.
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [heatmapPieces, setHeatmapPieces] = useState(null);
  const [heatmapLoading, setHeatmapLoading] = useState(false);

  // Per-destination "if you moved here, this piece would be worth X" map.
  // Streamed in by streamDestinationValues as the engine completes each
  // hypothetical-move evaluation; keys are destination squares.
  const [destValues, setDestValues] = useState({});

  // Full preview heatmap for the position assuming the dragged piece lands
  // on dragHover. Drives the live "every other piece changes" rendering
  // while the user is moving a piece.
  const [previewHeatmap, setPreviewHeatmap] = useState(null);

  const lastFetchedFen = useRef('');
  const sideToMove = fen.split(' ')[1] || 'w';

  // Fetch top moves
  const fetchTopMoves = useCallback(async (currentFen) => {
    if (lastFetchedFen.current === currentFen) return;
    lastFetchedFen.current = currentFen;

    setTopMovesLoading(true);
    try {
      const result = await getTopMoves(currentFen, 10);
      setTopMoves(result.moves || []);
      setEvalCp(result.eval_cp);
      setEvalMate(result.mate ?? null);
      setGameResult(result.result ?? null);
    } catch (error) {
      console.error("Top moves failed", error);
    } finally {
      setTopMovesLoading(false);
    }
  }, []);

  // Fetch move explanation (on click)
  const fetchExplanation = useCallback(async (move) => {
    setExplanationLoading(true);
    try {
      const result = await explainMoveAt(fen, move.move);
      setExplanation(result);
    } catch (error) {
      console.error("Explanation failed", error);
    } finally {
      setExplanationLoading(false);
    }
  }, [fen]);


  // Fetch on FEN change — also resets selection + heatmap / preview data
  // so we don't briefly show stale colors from the previous position.
  useEffect(() => {
    fetchTopMoves(fen);
    setExplanation(null);
    setSelectedMoveIndex(null);
    setSelectedSquare(null);
    setHeatmapPieces(null);
    setDestValues({});
    setPreviewHeatmap(null);
    setDragHover(null);
    setIsDragging(false);
  }, [fen, fetchTopMoves]);

  // Piece-values heatmap fetcher. Fires whenever the heatmap could be
  // visible — so on Shift-hold AND on drag-begin — so labels are ready
  // by the time the user wants them.
  useEffect(() => {
    if (!showHeatmap && !isDragging) return;
    let cancelled = false;
    setHeatmapLoading(true);
    getPieceValues(fen)
      .then(r => { if (!cancelled) setHeatmapPieces(r); })
      .catch(e => console.error('piece-values failed:', e))
      .finally(() => { if (!cancelled) setHeatmapLoading(false); });
    return () => { cancelled = true; };
  }, [showHeatmap, isDragging, fen]);

  // Stream "moved-piece-value at each legal destination" as soon as a
  // piece is selected (click) or picked up (drag). Each destination's
  // value lands one at a time — labels render progressively rather than
  // waiting for the whole batch.
  useEffect(() => {
    setDestValues({});
    if (!selectedSquare) return;
    const cancel = streamDestinationValues(fen, selectedSquare, (r) => {
      setDestValues(prev => ({ ...prev, [r.dest]: r }));
    });
    return cancel;
  }, [selectedSquare, fen]);

  // Live preview during drag: when the dragged piece is hovering over a
  // legal destination, fetch the full heatmap for the position assuming
  // the move was played. Drives the "every other piece updates" effect.
  useEffect(() => {
    if (!isDragging || !dragHover || !selectedSquare) {
      setPreviewHeatmap(null);
      return;
    }
    const newFen = makeMoveLocal(fen, selectedSquare, dragHover);
    if (!newFen) {
      setPreviewHeatmap(null);
      return;
    }
    let cancelled = false;
    getPieceValues(newFen)
      .then(r => { if (!cancelled) setPreviewHeatmap(r); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isDragging, dragHover, selectedSquare, fen]);

  // Local make-move helper that doesn't import the heatmap module's chess
  // helpers (we have chess.js right here).
  function makeMoveLocal(currentFen, from, to) {
    try {
      const c = new Chess(currentFen);
      const m = c.move({ from, to, promotion: 'q' });
      if (m) return c.fen();
    } catch { /* illegal */ }
    return null;
  }

  // Opening lookup walks the move history backwards and surfaces the most
  // recent matching position, so "Italian Game" stays visible even after
  // you're out of book.
  useEffect(() => {
    const fens = moveHistory.slice(0, historyIndex + 1).map(m => m.fen);
    setOpeningName(findOpeningFromHistory(fens));
  }, [historyIndex, moveHistory]);

  // Keyboard shortcuts:
  //   ⇧ Shift (hold) → reveal piece-value heatmap
  //   ←  ↑           → previous position in history
  //   →  ↓           → next position in history
  // Heatmap is also auto-on while a piece is being dragged, so the
  // Shift+drag interaction is always "drag = preview" without extra keys.
  useEffect(() => {
    function onKeyDown(e) {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Shift') {
        setShowHeatmap(true);
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        if (historyIndex > 0) {
          const newIndex = historyIndex - 1;
          setHistoryIndex(newIndex);
          lastFetchedFen.current = '';
          setFen(moveHistory[newIndex].fen);
          setInputFen(moveHistory[newIndex].fen);
        }
        e.preventDefault();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        if (historyIndex < moveHistory.length - 1) {
          const newIndex = historyIndex + 1;
          setHistoryIndex(newIndex);
          lastFetchedFen.current = '';
          setFen(moveHistory[newIndex].fen);
          setInputFen(moveHistory[newIndex].fen);
        }
        e.preventDefault();
      }
    }
    function onKeyUp(e) {
      if (e.key === 'Shift') setShowHeatmap(false);
    }
    function onBlur() { setShowHeatmap(false); }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [historyIndex, moveHistory]);

  // The heatmap should be visible whenever (a) the user is holding Shift
  // OR (b) a piece is currently being dragged. The drag-preview is the
  // killer feature — auto-enabling avoids the "Shift breaks drag" issue.
  const heatmapVisible = showHeatmap || isDragging;

  // Handle move click in analysis panel
  const handleMoveClick = (move, index) => {
    if (selectedMoveIndex === index) {
      setSelectedMoveIndex(null);
      setExplanation(null);
    } else {
      setSelectedMoveIndex(index);
      fetchExplanation(move);
    }
  };

  // While dragging a piece, treat it as "selected" so the legal-move dots
  // appear underneath it. Setting isDragging = true also gates the live
  // preview heatmap.
  function onPieceDragBegin(_piece, sourceSquare) {
    setSelectedSquare(sourceSquare);
    setIsDragging(true);
    setDragHover(null);
  }
  function onPieceDragEnd() {
    setSelectedSquare(null);
    setIsDragging(false);
    setDragHover(null);
  }

  // Fired by react-chessboard while a piece is being dragged over a square.
  // We only want to set dragHover on legal destinations of the dragged
  // piece (so previewHeatmap doesn't fire for nonsense squares).
  function onDragOverSquare(square) {
    if (!isDragging || !selectedSquare || square === selectedSquare) {
      setDragHover(null);
      return;
    }
    try {
      const game = new Chess(fen);
      const moves = game.moves({ square: selectedSquare, verbose: true });
      const isLegal = moves.some(m => m.to === square);
      setDragHover(isLegal ? square : null);
    } catch {
      setDragHover(null);
    }
  }

  // Make a move (drag-drop)
  function onDrop(sourceSquare, targetSquare) {
    try {
      const game = new Chess(fen);
      const move = game.move({ from: sourceSquare, to: targetSquare, promotion: 'q' });
      if (move) {
        const newFen = game.fen();
        lastFetchedFen.current = '';

        // Update history - truncate any future moves
        const newHistory = moveHistory.slice(0, historyIndex + 1);
        newHistory.push({ fen: newFen, san: move.san });

        setMoveHistory(newHistory);
        setHistoryIndex(newHistory.length - 1);
        setFen(newFen);
        setInputFen(newFen);
        setSelectedSquare(null);
        return true;
      }
    } catch (e) {
      console.error("Move failed:", e);
    }
    return false;
  }

  // Click-to-select (and click-to-move when a piece is already selected).
  // Mirrors the standard Lichess / Chess.com flow.
  function onSquareClick(square) {
    const game = new Chess(fen);

    // If a piece is already selected and the user clicks a different square,
    // try to interpret it as a move.
    if (selectedSquare && selectedSquare !== square) {
      try {
        const move = game.move({ from: selectedSquare, to: square, promotion: 'q' });
        if (move) {
          const newFen = game.fen();
          lastFetchedFen.current = '';
          const newHistory = moveHistory.slice(0, historyIndex + 1);
          newHistory.push({ fen: newFen, san: move.san });
          setMoveHistory(newHistory);
          setHistoryIndex(newHistory.length - 1);
          setFen(newFen);
          setInputFen(newFen);
          setSelectedSquare(null);
          return;
        }
      } catch { /* not a legal move from selected square */ }
    }

    // Otherwise: select / deselect.
    const piece = game.get(square);
    if (selectedSquare === square) {
      setSelectedSquare(null);
    } else if (piece && piece.color === game.turn()) {
      setSelectedSquare(square);
    } else {
      setSelectedSquare(null);
    }
  }

  // Navigate history
  const goBack = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      lastFetchedFen.current = '';
      setFen(moveHistory[newIndex].fen);
      setInputFen(moveHistory[newIndex].fen);
    }
  };

  const goForward = () => {
    if (historyIndex < moveHistory.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      lastFetchedFen.current = '';
      setFen(moveHistory[newIndex].fen);
      setInputFen(moveHistory[newIndex].fen);
    }
  };

  // Reset board
  const resetBoard = () => {
    const startFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    lastFetchedFen.current = '';
    setMoveHistory([{ fen: startFen, san: null }]);
    setHistoryIndex(0);
    setFen(startFen);
    setInputFen(startFen);
  };

  // Load a random plausible position from the curated list.
  const loadRandomPosition = () => {
    const newFen = pickRandomPosition();
    lastFetchedFen.current = '';
    setMoveHistory([{ fen: newFen, san: null }]);
    setHistoryIndex(0);
    setFen(newFen);
    setInputFen(newFen);
  };

  const flipBoard = () => setOrientation(o => o === 'white' ? 'black' : 'white');

  const handleFenSubmit = (e) => {
    e.preventDefault();
    try {
      new Chess(inputFen);
      lastFetchedFen.current = '';
      setMoveHistory([{ fen: inputFen, san: null }]);
      setHistoryIndex(0);
      setFen(inputFen);
    } catch {
      alert("Invalid FEN");
    }
  };

  // Arrow for the currently-selected top-moves entry.
  const customArrows = useMemo(() => {
    if (selectedMoveIndex !== null && topMoves[selectedMoveIndex]) {
      const move = topMoves[selectedMoveIndex];
      return [[move.move.slice(0, 2), move.move.slice(2, 4), 'rgba(59, 130, 246, 0.7)']];
    }
    return [];
  }, [selectedMoveIndex, topMoves]);

  // Are we currently rendering the live "if you dropped here" preview?
  const showPreview = isDragging && !!dragHover && !!previewHeatmap;

  // The heatmap that drives backgrounds and (in preview mode) labels.
  const tintHeatmap = showPreview ? previewHeatmap : heatmapPieces;

  // Set of legal-destination squares for the currently-selected piece.
  // Used to swap piece-worth labels for destination-change labels there.
  const legalDestSet = useMemo(() => {
    if (!selectedSquare) return new Set();
    try {
      const game = new Chess(fen);
      const moves = game.moves({ square: selectedSquare, verbose: true });
      return new Set(moves.map(m => m.to));
    } catch { return new Set(); }
  }, [selectedSquare, fen]);

  // The engine's #1 destination if the top move starts on the selected
  // square. Used to draw a green ring as a "best move" hint.
  const topMoveDest = useMemo(() => {
    if (!selectedSquare || !topMoves || topMoves.length === 0) return null;
    const top = topMoves[0];
    if (!top?.move || top.move.slice(0, 2) !== selectedSquare) return null;
    return top.move.slice(2, 4);
  }, [selectedSquare, topMoves]);

  // Last-move analysis (shown at the top of the analysis panel). Whenever
  // the user lands on a position that was reached by a move (i.e. not the
  // starting position), explain that move.
  const [lastMoveAnalysis, setLastMoveAnalysis] = useState(null);

  // Consequence string for the played move. Comes from connectors.js
  // diffing `prevPosExplanation` against `posExplanation`. Suppressed
  // when either is missing (initial position, FEN load, etc.).
  // Defined here (after lastMoveAnalysis) to avoid a TDZ ReferenceError.
  const lastMoveConsequence = React.useMemo(() => {
    if (!prevPosExplanation || !posExplanation || !lastMoveAnalysis) return null;
    if (lastMoveAnalysis.loading) return null;
    return topConsequenceLine(prevPosExplanation, posExplanation, {
      movingSide: prevPosExplanation.side_to_move,
      motifs: lastMoveAnalysis.motifs || [],
      evalSwingCp: (posExplanation.eval_cp || 0) - (prevPosExplanation.eval_cp || 0),
    });
  }, [prevPosExplanation, posExplanation, lastMoveAnalysis]);

  useEffect(() => {
    if (historyIndex === 0) { setLastMoveAnalysis(null); return; }
    const prev = moveHistory[historyIndex - 1];
    const curr = moveHistory[historyIndex];
    if (!prev || !curr || !curr.san) return;
    let moveUCI;
    try {
      const game = new Chess(prev.fen);
      const m = game.moves({ verbose: true }).find(m => m.san === curr.san);
      if (!m) return;
      moveUCI = m.from + m.to + (m.promotion || '');
    } catch { return; }
    let cancelled = false;
    setLastMoveAnalysis({ loading: true, san: curr.san });
    explainMoveAt(prev.fen, moveUCI)
      .then(r => { if (!cancelled) setLastMoveAnalysis({ ...r, loading: false }); })
      .catch(() => { if (!cancelled) setLastMoveAnalysis(null); });
    return () => { cancelled = true; };
  }, [historyIndex, moveHistory]);

  // Hanging-piece detector. A piece is "hanging" if it's attacked AND its
  // cheapest attacker is less valuable than the piece itself (so the
  // exchange loses material). King is never marked.
  const hangingSet = useMemo(() => {
    const set = new Set();
    try {
      const game = new Chess(fen);
      const board = game.board();
      for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
          const p = board[r][f];
          if (!p || p.type === 'k') continue;
          const sq = String.fromCharCode(97 + f) + (8 - r);
          const opponent = p.color === 'w' ? 'b' : 'w';
          const attackers = game.attackers(sq, opponent);
          if (!attackers || attackers.length === 0) continue;
          const defenders = game.attackers(sq, p.color);
          if (!defenders || defenders.length === 0) { set.add(sq); continue; }
          const minA = Math.min(...attackers.map(s =>
            TYPICAL_PIECE_CP[game.get(s).type] || 100));
          if (minA < (TYPICAL_PIECE_CP[p.type] || 100)) set.add(sq);
        }
      }
    } catch { /* ignore */ }
    return set;
  }, [fen]);

  // Material imbalance, in pawns. Positive = white is up. Used as a small
  // badge in the toolbar so you immediately see who's up material.
  const materialDelta = useMemo(() => {
    try {
      const game = new Chess(fen);
      const board = game.board();
      let white = 0, black = 0;
      for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
          const p = board[r][f];
          if (!p || p.type === 'k') continue;
          const v = TYPICAL_PIECE_CP[p.type] || 0;
          if (p.color === 'w') white += v;
          else black += v;
        }
      }
      return Math.round((white - black) / 10) / 10; // 1 decimal pawn
    } catch { return 0; }
  }, [fen]);

  // Game phase from total non-pawn-non-king material.
  // Opening: ~32 (all minors+majors), Middlegame: 16-32, Endgame: <16.
  const phase = useMemo(() => {
    try {
      const game = new Chess(fen);
      const board = game.board();
      let mat = 0;
      for (let r = 0; r < 8; r++) {
        for (let f = 0; f < 8; f++) {
          const p = board[r][f];
          if (!p || p.type === 'p' || p.type === 'k') continue;
          mat += { n: 3, b: 3, r: 5, q: 9 }[p.type] || 0;
        }
      }
      const moveNum = game.moveNumber();
      if (mat >= 30 && moveNum <= 12) return 'opening';
      if (mat <= 14) return 'endgame';
      return 'middlegame';
    } catch { return 'middlegame'; }
  }, [fen]);

  // Square styles: NO heatmap tints (the labels carry the value information
  // — squares stay plain cream / brown). What remains:
  //   • hanging-piece red inset border (warns about loose pieces)
  //   • selected-square highlight (yellow)
  //   • drag-hover highlight (blue) when previewing a destination
  //   • Lichess-style legal-move indicators (filled dot for empty, hollow
  //     ring for capture)
  const customSquareStyles = useMemo(() => {
    const styles = {};

    // Hanging-piece warning: any piece whose cheapest attacker is less
    // valuable than the piece itself gets a red inner ring. Cheap and
    // possibly the single most-useful "what am I missing?" indicator.
    if (!showPreview) {
      for (const sq of hangingSet) {
        styles[sq] = {
          ...(styles[sq] || {}),
          boxShadow: 'inset 0 0 0 3px rgba(248, 113, 113, 0.7)',
        };
      }
    }

    if (selectedSquare) {
      styles[selectedSquare] = {
        ...(styles[selectedSquare] || {}),
        backgroundColor: 'rgba(250, 204, 21, 0.32)',
      };

      const game = new Chess(fen);
      const moves = game.moves({ square: selectedSquare, verbose: true });
      const seen = new Set();
      for (const m of moves) {
        if (seen.has(m.to)) continue;
        seen.add(m.to);
        const target = game.get(m.to);
        const isDragTarget = showPreview && m.to === dragHover;
        const indicator = target
          ? 'radial-gradient(circle, transparent 60%, rgba(0,0,0,0.4) 65%, rgba(0,0,0,0.4) 75%, transparent 75%)'
          : 'radial-gradient(circle, rgba(0,0,0,0.32) 0%, rgba(0,0,0,0.32) 22%, transparent 22%)';

        styles[m.to] = {
          ...(styles[m.to] || {}),
          backgroundColor: isDragTarget ? 'rgba(96, 165, 250, 0.42)' : undefined,
          backgroundImage: indicator,
          // Green inset ring on the engine's top recommended destination.
          boxShadow: m.to === topMoveDest
            ? 'inset 0 0 0 3px rgba(134, 239, 172, 0.85)'
            : styles[m.to]?.boxShadow,
        };
      }
    }

    return styles;
  }, [selectedSquare, fen, showPreview, dragHover, hangingSet, topMoveDest]);

  // Square-to-pixel mapping helper, accounting for board flip.
  function squarePxPosition(square) {
    const BOARD_PX = 600;
    const SQ = BOARD_PX / 8;
    const file = square.charCodeAt(0) - 'a'.charCodeAt(0);
    const rank = parseInt(square[1], 10) - 1;
    let col = file;
    let row = 7 - rank;
    if (orientation === 'black') {
      col = 7 - col;
      row = 7 - row;
    }
    return { left: col * SQ, top: row * SQ, size: SQ };
  }

  // Format a pawn-delta as a signed label. "+1.3" / "-0.5" / "0.0".
  function fmtDelta(pawns) {
    if (Math.abs(pawns) < 0.05) return '0.0';
    return `${pawns >= 0 ? '+' : ''}${pawns.toFixed(1)}`;
  }

  // Selected piece's type — used for piece-relative color scaling in the
  // destination labels (an 80cp drop on a rook is small; on a bishop it's
  // significant).
  const selectedPieceType = useMemo(() => {
    if (!selectedSquare || !heatmapPieces) return 'q';
    const p = heatmapPieces.pieces.find(p => p.square === selectedSquare);
    if (p) return p.type;
    try {
      const game = new Chess(fen);
      return game.get(selectedSquare)?.type ?? 'q';
    } catch { return 'q'; }
  }, [selectedSquare, heatmapPieces, fen]);

  // King safety score (0–9) rendered ON each king as a label.
  //
  // Algorithm:
  //   shield      = pawns directly in front of king on the 3 files
  //                 [kf-1, kf, kf+1], at ranks +1 / +2; rank-1 worth 2 pts,
  //                 rank-2 worth 1. Cap 6.
  //   openFiles   = files in {kf-1, kf, kf+1} with no friendly pawn. Each
  //                 file deducts 1.5 points.
  //   attackers   = enemy pieces that attack any square in the king's
  //                 3×3 zone. Weighted: p=1 n=2 b=2 r=3 q=4. Each
  //                 attacker-square pair deducts 0.5 points.
  //   castled     = +1.5 if king is on g/c file at the back rank.
  //   central     = -3 if king is on file 2-5 AND rank 2-5 (out in the
  //                 middle of the board).
  //
  //   raw         = shield - 1.5*openFiles - 0.5*attackerWeight
  //                 + castledBonus - centerPenalty
  //   raw range   = roughly [-12, +8]
  //   score       = round( clamp(raw, -12, 8) - (-12)) / 20 * 9 )
  //
  // Result is 0..9: 0 = wide-open king, 9 = locked-down safe.
  const kingSafetyLabels = useMemo(() => {
    if (!heatmapVisible) return [];
    try {
      const game = new Chess(fen);
      const board = game.board();
      function kingPos(color) {
        for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
          const p = board[r][f];
          if (p && p.type === 'k' && p.color === color) {
            return { r, f, sq: String.fromCharCode(97 + f) + (8 - r) };
          }
        }
        return null;
      }
      function safety(kingPos, color) {
        if (!kingPos) return 4;
        const { r: kr, f: kf } = kingPos;
        const enemy = color === 'w' ? 'b' : 'w';
        // chess.js board(): row 0 = rank 8, row 7 = rank 1. So "forward"
        // for white is row-decreasing (toward rank 8), for black row-increasing.
        const forwardDr = color === 'w' ? -1 : 1;

        // 1. Pawn shield (max 6).
        let shield = 0;
        for (const df of [-1, 0, 1]) {
          const f = kf + df;
          if (f < 0 || f > 7) continue;
          for (let i = 1; i <= 2; i++) {
            const r = kr + forwardDr * i;
            if (r < 0 || r > 7) continue;
            const p = board[r][f];
            if (p && p.type === 'p' && p.color === color) {
              shield += i === 1 ? 2 : 1;
              break;
            }
          }
        }
        if (shield > 6) shield = 6;

        // 2. Open files near king.
        let openFiles = 0;
        for (const df of [-1, 0, 1]) {
          const f = kf + df;
          if (f < 0 || f > 7) continue;
          let hasFriendlyPawn = false;
          for (let r = 0; r < 8; r++) {
            const p = board[r][f];
            if (p && p.type === 'p' && p.color === color) {
              hasFriendlyPawn = true; break;
            }
          }
          if (!hasFriendlyPawn) openFiles++;
        }

        // 3. Attacker weight on king zone.
        const W = { p: 1, n: 2, b: 2, r: 3, q: 4 };
        let attackerWeight = 0;
        for (let dr = -1; dr <= 1; dr++) for (let df = -1; df <= 1; df++) {
          const r = kr + dr, f = kf + df;
          if (r < 0 || r > 7 || f < 0 || f > 7) continue;
          const sq = String.fromCharCode(97 + f) + (8 - r);
          const a = game.attackers(sq, enemy);
          if (!a) continue;
          for (const aSq of a) {
            const ap = game.get(aSq);
            if (!ap) continue;
            attackerWeight += (W[ap.type] || 0);
          }
        }

        // 4. Castled-king bonus.
        const castled =
          (color === 'w' && kr === 7 && (kf === 6 || kf === 2)) ||
          (color === 'b' && kr === 0 && (kf === 6 || kf === 2));

        // 5. Central exposure penalty.
        const central = kf >= 2 && kf <= 5 && kr >= 2 && kr <= 5;

        const raw = shield
                  - 1.5 * openFiles
                  - 0.5 * attackerWeight
                  + (castled ? 1.5 : 0)
                  - (central ? 3 : 0);

        const clamped = Math.max(-12, Math.min(8, raw));
        return Math.round(((clamped + 12) / 20) * 9);
      }
      const wK = kingPos('w'), bK = kingPos('b');
      const labels = [];
      for (const [k, color] of [[wK, 'w'], [bK, 'b']]) {
        if (!k) continue;
        const score = safety(k, color);
        // 0..9 mapped to red→white→green via the existing piece-relative
        // color helper. Treat (score-4.5)*100 cp as the "pretend delta" and
        // scale by king (calibration tuned so 0 reads strong red, 9 strong green).
        const fakeCp = (score - 4.5) * 200;
        const color2 = colorForCp(fakeCp, 'b', 5);
        // Compute pixel position with flip support.
        const file = k.f;
        const rank = 7 - k.r;
        let col = file, row = 7 - rank;
        if (orientation === 'black') { col = 7 - col; row = 7 - row; }
        const SQ = 600 / 8;
        labels.push({
          square: k.sq,
          left: col * SQ,
          top: row * SQ,
          size: SQ,
          color: color2,
          label: String(score),
        });
      }
      return labels;
    } catch { return []; }
  }, [heatmapVisible, fen, orientation]);

  // Numeric value badges per piece. THE core visualization: each piece's
  // contextual worth in the current position, OR — when previewing a drag
  // hover — the change in worth versus the current position. Color is
  // piece-relative: same cp delta is more concerning on lower-value pieces.
  const valueLabels = useMemo(() => {
    if (!heatmapVisible) return [];

    if (showPreview) {
      // DELTA mode (calibration=3) — change in each piece's worth vs. the
      // current position, scaled by that piece's typical value.
      if (!previewHeatmap || !heatmapPieces) return [];
      const currentByKey = new Map(heatmapPieces.pieces.map(p => [p.square, p]));
      return previewHeatmap.pieces
        .filter(p => p.type !== 'k')
        .map(p => {
          const currentP = p.square === dragHover
            ? currentByKey.get(selectedSquare)
            : currentByKey.get(p.square);
          const currentCp = currentP?.delta_cp ?? 0;
          const cp = p.delta_cp - currentCp;
          return {
            square: p.square,
            ...squarePxPosition(p.square),
            color: colorForCp(cp, p.type, 3),
            label: fmtDelta(cp / 100),
          };
        });
    }

    // ABSOLUTE mode (calibration=2) — each piece's standalone worth, scaled
    // by its typical value (so a queen at full base ≈ 0.86 saturation, a
    // pawn at half base ≈ 0.39, etc.).
    if (!heatmapPieces) return [];
    return heatmapPieces.pieces
      .filter(p => p.type !== 'k' && !legalDestSet.has(p.square))
      .map(p => ({
        square: p.square,
        ...squarePxPosition(p.square),
        color: colorForCp(p.delta_cp, p.type, 2),
        label: fmtDelta(p.delta_pawns),
      }));
  }, [
    heatmapVisible, heatmapPieces, previewHeatmap,
    showPreview, dragHover, selectedSquare, orientation, legalDestSet,
  ]);

  // Labels on legal-move targets — the change in the moved piece's value if
  // it landed here. Color scaled by the moving piece's typical value so a
  // -80cp drop on a rook reads lighter than the same drop on a bishop.
  const destinationLabels = useMemo(() => {
    if (!heatmapVisible || !selectedSquare || showPreview) return [];
    const currentValueCp =
      heatmapPieces?.pieces.find(p => p.square === selectedSquare)?.delta_cp ?? 0;
    return Object.entries(destValues).map(([dest, info]) => {
      const change = info.value_cp - currentValueCp;
      return {
        square: dest,
        ...squarePxPosition(dest),
        color: colorForCp(change, selectedPieceType, 3),
        label: fmtDelta(change / 100),
      };
    });
  }, [
    heatmapVisible, selectedSquare, destValues,
    heatmapPieces, showPreview, orientation, selectedPieceType,
  ]);

  // Quality → color, symbol, label. Lichess-style annotation symbols
  // (!!, !, ?!, ?, ??) plus our own ★ for `best` and ✗ for `missed_mate`.
  const QUALITY_COLOR = {
    brilliant:   '#22d3ee',   // cyan-400
    great:       '#34d399',   // emerald-400
    best:        '#4ade80',   // green-400
    excellent:   '#86efac',   // green-300
    good:        '#a7f3d0',   // emerald-200
    neutral:     '#a1a1aa',   // zinc-400
    inaccuracy:  '#fbbf24',   // amber-400
    mistake:     '#fb923c',   // orange-400
    blunder:     '#ef4444',   // red-500
    missed_mate: '#dc2626',   // red-600
  };
  const QUALITY_SYMBOL = {
    brilliant:   '!!',
    great:       '!',
    best:        '★',
    excellent:   '✓',
    good:        '',
    neutral:     '',
    inaccuracy:  '?!',
    mistake:     '?',
    blunder:     '??',
    missed_mate: '✗',
  };
  const QUALITY_LABEL = {
    brilliant:   'Brilliant',
    great:       'Great',
    best:        'Best',
    excellent:   'Excellent',
    good:        'Good',
    neutral:     'Neutral',
    inaccuracy:  'Inaccuracy',
    mistake:     'Mistake',
    blunder:     'Blunder',
    missed_mate: 'Missed mate',
  };
  const getQualityColor = (q) => QUALITY_COLOR[q] || '#a1a1aa';
  const getQualitySymbol = (q) => QUALITY_SYMBOL[q] ?? '';
  const getQualityLabel = (q) => QUALITY_LABEL[q] || '';

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      minHeight: '100vh',
      backgroundColor: '#09090b',
      color: '#e4e4e7',
      padding: '24px',
      gap: '16px'
    }}>
      {/* Main 2-column grid: eval bar + board on the left, analysis on the right. */}
      <div style={{
        display: 'flex',
        gap: '14px',
        alignItems: 'flex-start',
        width: '100%',
        maxWidth: '1080px',
      }}>
        {/* LEFT: eval bar flush with the board.
         *
         * The captured-piece strips and position-quality bars panel were
         * removed in the UI rethink: the eval bar's numeric label
         * already tells the user "+0.7" — the strips and the six bipolar
         * bars cluttered the visual without earning their place. The
         * non-material decomposition of the eval lives in the right-rail
         * "About this position" panel now, behind a one-line summary that
         * the user can expand on demand.
         */}
        <div style={{ display: 'flex', alignItems: 'stretch', gap: '4px' }}>
          <div style={{ width: '36px', height: '600px' }}>
            <EvalBar evalCp={evalCp} mate={evalMate} result={gameResult} loading={topMovesLoading} />
          </div>
          <div style={{
            position: 'relative',
            width: '600px',
            height: '600px',
            overflow: 'hidden',
            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
            border: '1px solid #27272a',
          }}>
            <Chessboard
              position={fen}
              onPieceDrop={onDrop}
              onSquareClick={onSquareClick}
              onPieceDragBegin={onPieceDragBegin}
              onPieceDragEnd={onPieceDragEnd}
              onDragOverSquare={onDragOverSquare}
              boardOrientation={orientation}
              customArrows={customArrows}
              customSquareStyles={customSquareStyles}
              animationDuration={150}
              arePiecesDraggable={true}
              boardWidth={600}
            />

            {/* Numeric overlays (piece-worth + destination-change + king safety) */}
            {heatmapVisible && (valueLabels.length > 0 || destinationLabels.length > 0 || kingSafetyLabels.length > 0) && (
              <div style={{
                position: 'absolute',
                top: 0, left: 0, width: '100%', height: '100%',
                pointerEvents: 'none', zIndex: 2,
              }}>
                {valueLabels.map(v => (
                  <div key={`val-${v.square}`} style={{
                    position: 'absolute',
                    left: `${v.left}px`, top: `${v.top}px`,
                    width: `${v.size}px`, height: `${v.size}px`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '24px',
                    fontWeight: 800,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    color: v.color,
                    letterSpacing: '-0.04em',
                    WebkitTextStrokeWidth: '4px',
                    WebkitTextStrokeColor: 'rgba(0, 0, 0, 0.92)',
                    paintOrder: 'stroke fill',
                  }}>
                    {v.label}
                  </div>
                ))}
                {destinationLabels.map(v => (
                  <div key={`dest-${v.square}`} style={{
                    position: 'absolute',
                    left: `${v.left}px`, top: `${v.top}px`,
                    width: `${v.size}px`, height: `${v.size}px`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '24px',
                    fontWeight: 800,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    color: v.color,
                    letterSpacing: '-0.04em',
                    WebkitTextStrokeWidth: '4px',
                    WebkitTextStrokeColor: 'rgba(0, 0, 0, 0.92)',
                    paintOrder: 'stroke fill',
                  }}>
                    {v.label}
                  </div>
                ))}
                {kingSafetyLabels.map(v => (
                  <div key={`king-${v.square}`} style={{
                    position: 'absolute',
                    left: `${v.left}px`, top: `${v.top}px`,
                    width: `${v.size}px`, height: `${v.size}px`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '36px',
                    fontWeight: 900,
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    color: v.color,
                    letterSpacing: '-0.04em',
                    WebkitTextStrokeWidth: '5px',
                    WebkitTextStrokeColor: 'rgba(0, 0, 0, 0.94)',
                    paintOrder: 'stroke fill',
                  }}>
                    {v.label}
                  </div>
                ))}
              </div>
            )}

            {/* Computing-values pill */}
            {heatmapVisible && heatmapLoading && !heatmapPieces && (
              <div style={{
                position: 'absolute',
                top: '6px',
                left: '8px',
                fontSize: '10px',
                fontWeight: 600,
                color: 'rgba(255, 255, 255, 0.85)',
                backgroundColor: 'rgba(0, 0, 0, 0.55)',
                padding: '3px 8px',
                borderRadius: '999px',
                letterSpacing: '0.02em',
                textTransform: 'uppercase',
                pointerEvents: 'none',
                zIndex: 3,
              }}>
                Computing values…
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: analysis column */}
        <div className="analysis-panel thin-scroll" style={{
          width: '400px',
          height: '600px',
          display: 'flex',
          flexDirection: 'column',
          border: '1px solid #27272a',
          borderRadius: '6px',
          overflow: 'hidden',
        }}>
          {/* Toolbar buttons */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '8px 10px',
            borderBottom: '1px solid #27272a',
          }}>
            <button onClick={goBack} disabled={historyIndex === 0} title="Previous move (← / ↑)" className="icon-btn" style={{
              padding: '7px',
              borderRadius: '6px',
              backgroundColor: '#1f1f23',
              color: historyIndex === 0 ? '#3f3f46' : '#a1a1aa',
              border: '1px solid #27272a',
              cursor: historyIndex === 0 ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <ChevronLeft size={14} />
            </button>
            <button onClick={goForward} disabled={historyIndex >= moveHistory.length - 1} title="Next move (→ / ↓)" className="icon-btn" style={{
              padding: '7px',
              borderRadius: '6px',
              backgroundColor: '#1f1f23',
              color: historyIndex >= moveHistory.length - 1 ? '#3f3f46' : '#a1a1aa',
              border: '1px solid #27272a',
              cursor: historyIndex >= moveHistory.length - 1 ? 'default' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <ChevronRight size={14} />
            </button>
            <div style={{ flex: 1 }} />
            <button onClick={loadRandomPosition} title="Random plausible position" className="icon-btn" style={{
              padding: '7px',
              borderRadius: '6px',
              backgroundColor: '#1f1f23',
              color: '#a1a1aa',
              border: '1px solid #27272a',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Shuffle size={14} />
            </button>
            <button onClick={flipBoard} title="Flip board (F)" className="icon-btn" style={{
              padding: '7px',
              borderRadius: '6px',
              backgroundColor: '#1f1f23',
              color: '#a1a1aa',
              border: '1px solid #27272a',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <RefreshCw size={14} />
            </button>
            <button onClick={resetBoard} title="Reset to start position" className="icon-btn" style={{
              padding: '7px',
              borderRadius: '6px',
              backgroundColor: '#1f1f23',
              color: '#a1a1aa',
              border: '1px solid #27272a',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <RotateCcw size={14} />
            </button>
            <SettingsPanel onChange={() => {
              // After settings change, force a re-fetch by clearing
              // the cached "last fen" so analysis re-runs with new
              // depth / multi-PV.
              lastFetchedFen.current = '';
              setFen(prev => prev); // trigger re-render and re-effect
            }} />
          </div>

          {/* Compact status line — side to move + phase + material lead.
              No coloured pills, no Shift-hint chip (Shift still works;
              users discover it through the help/keyboard map, not a
              constant on-screen reminder). Single inline run, restrained
              colour. The dot indicates whose turn it is.
          */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 14px',
            borderBottom: '1px solid #27272a',
            fontSize: '11px',
            color: '#a1a1aa',
            lineHeight: 1.5,
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              backgroundColor: sideToMove === 'w' ? '#fafafa' : '#27272a',
              border: '1px solid ' + (sideToMove === 'w' ? '#fafafa' : '#52525b'),
              display: 'inline-block',
              flexShrink: 0,
            }} />
            <span style={{ color: '#d4d4d8', fontWeight: 500 }}>
              {sideToMove === 'w' ? 'White' : 'Black'} to move
            </span>
            <span style={{ color: '#3f3f46' }}>·</span>
            <span style={{ textTransform: 'capitalize' }}>{phase}</span>
            {Math.abs(materialDelta) >= 0.1 && (
              <>
                <span style={{ color: '#3f3f46' }}>·</span>
                <span style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  color: '#86efac',
                }}>
                  {materialDelta > 0 ? 'White' : 'Black'} +{Math.abs(materialDelta).toFixed(1)}
                </span>
              </>
            )}
          </div>

          {/* Opening name + mini move history with piece icons */}
          {(openingName || moveHistory.length > 1) && (
            <div style={{
              padding: '8px 12px',
              borderBottom: '1px solid #27272a',
            }}>
              {openingName && (
                <div style={{
                  fontSize: '11px',
                  color: '#d4d4d8',
                  fontWeight: 600,
                  marginBottom: moveHistory.length > 1 ? '6px' : 0,
                  letterSpacing: '-0.01em',
                }}>
                  {openingName}
                </div>
              )}
              {moveHistory.length > 1 && (
                <div className="thin-scroll" style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '2px',
                  fontSize: '12px',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  maxHeight: '64px',
                  overflowY: 'auto',
                  lineHeight: 1.6,
                }}>
                  {moveHistory.slice(1).map((m, i) => {
                    const isWhiteMove = i % 2 === 0;
                    const moveNum = Math.floor(i / 2) + 1;
                    const active = historyIndex === i + 1;
                    const { piece, rest } = sanWithPieces(m.san, isWhiteMove);
                    return (
                      <span
                        key={i}
                        className="history-token"
                        data-active={active ? 'true' : 'false'}
                        onClick={() => {
                          setHistoryIndex(i + 1);
                          lastFetchedFen.current = '';
                          setFen(m.fen);
                          setInputFen(m.fen);
                        }}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '2px',
                          color: active ? '#a5b4fc' : (isWhiteMove ? '#e4e4e7' : '#a1a1aa'),
                        }}
                      >
                        {isWhiteMove && <span style={{ color: '#52525b', marginRight: '3px' }}>{moveNum}.</span>}
                        {piece && (
                          <ChessPieceIcon
                            role={piece}
                            color={isWhiteMove ? 'white' : 'black'}
                            size={14}
                            style={{ marginRight: '1px' }}
                          />
                        )}
                        <span>{rest}</span>
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Last move card — flat now; the quality icon already
              earns its colour, no need for an indigo wash on the
              container too. */}
          {lastMoveAnalysis && (
            <div style={{
              padding: '12px 14px',
              borderBottom: '1px solid #27272a',
            }}>
              <div style={{
                fontSize: '9px',
                color: '#71717a',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                marginBottom: '6px',
                fontWeight: 600,
              }}>
                Last move
              </div>
              <div style={{
                display: 'flex',
                alignItems: 'baseline',
                gap: '6px',
                marginBottom: '4px',
                flexWrap: 'wrap',
              }}>
                <span style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: '16px',
                  fontWeight: 700,
                  color: '#fafafa',
                  letterSpacing: '-0.02em',
                }}>
                  {lastMoveAnalysis.san}
                  {!lastMoveAnalysis.loading && lastMoveAnalysis.quality && (
                    <span style={{
                      marginLeft: '8px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: '24px',
                      height: '24px',
                      borderRadius: '50%',
                      backgroundColor: getQualityColor(lastMoveAnalysis.quality),
                      color: '#09090b',
                      verticalAlign: 'middle',
                      boxShadow: `0 0 0 1px ${getQualityColor(lastMoveAnalysis.quality)}55`,
                    }}>
                      <QualityIcon quality={lastMoveAnalysis.quality} size={16} />
                    </span>
                  )}
                </span>
                {lastMoveAnalysis.loading ? (
                  <span style={{ fontSize: '10px', color: '#71717a', textTransform: 'uppercase' }}>
                    Analyzing…
                  </span>
                ) : lastMoveAnalysis.quality && (
                  <span style={{
                    fontSize: '9px',
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: getQualityColor(lastMoveAnalysis.quality),
                    backgroundColor: `${getQualityColor(lastMoveAnalysis.quality)}1F`,
                    border: `1px solid ${getQualityColor(lastMoveAnalysis.quality)}55`,
                    padding: '3px 8px',
                    borderRadius: '999px',
                  }}>
                    {getQualityLabel(lastMoveAnalysis.quality)}
                  </span>
                )}
                {!lastMoveAnalysis.loading && typeof lastMoveAnalysis.winRateLoss === 'number' && lastMoveAnalysis.winRateLoss >= 1 && (
                  <span style={{
                    fontSize: '10px',
                    color: '#fca5a5',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    fontWeight: 600,
                    padding: '2px 7px',
                    borderRadius: '999px',
                    backgroundColor: 'rgba(248,113,113,0.08)',
                    border: '1px solid rgba(248,113,113,0.20)',
                  }}>
                    −{lastMoveAnalysis.winRateLoss.toFixed(1)}%
                  </span>
                )}
              </div>
              {!lastMoveAnalysis.loading && lastMoveAnalysis.summary && (
                <div style={{ fontSize: '12px', color: '#d4d4d8', marginBottom: '3px' }}>
                  {lastMoveAnalysis.summary}
                </div>
              )}
              {!lastMoveAnalysis.loading && lastMoveAnalysis.details && (
                <div style={{ fontSize: '11px', color: '#a1a1aa', lineHeight: 1.4 }}>
                  {lastMoveAnalysis.details}
                </div>
              )}
              {/* Consequence line — what the move enabled / damaged /
                  prevented, derived by diffing the structured blob
                  before vs after across king safety, pawn structure,
                  activity, line control, hanging pieces, etc. */}
              {!lastMoveAnalysis.loading && lastMoveConsequence && (
                <div style={{
                  marginTop: '6px',
                  paddingTop: '6px',
                  borderTop: '1px solid #27272a',
                  fontSize: '11px',
                  color: '#d4d4d8',
                  lineHeight: 1.45,
                }}>
                  <span style={{
                    color: '#52525b',
                    fontSize: '9px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    fontWeight: 700,
                    marginRight: '6px',
                  }}>
                    Consequence
                  </span>
                  {lastMoveConsequence}
                </div>
              )}
              {!lastMoveAnalysis.loading && lastMoveAnalysis.bestMoveSan && !lastMoveAnalysis.isBestMove && (
                <div style={{
                  marginTop: '6px',
                  fontSize: '11px',
                  color: '#a1a1aa',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                }}>
                  Better was{' '}
                  <span style={{
                    color: '#86efac',
                    fontWeight: 700,
                    padding: '1px 5px',
                    borderRadius: '2px',
                    backgroundColor: 'rgba(134, 239, 172, 0.12)',
                  }}>
                    {lastMoveAnalysis.bestMoveSan}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* The character-circles row was removed in the UI rethink:
              the icons inside the moves list itself convey the same
              information, and a parallel row of bigger circles on top
              created visual duplication. The engine-consensus one-
              liner moves to the AboutPosition panel, where it sits
              alongside the position summary. */}

          {/* About this position — collapsed-by-default summary. The
              user can expand to see the full structured blob: per-head
              eval breakdown, themes, plan, narrative. */}
          <AboutPosition explanation={posExplanation} />

          {/* Top moves list (scrollable, full details) */}
          <div className="thin-scroll" style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
            {topMovesLoading ? (
              <div style={{ textAlign: 'center', padding: '20px', color: '#71717a', fontSize: '12px' }}>
                Analyzing…
              </div>
            ) : topMoves.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '20px', color: '#71717a', fontSize: '12px' }}>
                No moves
              </div>
            ) : (
              topMoves.map((move, idx) => (
                <div
                  key={`${move.rank}-${idx}`}
                  onClick={() => handleMoveClick(move, idx)}
                  className="top-move-row"
                  data-selected={selectedMoveIndex === idx ? 'true' : 'false'}
                  style={{
                    padding: '8px 10px',
                    marginBottom: '4px',
                    borderRadius: '6px',
                    backgroundColor: 'transparent',
                    border: '1px solid transparent',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{
                      width: '20px',
                      height: '20px',
                      borderRadius: '999px',
                      backgroundColor: idx === 0 ? 'rgba(74, 222, 128, 0.18)' : '#27272a',
                      color: idx === 0 ? '#4ade80' : '#71717a',
                      fontSize: '10px',
                      fontWeight: 800,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: idx === 0 ? '1px solid rgba(74,222,128,0.35)' : '1px solid #3f3f46',
                    }}>
                      {move.rank}
                    </span>
                    <span style={{
                      flex: 1,
                      fontSize: '14px',
                      fontWeight: 600,
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      color: idx === 0 ? '#4ade80' : '#e4e4e7'
                    }}>
                      {move.san}
                    </span>
                    <span style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      padding: '2px 7px',
                      borderRadius: '999px',
                      backgroundColor: move.eval_pawns > 0 ? 'rgba(74, 222, 128, 0.12)' : move.eval_pawns < 0 ? 'rgba(248, 113, 113, 0.12)' : 'rgba(161, 161, 170, 0.10)',
                      color: move.eval_pawns > 0 ? '#86efac' : move.eval_pawns < 0 ? '#fca5a5' : '#a1a1aa',
                      border: '1px solid ' + (move.eval_pawns > 0 ? 'rgba(74,222,128,0.30)' : move.eval_pawns < 0 ? 'rgba(248,113,113,0.30)' : 'rgba(161,161,170,0.20)'),
                      letterSpacing: '-0.02em',
                    }}>
                      {move.isMate ? `M${move.mateIn}` : `${move.eval_pawns > 0 ? '+' : ''}${move.eval_pawns}`}
                    </span>
                  </div>

                  {move.tagline && (
                    <div style={{
                      marginTop: '3px',
                      marginLeft: '26px',
                      fontSize: '11px',
                      color: '#a1a1aa',
                      lineHeight: 1.35,
                    }}>
                      {move.tagline}
                    </div>
                  )}

                  {selectedMoveIndex === idx && Array.isArray(move.pvLine) && move.pvLine.length > 1 && (
                    <div style={{
                      marginTop: '6px',
                      marginLeft: '26px',
                      paddingLeft: '8px',
                      borderLeft: '2px solid #3f3f46',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '2px',
                    }}>
                      {move.pvLine.slice(1).map((p, i) => (
                        <div key={i} style={{ fontSize: '10px', color: '#71717a', display: 'flex', gap: '6px' }}>
                          <span style={{
                            color: '#71717a',
                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                            fontWeight: 700,
                            minWidth: '32px',
                          }}>
                            {p.san}
                          </span>
                          <span>{p.tagline}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {selectedMoveIndex === idx && (
                    <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #27272a' }}>
                      {explanationLoading ? (
                        <div style={{ fontSize: '11px', color: '#71717a' }}>Loading…</div>
                      ) : explanation ? (
                        <>
                          <div style={{
                            fontSize: '10px',
                            fontWeight: 600,
                            color: getQualityColor(explanation.quality),
                            textTransform: 'uppercase',
                            marginBottom: '4px',
                            letterSpacing: '0.05em',
                          }}>
                            {getQualityLabel(explanation.quality)}
                          </div>
                          <div style={{ fontSize: '12px', color: '#d4d4d8', marginBottom: '4px' }}>
                            {explanation.summary}
                          </div>
                          <div style={{ fontSize: '11px', color: '#a1a1aa', lineHeight: 1.4 }}>
                            {explanation.details}
                          </div>
                          {explanation.bestMoveSan && !explanation.isBestMove && (
                            <div style={{
                              marginTop: '6px',
                              fontSize: '11px',
                              color: '#a1a1aa',
                              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                            }}>
                              Best was{' '}
                              <span style={{
                                color: '#86efac',
                                fontWeight: 600,
                                padding: '1px 5px',
                                borderRadius: '2px',
                                backgroundColor: 'rgba(134, 239, 172, 0.12)',
                              }}>
                                {explanation.bestMoveSan}
                              </span>
                            </div>
                          )}
                        </>
                      ) : null}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* FEN Input */}
      <div style={{
        width: '100%',
        maxWidth: '820px',
        backgroundColor: 'rgba(24, 24, 27, 0.5)',
        padding: '12px',
        borderRadius: '3px',
        border: '1px solid #27272a'
      }}>
        <form onSubmit={handleFenSubmit} style={{ display: 'flex', gap: '8px' }}>
          <input
            value={inputFen}
            onChange={(e) => setInputFen(e.target.value)}
            style={{
              flex: 1,
              backgroundColor: '#09090b',
              border: '1px solid #27272a',
              borderRadius: '2px',
              padding: '8px 12px',
              fontSize: '12px',
              color: '#d4d4d8',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              outline: 'none'
            }}
            placeholder="Paste FEN..."
          />
          <button type="submit" style={{
            backgroundColor: '#3f3f46',
            padding: '8px 16px',
            borderRadius: '2px',
            fontSize: '12px',
            fontWeight: 500,
            border: 'none',
            color: '#e4e4e7',
            cursor: 'pointer'
          }}>
            Load
          </button>
        </form>
      </div>
    </div>
  );
}
