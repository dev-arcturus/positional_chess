import React from 'react';

// Vertical eval column with a horizontal numeric readout above the bar.
// Mate is shown as "M3" / "-M5" using the engine-provided `mate` distance
// (no decoding from the encoded cp score — that's the caller's job).
export default function EvalBar({ evalCp, mate, loading }) {
  const isMate = mate !== null && mate !== undefined;

  // For the bar fill, mate clamps to ±10 pawns.
  const cpForBar = isMate ? (mate > 0 ? 1000 : -1000) : (evalCp || 0);
  const clampedEval = Math.max(-1000, Math.min(1000, cpForBar));
  const percentage = 50 + (clampedEval / 1000) * 50;

  let label;
  if (loading) {
    label = '--';
  } else if (isMate) {
    label = `${mate >= 0 ? '' : '-'}M${Math.abs(mate)}`;
  } else if (evalCp === null || evalCp === undefined) {
    label = '--';
  } else {
    const v = (evalCp / 100).toFixed(2);
    label = evalCp > 0 ? `+${v}` : v;
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
