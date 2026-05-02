import React, { useState, useEffect, useRef } from 'react';
import { Settings as SettingsIcon } from 'lucide-react';
import { getEngineDefaults, setEngineDefaults } from '../engine/engine';

// Settings dropdown — engine depth + multi-PV count, plus any UI flags
// the user might want to flip. Persists to localStorage via the engine
// helpers; closes on outside-click or Escape.
//
// Trigger: a small gear button. The dropdown is rendered in-flow rather
// than via portal so it tracks the toolbar layout.

export default function SettingsPanel({ onChange }) {
  const [open, setOpen] = useState(false);
  const [depth, setDepth] = useState(getEngineDefaults().depth);
  const [multipv, setMultipv] = useState(getEngineDefaults().multipv);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const apply = () => {
    setEngineDefaults({ depth, multipv });
    setOpen(false);
    onChange?.({ depth, multipv });
  };

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        title="Engine settings (depth, multi-PV)"
        className="icon-btn"
        style={{
          padding: '7px',
          borderRadius: '6px',
          backgroundColor: open ? '#3f3f46' : '#1f1f23',
          color: open ? '#fafafa' : '#a1a1aa',
          border: '1px solid ' + (open ? '#52525b' : '#27272a'),
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <SettingsIcon size={14} />
      </button>
      {open && (
        <div style={{
          position: 'absolute',
          right: 0,
          top: 'calc(100% + 6px)',
          width: '260px',
          padding: '12px',
          backgroundColor: '#0e0e10',
          border: '1px solid #3f3f46',
          borderRadius: '8px',
          boxShadow: '0 12px 32px -4px rgba(0,0,0,0.7)',
          zIndex: 100,
          fontSize: '11px',
        }}>
          <div style={{
            fontSize: '9px',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            fontWeight: 700,
            color: '#71717a',
            marginBottom: '8px',
          }}>
            Engine settings
          </div>

          {/* Depth */}
          <div style={{ marginBottom: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
              <label htmlFor="setting-depth" style={{ color: '#d4d4d8', fontWeight: 600 }}>
                Search depth
              </label>
              <span style={{
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                color: '#86efac',
                fontWeight: 700,
              }}>
                {depth}
              </span>
            </div>
            <input
              id="setting-depth"
              type="range"
              min={6}
              max={22}
              step={1}
              value={depth}
              onChange={e => setDepth(parseInt(e.target.value, 10))}
              style={{ width: '100%', accentColor: '#86efac' }}
            />
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '9px',
              color: '#52525b',
              marginTop: '2px',
            }}>
              <span>fast (6)</span>
              <span>deep (22)</span>
            </div>
            <div style={{ fontSize: '10px', color: '#71717a', marginTop: '4px', lineHeight: 1.4 }}>
              Higher depth → stronger analysis, slower per move.
              Default 12 is a good balance.
            </div>
          </div>

          {/* MultiPV */}
          <div style={{ marginBottom: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
              <label htmlFor="setting-multipv" style={{ color: '#d4d4d8', fontWeight: 600 }}>
                Top moves shown
              </label>
              <span style={{
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                color: '#86efac',
                fontWeight: 700,
              }}>
                {multipv}
              </span>
            </div>
            <input
              id="setting-multipv"
              type="range"
              min={1}
              max={10}
              step={1}
              value={multipv}
              onChange={e => setMultipv(parseInt(e.target.value, 10))}
              style={{ width: '100%', accentColor: '#86efac' }}
            />
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '9px',
              color: '#52525b',
              marginTop: '2px',
            }}>
              <span>1</span>
              <span>10</span>
            </div>
            <div style={{ fontSize: '10px', color: '#71717a', marginTop: '4px', lineHeight: 1.4 }}>
              How many candidate moves the engine evaluates per position.
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
            <button
              onClick={() => setOpen(false)}
              style={{
                padding: '5px 10px',
                fontSize: '10px',
                fontWeight: 700,
                backgroundColor: 'transparent',
                color: '#a1a1aa',
                border: '1px solid #27272a',
                borderRadius: '6px',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              onClick={apply}
              style={{
                padding: '5px 12px',
                fontSize: '10px',
                fontWeight: 700,
                backgroundColor: 'rgba(74,222,128,0.15)',
                color: '#86efac',
                border: '1px solid rgba(74,222,128,0.40)',
                borderRadius: '6px',
                cursor: 'pointer',
              }}
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
