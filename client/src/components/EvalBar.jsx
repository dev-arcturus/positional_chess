import React from 'react';

// Vertical eval column with a horizontal numeric readout above the bar.
// White at the bottom, black at the top, smooth flex transitions on change.
export default function EvalBar({ evalCp, loading }) {
  const clampedEval = Math.max(-1000, Math.min(1000, evalCp || 0));
  const percentage = 50 + (clampedEval / 1000) * 50;

  const displayValue = loading ? '--' : ((evalCp || 0) / 100).toFixed(2);
  const isMate = Math.abs(evalCp || 0) > 9000;
  let label = displayValue;
  if (isMate) {
    const mateIn = Math.abs(10000 - Math.abs(evalCp));
    label = evalCp > 0 ? `M${mateIn}` : `-M${mateIn}`;
  } else if (evalCp > 0 && !loading) {
    label = `+${displayValue}`;
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      height: '100%',
      gap: '6px',
    }}>
      <div style={{
        fontSize: '13px',
        fontWeight: 700,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        color: '#fafafa',
        letterSpacing: '-0.02em',
        minHeight: '16px',
        textAlign: 'center',
      }}>
        {label}
      </div>
      <div style={{
        flex: 1,
        width: '24px',
        backgroundColor: '#18181b',
        border: '1px solid #27272a',
        borderRadius: '2px',
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}>
        <div style={{
          flex: `${100 - percentage} 0 0`,
          backgroundColor: '#27272a',
          transition: 'flex 0.3s ease-out',
        }} />
        <div style={{
          flex: `${percentage} 0 0`,
          backgroundColor: '#e4e4e7',
          transition: 'flex 0.3s ease-out',
        }} />
      </div>
    </div>
  );
}
