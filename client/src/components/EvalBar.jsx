import React from 'react';

// Vertical eval column with the numeric label INSIDE the bar, on the
// losing side, in a contrasting color. Same height as the board
// (parent sets height); fills its parent flush.
//
// Mate is rendered as "M3" / "-M5" using the `mate` prop. Terminal
// games show "1-0" / "0-1" / "½-½" via the `result` prop.
//
// Visual:
//   - Subtle radial gradients on each band so the bar reads as a
//     three-dimensional column rather than a flat strip.
//   - Mid-rank tick (the "0" line) at exactly 50% height — chess
//     servers like Lichess show this and it really helps you read
//     small advantages at a glance.
//   - Faint rank ticks at every 10% so the bar carries some scale.
//   - Mate / terminal positions ALSO get a tinted overlay (red glow
//     for losing side getting mated; gold for the winning side) so
//     you don't have to read the text to feel the verdict.
export default function EvalBar({ evalCp, mate, result, loading }) {
  const isMate = mate !== null && mate !== undefined && mate !== 0;
  const isResult = !!result;

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

  // Place the label on the LOSER's side: white advantage → top inside
  // the dark band; black advantage → bottom inside the light band.
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
      backgroundColor: '#0a0a0b',
      border: '1px solid #27272a',
      borderRadius: '4px',
      position: 'relative',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      boxShadow: 'inset 0 1px 0 0 rgba(255,255,255,0.04), 0 1px 2px 0 rgba(0,0,0,0.4)',
    }}>
      {/* Black portion (top) — flat colour. */}
      <div style={{
        flex: `${100 - percentage} 0 0`,
        backgroundColor: '#27272a',
        transition: 'flex 0.35s cubic-bezier(.4,0,.2,1)',
      }} />
      {/* White portion (bottom) — flat colour. */}
      <div style={{
        flex: `${percentage} 0 0`,
        backgroundColor: '#e4e4e7',
        transition: 'flex 0.35s cubic-bezier(.4,0,.2,1)',
      }} />

      {/* (glow overlay removed — flat bar is cleaner.) */}

      {/* Mid-rank tick: the "0" line. Slightly emphasised. */}
      <div style={{
        position: 'absolute',
        top: '50%',
        left: '8%',
        right: '8%',
        height: '1px',
        backgroundColor: percentage >= 50 ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.18)',
        pointerEvents: 'none',
      }} />

      {/* (decile ticks removed — too busy on a flat bar.) */}

      {/* Numeric label inside the bar, on the loser's side. Now bigger
          and bolder to fit the 36px-wide bar. */}
      <div style={{
        position: 'absolute',
        [labelAtTop ? 'top' : 'bottom']: '8px',
        left: 0,
        right: 0,
        textAlign: 'center',
        fontSize: '12px',
        fontWeight: 900,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        letterSpacing: '-0.04em',
        color: labelOnDark ? '#fafafa' : '#09090b',
        textShadow: labelOnDark
          ? '0 1px 1px rgba(0,0,0,0.6)'
          : '0 1px 0 rgba(255,255,255,0.5)',
        pointerEvents: 'none',
        userSelect: 'none',
      }}>
        {label}
      </div>
    </div>
  );
}
