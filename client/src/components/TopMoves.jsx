import React from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';

export default function TopMoves({
  moves,
  loading,
  collapsed,
  onToggle,
  onMoveClick,
  onMoveHover,
  selectedMove
}) {
  if (collapsed) {
    return (
      <button
        onClick={onToggle}
        style={{
          width: '36px',
          height: '100%',
          backgroundColor: '#18181b',
          border: '1px solid #27272a',
          borderRadius: '8px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#71717a'
        }}
      >
        <ChevronRight size={16} />
      </button>
    );
  }

  const getMoveColor = (evalPawns, rank) => {
    if (rank === 1) return '#4ade80'; // Best move - green
    if (evalPawns < -1) return '#f87171'; // Blunder - red
    if (evalPawns < -0.3) return '#fbbf24'; // Dubious - yellow
    return '#a1a1aa'; // Normal - gray
  };

  return (
    <div style={{
      width: '200px',
      height: '100%',
      backgroundColor: '#18181b',
      border: '1px solid #27272a',
      borderRadius: '8px',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden'
    }}>
      {/* Header */}
      <div style={{
        padding: '12px',
        borderBottom: '1px solid #27272a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <span style={{
          fontSize: '12px',
          fontWeight: 600,
          color: '#e4e4e7',
          textTransform: 'uppercase',
          letterSpacing: '0.05em'
        }}>
          Top Moves
        </span>
        <button
          onClick={onToggle}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: '#71717a',
            padding: '4px'
          }}
        >
          <ChevronDown size={14} />
        </button>
      </div>

      {/* Moves list */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '8px'
      }}>
        {loading ? (
          <div style={{
            textAlign: 'center',
            padding: '20px',
            color: '#71717a',
            fontSize: '12px'
          }}>
            Analyzing...
          </div>
        ) : moves.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '20px',
            color: '#71717a',
            fontSize: '12px'
          }}>
            No moves available
          </div>
        ) : (
          moves.map((move, idx) => (
            <div
              key={`${move.rank}-${idx}`}
              onClick={() => onMoveClick?.(move)}
              onMouseEnter={() => onMoveHover?.(move)}
              onMouseLeave={() => onMoveHover?.(null)}
              style={{
                padding: '8px 10px',
                marginBottom: '4px',
                borderRadius: '6px',
                backgroundColor: selectedMove?.move === move.move
                  ? 'rgba(59, 130, 246, 0.2)'
                  : 'transparent',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                transition: 'background-color 0.15s'
              }}
            >
              {/* Rank badge */}
              <span style={{
                width: '20px',
                height: '20px',
                borderRadius: '4px',
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

              {/* Move notation */}
              <span style={{
                flex: 1,
                fontSize: '14px',
                fontWeight: 600,
                fontFamily: 'monospace',
                color: getMoveColor(move.eval_pawns, move.rank)
              }}>
                {move.san}
              </span>

              {/* Eval badge */}
              <span style={{
                fontSize: '11px',
                fontWeight: 600,
                fontFamily: 'monospace',
                padding: '2px 6px',
                borderRadius: '4px',
                backgroundColor: move.eval_pawns > 0
                  ? 'rgba(74, 222, 128, 0.15)'
                  : move.eval_pawns < 0
                    ? 'rgba(248, 113, 113, 0.15)'
                    : 'rgba(161, 161, 170, 0.15)',
                color: move.eval_pawns > 0
                  ? '#4ade80'
                  : move.eval_pawns < 0
                    ? '#f87171'
                    : '#a1a1aa'
              }}>
                {move.isMate
                  ? `M${move.mateIn}`
                  : `${move.eval_pawns > 0 ? '+' : ''}${move.eval_pawns}`
                }
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
