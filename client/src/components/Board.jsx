import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';
import {
  RefreshCw, RotateCcw, Lightbulb, X, ChevronLeft, ChevronRight,
  Flame, Shuffle,
} from 'lucide-react';
import EvalBar from './EvalBar';
import {
  getTopMoves,
  getBestMove,
  explainMoveAt,
} from '../engine/analysis';
import { getPieceValues, getMobility } from '../engine/heatmap';

// cp → background tint. Positive = green (good for owner / mover),
// negative = red. Clamped to ±500cp so a hanging queen doesn't drown
// the rest of the board.
function cpToTint(cp, alpha = 0.5) {
  const v = Math.max(-500, Math.min(500, cp));
  if (v >= 0) {
    const intensity = v / 500;
    return `rgba(74, 222, 128, ${(alpha * intensity).toFixed(3)})`;
  }
  const intensity = -v / 500;
  return `rgba(248, 113, 113, ${(alpha * intensity).toFixed(3)})`;
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

  // Heatmap toggle + data. Mobility is always-on whenever a piece is
  // selected — it's most useful as part of "what does this piece do?".
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [heatmapPieces, setHeatmapPieces] = useState(null);
  const [heatmapMobility, setHeatmapMobility] = useState(null);
  const [heatmapLoading, setHeatmapLoading] = useState(false);

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

  // Fetch on FEN change — also resets selection + heatmap data so we don't
  // briefly show stale colors from the previous position.
  useEffect(() => {
    fetchTopMoves(fen);
    setShowHint(false);
    setHintMove(null);
    setExplanation(null);
    setSelectedMoveIndex(null);
    setSelectedSquare(null);
    setHeatmapPieces(null);
    setHeatmapMobility(null);
  }, [fen, fetchTopMoves]);

  // Piece-values heatmap fetcher (refires on toggle / fen change).
  useEffect(() => {
    if (!showHeatmap) return;
    let cancelled = false;
    setHeatmapLoading(true);
    getPieceValues(fen)
      .then(r => { if (!cancelled) setHeatmapPieces(r); })
      .catch(e => console.error('piece-values failed:', e))
      .finally(() => { if (!cancelled) setHeatmapLoading(false); });
    return () => { cancelled = true; };
  }, [showHeatmap, fen]);

  // Mobility heatmap is always-on whenever a piece is selected. Drives the
  // green/red tint on legal-move targets, layered underneath the dots.
  useEffect(() => {
    if (!selectedSquare) {
      setHeatmapMobility(null);
      return;
    }
    let cancelled = false;
    setHeatmapLoading(true);
    getMobility(fen, selectedSquare)
      .then(r => { if (!cancelled) setHeatmapMobility(r); })
      .catch(e => console.error('mobility failed:', e))
      .finally(() => { if (!cancelled) setHeatmapLoading(false); });
    return () => { cancelled = true; };
  }, [fen, selectedSquare]);

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
  // appear underneath it. Cleared when the drag ends (whether or not the
  // drop was legal — onDrop also clears on success).
  function onPieceDragBegin(_piece, sourceSquare) {
    setSelectedSquare(sourceSquare);
  }
  function onPieceDragEnd() {
    setSelectedSquare(null);
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

  // Square styles: piece-value heatmap (background tint), selected-square
  // highlight, legal-move dots/rings, mobility heatmap on legal-move targets.
  const customSquareStyles = useMemo(() => {
    const styles = {};

    // Piece-values heatmap — tint each piece's square by its delta_cp.
    if (showHeatmap && heatmapPieces) {
      for (const p of heatmapPieces.pieces) {
        if (p.delta_cp === 0) continue;
        styles[p.square] = {
          ...(styles[p.square] || {}),
          backgroundColor: cpToTint(p.delta_cp, 0.5),
        };
      }
    }

    if (selectedSquare) {
      // Highlight the selected square (yellow).
      styles[selectedSquare] = {
        ...(styles[selectedSquare] || {}),
        backgroundColor: 'rgba(250, 204, 21, 0.35)',
      };

      // Build legal-move indicators on every unique destination.
      const game = new Chess(fen);
      const moves = game.moves({ square: selectedSquare, verbose: true });
      const seen = new Set();
      for (const m of moves) {
        if (seen.has(m.to)) continue;
        seen.add(m.to);
        const target = game.get(m.to);

        // Mobility heatmap (always-on when a piece is selected): tint each
        // legal destination by the move's evaluation delta. Falls back to
        // whatever the piece-values pass put down while mobility loads.
        let bg = styles[m.to]?.backgroundColor;
        if (heatmapMobility?.source_square === selectedSquare) {
          const mv = heatmapMobility.moves.find(x => x.square === m.to);
          if (mv) bg = cpToTint(mv.delta_cp, 0.55);
        }

        // Lichess-style indicator: filled dot for empty squares, hollow ring
        // for captures (so the captured piece stays visible inside the ring).
        const indicator = target
          ? 'radial-gradient(circle, transparent 60%, rgba(0,0,0,0.4) 65%, rgba(0,0,0,0.4) 75%, transparent 75%)'
          : 'radial-gradient(circle, rgba(0,0,0,0.32) 0%, rgba(0,0,0,0.32) 22%, transparent 22%)';

        styles[m.to] = {
          ...(styles[m.to] || {}),
          backgroundColor: bg,
          backgroundImage: indicator,
        };
      }
    }

    return styles;
  }, [selectedSquare, fen, showHeatmap, heatmapPieces, heatmapMobility]);

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
        borderRadius: '12px',
        border: '1px solid #27272a'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div>
            <div style={{ fontSize: '10px', color: '#71717a', textTransform: 'uppercase' }}>Eval</div>
            <div style={{
              fontFamily: 'monospace',
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
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          {/* History navigation */}
          <button
            onClick={goBack}
            disabled={historyIndex === 0}
            style={{
              padding: '8px',
              borderRadius: '8px',
              backgroundColor: '#27272a',
              color: historyIndex === 0 ? '#52525b' : '#a1a1aa',
              border: 'none',
              cursor: historyIndex === 0 ? 'default' : 'pointer'
            }}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={goForward}
            disabled={historyIndex >= moveHistory.length - 1}
            style={{
              padding: '8px',
              borderRadius: '8px',
              backgroundColor: '#27272a',
              color: historyIndex >= moveHistory.length - 1 ? '#52525b' : '#a1a1aa',
              border: 'none',
              cursor: historyIndex >= moveHistory.length - 1 ? 'default' : 'pointer'
            }}
          >
            <ChevronRight size={16} />
          </button>

          <div style={{ width: '1px', backgroundColor: '#3f3f46', margin: '0 4px' }} />

          <button
            onClick={() => showHint ? setShowHint(false) : fetchHint()}
            disabled={hintLoading}
            style={{
              padding: '8px 12px',
              borderRadius: '8px',
              backgroundColor: showHint ? '#22c55e' : '#27272a',
              color: showHint ? '#09090b' : '#a1a1aa',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12px'
            }}
            title="Show the engine's recommended move"
          >
            {showHint ? <X size={14} /> : <Lightbulb size={14} />}
            {hintLoading ? '...' : (showHint ? 'Hide' : 'Hint')}
          </button>

          <button
            onClick={() => setShowHeatmap(v => !v)}
            title="Color each piece by how much it contributes to the position"
            style={{
              padding: '8px 12px',
              borderRadius: '8px',
              backgroundColor: showHeatmap ? '#f97316' : '#27272a',
              color: showHeatmap ? '#09090b' : '#a1a1aa',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12px'
            }}
          >
            <Flame size={14} />
            {showHeatmap && heatmapLoading ? '...' : 'Heatmap'}
          </button>

          <button
            onClick={loadRandomPosition}
            title="Load a random plausible position"
            style={{
              padding: '8px 12px',
              borderRadius: '8px',
              backgroundColor: '#27272a',
              color: '#a1a1aa',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12px'
            }}
          >
            <Shuffle size={14} />
            Random
          </button>
          <button onClick={flipBoard} style={{
            padding: '8px',
            borderRadius: '8px',
            backgroundColor: '#27272a',
            color: '#a1a1aa',
            border: 'none',
            cursor: 'pointer'
          }}>
            <RefreshCw size={16} />
          </button>
          <button onClick={resetBoard} style={{
            padding: '8px',
            borderRadius: '8px',
            backgroundColor: '#27272a',
            color: '#a1a1aa',
            border: 'none',
            cursor: 'pointer'
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

        {/* Board */}
        <div style={{
          width: '520px',
          height: '520px',
          borderRadius: '8px',
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
            boardOrientation={orientation}
            customArrows={customArrows}
            customSquareStyles={customSquareStyles}
            animationDuration={150}
            arePiecesDraggable={true}
            boardWidth={520}
          />
        </div>

        {/* Analysis Panel */}
        <div style={{
          width: '260px',
          backgroundColor: '#18181b',
          border: '1px solid #27272a',
          borderRadius: '8px',
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
            textTransform: 'uppercase'
          }}>
            Analysis
          </div>

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
                    borderRadius: '6px',
                    backgroundColor: selectedMoveIndex === idx ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                    cursor: 'pointer',
                    border: selectedMoveIndex === idx ? '1px solid rgba(59, 130, 246, 0.3)' : '1px solid transparent'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{
                      width: '22px',
                      height: '22px',
                      borderRadius: '4px',
                      backgroundColor: idx === 0 ? 'rgba(74, 222, 128, 0.2)' : '#27272a',
                      color: idx === 0 ? '#4ade80' : '#71717a',
                      fontSize: '11px',
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
                      fontFamily: 'monospace',
                      color: idx === 0 ? '#4ade80' : '#e4e4e7'
                    }}>
                      {move.san}
                    </span>
                    <span style={{
                      fontSize: '12px',
                      fontWeight: 600,
                      fontFamily: 'monospace',
                      padding: '3px 8px',
                      borderRadius: '4px',
                      backgroundColor: move.eval_pawns > 0 ? 'rgba(74, 222, 128, 0.15)' : move.eval_pawns < 0 ? 'rgba(248, 113, 113, 0.15)' : 'rgba(161, 161, 170, 0.15)',
                      color: move.eval_pawns > 0 ? '#4ade80' : move.eval_pawns < 0 ? '#f87171' : '#a1a1aa'
                    }}>
                      {move.isMate ? `M${move.mateIn}` : `${move.eval_pawns > 0 ? '+' : ''}${move.eval_pawns}`}
                    </span>
                  </div>

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
          borderRadius: '8px',
          border: '1px solid #27272a',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '4px',
          fontSize: '13px',
          fontFamily: 'monospace'
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
        borderRadius: '8px',
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
              borderRadius: '4px',
              padding: '8px 12px',
              fontSize: '12px',
              color: '#d4d4d8',
              fontFamily: 'monospace',
              outline: 'none'
            }}
            placeholder="Paste FEN..."
          />
          <button type="submit" style={{
            backgroundColor: '#3f3f46',
            padding: '8px 16px',
            borderRadius: '4px',
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
