import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

// Custom tooltip / popover.
//
// Wrap any element to give it a hover-triggered floating popover with
// arbitrary React content. Slight delay on enter (so hovering across
// the UI doesn't fire a parade of tooltips) and a smart placement
// flip so it never goes off-screen.
//
// Usage:
//
//   <Tooltip content={<>Some <b>rich</b> content</>}>
//     <span>Hover me</span>
//   </Tooltip>
//
// Props:
//   content   — React node shown inside the popover
//   children  — exactly one element; receives onMouseEnter/Leave/Move
//   placement — preferred side: 'top' | 'bottom' | 'left' | 'right'
//   delay     — ms before showing (default 200)
//   maxWidth  — px (default 280)

const SHOW_DELAY = 200;
const HIDE_DELAY = 80;
const PADDING = 8;

export default function Tooltip({
  content,
  children,
  placement = 'top',
  delay = SHOW_DELAY,
  maxWidth = 280,
}) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const [actualPlacement, setActualPlacement] = useState(placement);
  const triggerRef = useRef(null);
  const tooltipRef = useRef(null);
  const showTimer = useRef(null);
  const hideTimer = useRef(null);

  const compute = useCallback(() => {
    if (!triggerRef.current || !tooltipRef.current) return;
    const t = triggerRef.current.getBoundingClientRect();
    const tip = tooltipRef.current.getBoundingClientRect();
    let pl = placement;
    let top, left;

    // Try preferred placement first; flip if off-screen.
    const tryPlace = (p) => {
      switch (p) {
        case 'top':    return { top: t.top - tip.height - PADDING, left: t.left + t.width / 2 - tip.width / 2 };
        case 'bottom': return { top: t.bottom + PADDING, left: t.left + t.width / 2 - tip.width / 2 };
        case 'left':   return { top: t.top + t.height / 2 - tip.height / 2, left: t.left - tip.width - PADDING };
        case 'right':  return { top: t.top + t.height / 2 - tip.height / 2, left: t.right + PADDING };
        default: return { top: 0, left: 0 };
      }
    };
    let pos = tryPlace(pl);
    const fits = pos.top >= 8 && pos.left >= 8 &&
                 pos.top + tip.height <= window.innerHeight - 8 &&
                 pos.left + tip.width  <= window.innerWidth  - 8;
    if (!fits) {
      // Try opposite side.
      const flip = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }[pl];
      pos = tryPlace(flip);
      pl = flip;
    }
    // Clamp inside viewport.
    pos.top  = Math.max(8, Math.min(window.innerHeight - tip.height - 8, pos.top));
    pos.left = Math.max(8, Math.min(window.innerWidth  - tip.width  - 8, pos.left));
    setCoords(pos);
    setActualPlacement(pl);
  }, [placement]);

  useEffect(() => {
    if (!visible) return;
    // Recompute after the tooltip mounts and on scroll/resize.
    requestAnimationFrame(compute);
    const onMove = () => compute();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [visible, compute]);

  const onEnter = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (visible) return;
    showTimer.current = setTimeout(() => setVisible(true), delay);
  };
  const onLeave = () => {
    if (showTimer.current) clearTimeout(showTimer.current);
    hideTimer.current = setTimeout(() => setVisible(false), HIDE_DELAY);
  };

  // Clone the single child so we can attach handlers without forcing
  // the parent to manage refs / extra wrapper divs.
  const child = React.Children.only(children);
  const wrappedChild = React.cloneElement(child, {
    ref: triggerRef,
    onMouseEnter: (e) => { onEnter(); child.props.onMouseEnter?.(e); },
    onMouseLeave: (e) => { onLeave(); child.props.onMouseLeave?.(e); },
    onFocus:      (e) => { onEnter(); child.props.onFocus?.(e); },
    onBlur:       (e) => { onLeave(); child.props.onBlur?.(e); },
  });

  return (
    <>
      {wrappedChild}
      {visible && createPortal(
        <div
          ref={tooltipRef}
          role="tooltip"
          style={{
            position: 'fixed',
            top: coords.top,
            left: coords.left,
            zIndex: 1000,
            maxWidth,
            padding: '8px 10px',
            borderRadius: '6px',
            backgroundColor: '#0f0f12',
            border: '1px solid #3f3f46',
            color: '#e4e4e7',
            fontSize: '11px',
            lineHeight: 1.5,
            boxShadow: '0 8px 24px -4px rgba(0,0,0,0.8), 0 2px 6px -2px rgba(0,0,0,0.5)',
            pointerEvents: 'none',
            // No transitions — instant once delay elapses.
          }}
          data-placement={actualPlacement}
        >
          {content}
        </div>,
        document.body
      )}
    </>
  );
}
