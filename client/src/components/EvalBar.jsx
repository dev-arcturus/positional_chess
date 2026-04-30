import React from 'react';

// Vertical eval column with the numeric label INSIDE the bar, on the
// losing side, in a contrasting color. Same height as the board (parent
// sets height); fills its parent flush.
//
// Mate: rendered as "M3" / "-M5" using the `mate` prop.
// Terminal: "1-0" / "0-1" / "½-½" via the `result` prop.
export default function EvalBar({ evalCp, mate, result, loading }) {
  const isMate = mate !== null && mate !== undefined && mate !== 0;
  const isResult = !!result;

  // For the bar fill: terminal positions slam to ±100% (or 50% for draws).
  let cpForBar;
  if (isResult) {
    cpForBar = result === '1-0' ? 1000 : result === '0-1' ? -1000 : 0;
  } else if (isMate) {
    cpForBar = mate > 0 ? 1000 : -1000;
  } else {
    cpForBar = evalCp || 0;
  }
  const clampedEval = Math.max(-1000, Math.min(1000, cpForBar));
  const percentage = 50 + (clampedEval / 1000) * 50;

  let label;
  if (loading) {
    label = '--';
  } else if (isResult) {
    label = result;
  } else if (isMate) {
    label = `${mate >= 0 ? '' : '-'}M${Math.abs(mate)}`;
  } else if (evalCp === null || evalCp === undefined) {
    label = '--';
  } else {
    const v = (evalCp / 100).toFixed(2);
    label = evalCp > 0 ? `+${v}` : v;
  }

  // Place the label on the LOSER's side of the bar:
  //   white advantage → label at top (inside the dark/black band)
  //   black advantage → label at bottom (inside the light/white band)
  // Drawn positions / equal evals → put it at the center.
  let labelAtTop;
  let labelOnDark;
  if (isResult) {
    if (result === '1-0')      { labelAtTop = true;  labelOnDark = true;  }
    else if (result === '0-1') { labelAtTop = false; labelOnDark = false; }
    else                       { labelAtTop = true;  labelOnDark = true;  }
  } else if (isMate) {
    labelAtTop = mate > 0;
    labelOnDark = mate > 0;
  } else if ((evalCp ?? 0) >= 0) {
    labelAtTop = true;  labelOnDark = true;
  } else {
    labelAtTop = false; labelOnDark = false;
  }

  return (
    <div style={{
      width: '100%',
      height: '100%',
      backgroundColor: '#18181b',
      border: '1px solid #27272a',
      borderRadius: '2px',
      position: 'relative',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Black portion (top) */}
      <div style={{
        flex: `${100 - percentage} 0 0`,
        backgroundColor: '#27272a',
        transition: 'flex 0.3s ease-out',
      }} />
      {/* White portion (bottom) */}
      <div style={{
        flex: `${percentage} 0 0`,
        backgroundColor: '#e4e4e7',
        transition: 'flex 0.3s ease-out',
      }} />

      {/* Numeric label inside the bar, on the loser's side. */}
      <div style={{
        position: 'absolute',
        [labelAtTop ? 'top' : 'bottom']: '6px',
        left: 0,
        right: 0,
        textAlign: 'center',
        fontSize: '10px',
        fontWeight: 800,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        letterSpacing: '-0.02em',
        color: labelOnDark ? '#fafafa' : '#09090b',
        pointerEvents: 'none',
        userSelect: 'none',
      }}>
        {label}
      </div>
    </div>
  );
}
