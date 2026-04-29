import React from 'react';
import { Info, TrendingUp, TrendingDown, Minus } from 'lucide-react';

export default function MoveExplanation({ explanation, loading }) {
  if (loading) {
    return (
      <div style={{
        padding: '16px',
        backgroundColor: '#18181b',
        borderRadius: '8px',
        border: '1px solid #27272a',
        color: '#71717a',
        fontSize: '13px',
        textAlign: 'center'
      }}>
        Analyzing move...
      </div>
    );
  }

  if (!explanation) {
    return (
      <div style={{
        padding: '16px',
        backgroundColor: '#18181b',
        borderRadius: '8px',
        border: '1px solid #27272a',
        color: '#52525b',
        fontSize: '13px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
      }}>
        <Info size={14} />
        <span>Hover over a move to see analysis</span>
      </div>
    );
  }

  const { san, summary, details, evalDelta, factors } = explanation;

  const TrendIcon = evalDelta > 0.2
    ? TrendingUp
    : evalDelta < -0.2
      ? TrendingDown
      : Minus;

  const trendColor = evalDelta > 0.2
    ? '#4ade80'
    : evalDelta < -0.2
      ? '#f87171'
      : '#a1a1aa';

  return (
    <div style={{
      padding: '16px',
      backgroundColor: '#18181b',
      borderRadius: '8px',
      border: '1px solid #27272a'
    }}>
      {/* Header with move and eval change */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '12px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{
            fontSize: '18px',
            fontWeight: 700,
            fontFamily: 'monospace',
            color: '#e4e4e7'
          }}>
            {san}
          </span>
          <TrendIcon size={18} color={trendColor} />
        </div>
        <span style={{
          fontSize: '13px',
          fontWeight: 600,
          fontFamily: 'monospace',
          color: trendColor
        }}>
          {evalDelta > 0 ? '+' : ''}{evalDelta?.toFixed(2)}
        </span>
      </div>

      {/* Summary */}
      <p style={{
        fontSize: '14px',
        color: '#d4d4d8',
        margin: '0 0 8px 0',
        lineHeight: 1.5
      }}>
        {summary}
      </p>

      {/* Details */}
      <p style={{
        fontSize: '13px',
        color: '#a1a1aa',
        margin: 0,
        lineHeight: 1.5
      }}>
        {details}
      </p>

      {/* Factor tags */}
      {factors && factors.length > 0 && (
        <div style={{
          marginTop: '12px',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px'
        }}>
          {factors.map((factor, idx) => (
            <span
              key={idx}
              style={{
                fontSize: '10px',
                fontWeight: 600,
                textTransform: 'uppercase',
                padding: '4px 8px',
                borderRadius: '4px',
                backgroundColor: factor.value > 0
                  ? 'rgba(74, 222, 128, 0.15)'
                  : 'rgba(248, 113, 113, 0.15)',
                color: factor.value > 0 ? '#4ade80' : '#f87171'
              }}
            >
              {factor.type.replace('_', ' ')}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
