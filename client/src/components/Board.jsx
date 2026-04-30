import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';
import {
  RefreshCw, RotateCcw, Lightbulb, X, ChevronLeft, ChevronRight,
  Shuffle,
} from 'lucide-react';
import EvalBar from './EvalBar';
import {
  getTopMoves,
  getBestMove,
  explainMoveAt,
} from '../engine/analysis';
import { getPieceValues, streamDestinationValues } from '../engine/heatmap';

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

// Curated "plausible" positions — openings just out of theory, sharp
// middlegames, and clean endgames. All are legal positions that
// realistically occur in real games. Used by the Random button.
const RANDOM_POSITIONS = [
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

function pickRandomPosition() {
  return RANDOM_POSITIONS[Math.floor(Math.random() * RANDOM_POSITIONS.length)];
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
  const [loading, setLoading] = useState(false);
  const [topMoves, setTopMoves] = useState([]);
  const [topMovesLoading, setTopMovesLoading] = useState(false);

  // Selected move for analysis
  const [selectedMoveIndex, setSelectedMoveIndex] = useState(null);
  const [explanation, setExplanation] = useState(null);
  const [explanationLoading, setExplanationLoading] = useState(false);

  // Hint state
  const [showHint, setShowHint] = useState(false);
  const [hintMove, setHintMove] = useState(null);
  const [hintLoading, setHintLoading] = useState(false);

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

  // Fetch hint
  const fetchHint = useCallback(async () => {
    setHintLoading(true);
    try {
      const result = await getBestMove(fen);
      setHintMove(result);
      setShowHint(true);
    } catch (error) {
      console.error("Hint failed", error);
    } finally {
      setHintLoading(false);
    }
  }, [fen]);

  // Fetch on FEN change — also resets selection + heatmap / preview data
  // so we don't briefly show stale colors from the previous position.
  useEffect(() => {
    fetchTopMoves(fen);
    setShowHint(false);
    setHintMove(null);
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

  // Arrow for hint or selected move
  const customArrows = useMemo(() => {
    if (showHint && hintMove) {
      return [[hintMove.from, hintMove.to, 'rgba(74, 222, 128, 0.8)']];
    }
    if (selectedMoveIndex !== null && topMoves[selectedMoveIndex]) {
      const move = topMoves[selectedMoveIndex];
      return [[move.move.slice(0, 2), move.move.slice(2, 4), 'rgba(59, 130, 246, 0.7)']];
    }
    return [];
  }, [showHint, hintMove, selectedMoveIndex, topMoves]);

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
    const BOARD_PX = 520;
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

  // King safety score (0–9) rendered ON each king as a label. 0 = exposed,
  // 9 = locked-down safe. Same heuristic as the (now removed) toolbar
  // badges, but mapped to a 0–9 scale and shown right on the king square.
  const kingSafetyLabels = useMemo(() => {
    if (!heatmapVisible) return [];
    try {
      const game = new Chess(fen);
      const board = game.board();
      function kingPos(color) {
        for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
          const p = board[r][f];
          if (p && p.type === 'k' && p.color === color) return { r, f, sq: String.fromCharCode(97 + f) + (8 - r) };
        }
        return null;
      }
      function safety(kingPos, color) {
        if (!kingPos) return 4;
        const enemy = color === 'w' ? 'b' : 'w';
        let pawns = 0, attackers = 0;
        for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
          const p = board[r][f];
          if (!p) continue;
          const dist = Math.max(Math.abs(r - kingPos.r), Math.abs(f - kingPos.f));
          if (p.type === 'p' && p.color === color && dist <= 2) pawns++;
          if (p.color === enemy && p.type !== 'p' && p.type !== 'k' && dist <= 3) attackers++;
        }
        const center = (kingPos.f >= 2 && kingPos.f <= 5 && kingPos.r >= 2 && kingPos.r <= 5);
        // Raw range typically -4 .. +6. Shift to 0..9.
        const raw = pawns - attackers - (center ? 2 : 0);
        return Math.max(0, Math.min(9, raw + 4));
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
        const SQ = 520 / 8;
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

  // Quality to color
  const getQualityColor = (quality) => {
    switch (quality) {
      case 'brilliant': return '#22d3ee';
      case 'great':     return '#34d399';
      case 'best':      return '#4ade80';
      case 'good':      return '#86efac';
      case 'neutral':   return '#a1a1aa';
      case 'inaccuracy':return '#fbbf24';
      case 'mistake':   return '#fb923c';
      case 'blunder':   return '#ef4444';
      default:          return '#a1a1aa';
    }
  };

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
      {/* Header */}
      <div style={{
        width: '100%',
        maxWidth: '820px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: 'rgba(24, 24, 27, 0.8)',
        padding: '12px 20px',
        borderRadius: '3px',
        border: '1px solid #27272a'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div>
            <div style={{ fontSize: '10px', color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Eval</div>
            <div style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: '20px',
              fontWeight: 'bold',
              color: loading || topMovesLoading ? '#71717a' : (evalCp > 50 ? '#4ade80' : evalCp < -50 ? '#f87171' : '#e4e4e7')
            }}>
              {topMovesLoading ? '--' : (evalCp !== null ? (evalCp / 100).toFixed(2) : '--')}
            </div>
          </div>
          <div style={{ fontSize: '12px', color: '#71717a' }}>
            {sideToMove === 'w' ? 'White' : 'Black'} to move
          </div>

          {/* Material balance badge — quick read on who's up material. */}
          {Math.abs(materialDelta) >= 0.1 && (
            <div style={{
              fontSize: '11px',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontWeight: 700,
              padding: '3px 7px',
              borderRadius: '2px',
              backgroundColor: materialDelta > 0 ? 'rgba(74, 222, 128, 0.12)' : 'rgba(248, 113, 113, 0.12)',
              color: materialDelta > 0 ? '#86efac' : '#fca5a5',
              letterSpacing: '-0.02em',
            }}
              title={materialDelta > 0 ? 'White is up material' : 'Black is up material'}
            >
              {materialDelta > 0 ? '+' : ''}{materialDelta.toFixed(1)}
            </div>
          )}

          {/* Game phase indicator. */}
          <div style={{
            fontSize: '10px',
            color: '#71717a',
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            fontWeight: 600,
          }}>
            {phase}
          </div>

          {/* Shift-key hint: piece-value heatmap is gated behind holding
              Shift, so the board stays clean by default. Show a small
              indicator that lights up when Shift is actually held. */}
          <div style={{
            fontSize: '10px',
            color: showHeatmap ? '#f97316' : '#52525b',
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            border: `1px solid ${showHeatmap ? '#f97316' : '#3f3f46'}`,
            padding: '3px 6px',
            borderRadius: '2px',
            fontWeight: 600,
            transition: 'color 0.1s, border-color 0.1s',
          }}>
            ⇧ Shift {showHeatmap ? '· Heatmap on' : 'for piece values'}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          {/* History navigation */}
          <button
            onClick={goBack}
            disabled={historyIndex === 0}
            title="Previous position"
            style={{
              padding: '9px',
              borderRadius: '3px',
              backgroundColor: '#27272a',
              color: historyIndex === 0 ? '#52525b' : '#a1a1aa',
              border: 'none',
              cursor: historyIndex === 0 ? 'default' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={goForward}
            disabled={historyIndex >= moveHistory.length - 1}
            title="Next position"
            style={{
              padding: '9px',
              borderRadius: '3px',
              backgroundColor: '#27272a',
              color: historyIndex >= moveHistory.length - 1 ? '#52525b' : '#a1a1aa',
              border: 'none',
              cursor: historyIndex >= moveHistory.length - 1 ? 'default' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ChevronRight size={16} />
          </button>

          <div style={{ width: '1px', backgroundColor: '#3f3f46', margin: '0 4px' }} />

          <button
            onClick={() => showHint ? setShowHint(false) : fetchHint()}
            disabled={hintLoading}
            style={{
              padding: '9px',
              borderRadius: '3px',
              backgroundColor: showHint ? '#22c55e' : '#27272a',
              color: showHint ? '#09090b' : '#a1a1aa',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title={showHint ? 'Hide hint' : "Show the engine's best move"}
          >
            {showHint ? <X size={16} /> : <Lightbulb size={16} />}
          </button>

          <button
            onClick={loadRandomPosition}
            title="Load a random plausible position"
            style={{
              padding: '9px',
              borderRadius: '3px',
              backgroundColor: '#27272a',
              color: '#a1a1aa',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Shuffle size={16} />
          </button>
          <button onClick={flipBoard} title="Flip board" style={{
            padding: '9px',
            borderRadius: '3px',
            backgroundColor: '#27272a',
            color: '#a1a1aa',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <RefreshCw size={16} />
          </button>
          <button onClick={resetBoard} title="Reset to start position" style={{
            padding: '9px',
            borderRadius: '3px',
            backgroundColor: '#27272a',
            color: '#a1a1aa',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <RotateCcw size={16} />
          </button>
        </div>
      </div>

      {/* Main content */}
      <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
        {/* Eval Bar */}
        <div style={{ height: '520px' }}>
          <EvalBar evalCp={evalCp} loading={topMovesLoading} />
        </div>

        {/* Board (with pawn-value overlay) */}
        <div style={{
          position: 'relative',
          width: '520px',
          height: '520px',
          borderRadius: '2px',
          overflow: 'hidden',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          border: '1px solid #27272a'
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
            boardWidth={520}
          />

          {/* All numeric labels live in one transparent overlay above the
              board. Two flavors:
                • valueLabels       — one per piece. ABSOLUTE worth in the
                  current position, OR the change in worth while a drag is
                  hovering a legal destination (preview mode).
                • destinationLabels — one per legal destination. Shows how
                  the moved piece's worth would change if it landed there.

              Both flavors share the same big-centered design: ~22px bold
              monospace, color interpolated from white toward saturated
              green/red as the magnitude grows, no shadow. */}
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
                  fontSize: '22px',
                  fontWeight: 800,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  color: v.color,
                  letterSpacing: '-0.04em',
                  // Heavy black stroke + bright fill = subtitle-style
                  // legibility on any square color or piece icon.
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
                  fontSize: '22px',
                  fontWeight: 800,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  color: v.color,
                  letterSpacing: '-0.04em',
                  // Heavy black stroke + bright fill = subtitle-style
                  // legibility on any square color or piece icon.
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
                  fontSize: '32px',
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

          {/* Subtle "computing values" indicator while the engine works on
              the heatmap. Sits in the top-left of the board, doesn't block
              anything. */}
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

        {/* Analysis Panel */}
        <div style={{
          width: '280px',
          backgroundColor: '#18181b',
          border: '1px solid #27272a',
          borderRadius: '3px',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '520px',
          overflow: 'hidden'
        }}>
          {/* Header */}
          <div style={{
            padding: '12px 16px',
            borderBottom: '1px solid #27272a',
            fontSize: '12px',
            fontWeight: 600,
            color: '#e4e4e7',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}>
            Analysis
          </div>

          {/* Last move card — shows the move that got us to the current
              position with its quality classification + tagline. */}
          {lastMoveAnalysis && (
            <div style={{
              padding: '12px 16px',
              borderBottom: '1px solid #27272a',
              backgroundColor: 'rgba(15, 23, 42, 0.4)',
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
                alignItems: 'center',
                gap: '8px',
                marginBottom: '4px',
              }}>
                <span style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: '15px',
                  fontWeight: 700,
                  color: '#fafafa',
                  letterSpacing: '-0.02em',
                }}>
                  {lastMoveAnalysis.san}
                </span>
                {lastMoveAnalysis.loading ? (
                  <span style={{ fontSize: '10px', color: '#71717a', textTransform: 'uppercase' }}>
                    Analyzing…
                  </span>
                ) : lastMoveAnalysis.quality && (
                  <span style={{
                    fontSize: '9px',
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: getQualityColor(lastMoveAnalysis.quality),
                    border: `1px solid ${getQualityColor(lastMoveAnalysis.quality)}`,
                    padding: '2px 6px',
                    borderRadius: '2px',
                  }}>
                    {lastMoveAnalysis.quality}
                  </span>
                )}
                {!lastMoveAnalysis.loading && typeof lastMoveAnalysis.winRateLoss === 'number' && lastMoveAnalysis.winRateLoss >= 1 && (
                  <span style={{ fontSize: '10px', color: '#a1a1aa' }}>
                    −{lastMoveAnalysis.winRateLoss.toFixed(1)}% win-rate
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

          {/* Top Moves List */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
            {topMovesLoading ? (
              <div style={{ textAlign: 'center', padding: '20px', color: '#71717a', fontSize: '12px' }}>
                Analyzing...
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
                  style={{
                    padding: '10px 12px',
                    marginBottom: '4px',
                    borderRadius: '2px',
                    backgroundColor: selectedMoveIndex === idx ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                    cursor: 'pointer',
                    border: selectedMoveIndex === idx ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid transparent'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{
                      width: '20px',
                      height: '20px',
                      borderRadius: '2px',
                      backgroundColor: idx === 0 ? 'rgba(74, 222, 128, 0.2)' : '#27272a',
                      color: idx === 0 ? '#4ade80' : '#71717a',
                      fontSize: '10px',
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      {move.rank}
                    </span>
                    <span style={{
                      flex: 1,
                      fontSize: '15px',
                      fontWeight: 600,
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      color: idx === 0 ? '#4ade80' : '#e4e4e7'
                    }}>
                      {move.san}
                    </span>
                    <span style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      padding: '3px 7px',
                      borderRadius: '2px',
                      backgroundColor: move.eval_pawns > 0 ? 'rgba(74, 222, 128, 0.15)' : move.eval_pawns < 0 ? 'rgba(248, 113, 113, 0.15)' : 'rgba(161, 161, 170, 0.15)',
                      color: move.eval_pawns > 0 ? '#4ade80' : move.eval_pawns < 0 ? '#f87171' : '#a1a1aa'
                    }}>
                      {move.isMate ? `M${move.mateIn}` : `${move.eval_pawns > 0 ? '+' : ''}${move.eval_pawns}`}
                    </span>
                  </div>

                  {/* Move tagline (engine-free, generated by quickExplain).
                      A one-liner like "Develops the knight, threatens the
                      bishop" so you can scan the move list and read what
                      each move accomplishes positionally. */}
                  {move.tagline && (
                    <div style={{
                      marginTop: '4px',
                      marginLeft: '30px',
                      fontSize: '11px',
                      color: '#a1a1aa',
                      lineHeight: 1.35,
                    }}>
                      {move.tagline}
                    </div>
                  )}

                  {/* PV taglines: the next couple of plies of the engine's
                      preferred line, each annotated. Only show when this
                      move is selected to avoid panel clutter. */}
                  {selectedMoveIndex === idx && Array.isArray(move.pvLine) && move.pvLine.length > 1 && (
                    <div style={{
                      marginTop: '6px',
                      marginLeft: '30px',
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

                  {/* Inline explanation when selected */}
                  {selectedMoveIndex === idx && (
                    <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #27272a' }}>
                      {explanationLoading ? (
                        <div style={{ fontSize: '12px', color: '#71717a' }}>Loading...</div>
                      ) : explanation ? (
                        <>
                          <div style={{
                            fontSize: '11px',
                            fontWeight: 600,
                            color: getQualityColor(explanation.quality),
                            textTransform: 'uppercase',
                            marginBottom: '6px'
                          }}>
                            {explanation.quality}
                          </div>
                          <div style={{ fontSize: '13px', color: '#d4d4d8', marginBottom: '6px' }}>
                            {explanation.summary}
                          </div>
                          <div style={{ fontSize: '12px', color: '#a1a1aa' }}>
                            {explanation.details}
                          </div>
                          {explanation.bestMoveSan && !explanation.isBestMove && (
                            <div style={{
                              marginTop: '8px',
                              fontSize: '11px',
                              color: '#a1a1aa',
                              fontFamily: 'monospace'
                            }}>
                              Best was{' '}
                              <span style={{
                                color: '#4ade80',
                                fontWeight: 600,
                                padding: '2px 6px',
                                borderRadius: '3px',
                                backgroundColor: 'rgba(74, 222, 128, 0.12)',
                              }}>
                                {explanation.bestMoveSan}
                              </span>
                              {typeof explanation.winRateLoss === 'number' && explanation.winRateLoss >= 1 && (
                                <span style={{ color: '#71717a', marginLeft: '6px' }}>
                                  ({explanation.winRateLoss.toFixed(1)}% win-rate lost)
                                </span>
                              )}
                            </div>
                          )}
                          {explanation.factors?.length > 0 && (
                            <div style={{ marginTop: '8px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                              {explanation.factors.map((f, i) => (
                                <span key={i} style={{
                                  fontSize: '9px',
                                  fontWeight: 600,
                                  textTransform: 'uppercase',
                                  padding: '3px 6px',
                                  borderRadius: '3px',
                                  backgroundColor: 'rgba(59, 130, 246, 0.15)',
                                  color: '#60a5fa'
                                }}>
                                  {f.type.replace('_', ' ')}
                                </span>
                              ))}
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

      {/* Move history display */}
      {moveHistory.length > 1 && (
        <div style={{
          width: '100%',
          maxWidth: '820px',
          backgroundColor: 'rgba(24, 24, 27, 0.5)',
          padding: '10px 16px',
          borderRadius: '3px',
          border: '1px solid #27272a',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '4px',
          fontSize: '13px',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace'
        }}>
          {moveHistory.slice(1).map((m, i) => (
            <span
              key={i}
              onClick={() => {
                setHistoryIndex(i + 1);
                lastFetchedFen.current = '';
                setFen(m.fen);
                setInputFen(m.fen);
              }}
              style={{
                padding: '4px 8px',
                borderRadius: '4px',
                backgroundColor: historyIndex === i + 1 ? 'rgba(59, 130, 246, 0.2)' : 'transparent',
                color: historyIndex === i + 1 ? '#60a5fa' : '#a1a1aa',
                cursor: 'pointer'
              }}
            >
              {i % 2 === 0 && <span style={{ color: '#52525b', marginRight: '4px' }}>{Math.floor(i / 2) + 1}.</span>}
              {m.san}
            </span>
          ))}
        </div>
      )}

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
