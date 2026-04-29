import React from 'react';

export default function EvalBar({ evalCp, loading }) {
  // Convert centipawns to a percentage (capped at ±10 pawns)
  const clampedEval = Math.max(-1000, Math.min(1000, evalCp || 0));
  const percentage = 50 + (clampedEval / 1000) * 50;

  // Display value
  const displayValue = loading ? '--' : (evalCp / 100).toFixed(1);
  const isWhiteAdvantage = evalCp > 0;
  const isMate = Math.abs(evalCp) > 9000;

  let mateDisplay = null;
  if (isMate) {
    const mateIn = Math.abs(10000 - Math.abs(evalCp));
    mateDisplay = evalCp > 0 ? `M${mateIn}` : `-M${mateIn}`;
  }

  return (
    <div style={{
      width: '32px',
      height: '100%',
      backgroundColor: '#18181b',
      borderRadius: '8px',
      border: '1px solid #27272a',
      position: 'relative',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* Black's portion (top) */}
      <div style={{
        flex: `${100 - percentage} 0 0`,
        backgroundColor: '#27272a',
        transition: 'flex 0.3s ease-out'
      }} />

      {/* White's portion (bottom) */}
      <div style={{
        flex: `${percentage} 0 0`,
        backgroundColor: '#e4e4e7',
        transition: 'flex 0.3s ease-out'
      }} />

      {/* Eval display */}
      <div style={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        fontSize: '11px',
        fontWeight: 700,
        fontFamily: 'monospace',
        color: isWhiteAdvantage ? '#09090b' : '#fafafa',
        textShadow: isWhiteAdvantage
          ? '0 0 4px rgba(255,255,255,0.8)'
          : '0 0 4px rgba(0,0,0,0.8)',
        writingMode: 'vertical-rl',
        textOrientation: 'mixed',
        whiteSpace: 'nowrap'
      }}>
        {isMate ? mateDisplay : displayValue}
      </div>
    </div>
  );
}
