import React from 'react';
import { format } from 'date-fns';

export interface UsagePoint {
  date:  Date;
  value: number;
}

/**
 * Dependency-free SVG scatter plot with a light trend line showing a numeric
 * value over time (chronological). Scales to its container via viewBox.
 */
export default function BirdieUsageChart({ points }: { points: UsagePoint[] }) {
  if (points.length === 0) {
    return <p className="text-muted text-center my-4">No birdie usage recorded yet.</p>;
  }

  const W = 560;
  const H = 280;
  const M = { top: 16, right: 16, bottom: 44, left: 44 };
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;

  const data  = [...points].sort((a, b) => a.date.getTime() - b.date.getTime());
  const times = data.map(p => p.date.getTime());
  const minT  = Math.min(...times);
  const maxT  = Math.max(...times);
  const maxV  = Math.max(...data.map(p => p.value), 1);

  const xScale = (t: number) =>
    maxT === minT ? M.left + innerW / 2 : M.left + ((t - minT) / (maxT - minT)) * innerW;
  const yScale = (v: number) => M.top + innerH - (v / maxV) * innerH;
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

  const yTicks = Array.from({ length: 5 }, (_, i) => (maxV / 4) * i);
  const linePath = data
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.date.getTime()).toFixed(1)} ${yScale(p.value).toFixed(1)}`)
    .join(' ');

  const xLabelPoints = Array.from(
    new Set([0, Math.floor((data.length - 1) / 2), data.length - 1]),
  ).map(i => data[i]);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Birds used per session over time">
      {/* Y gridlines + labels */}
      {yTicks.map((t, i) => {
        const yy = yScale(t);
        return (
          <g key={i}>
            <line x1={M.left} x2={W - M.right} y1={yy} y2={yy} stroke="#e9ecef" />
            <text x={M.left - 8} y={yy + 3} textAnchor="end" fontSize={10} fill="#868e96">{fmt(t)}</text>
          </g>
        );
      })}

      {/* Axes */}
      <line x1={M.left} x2={M.left}       y1={M.top} y2={M.top + innerH}            stroke="#adb5bd" />
      <line x1={M.left} x2={W - M.right}  y1={M.top + innerH} y2={M.top + innerH}   stroke="#adb5bd" />

      {/* X labels */}
      {xLabelPoints.map((p, i) => (
        <text key={i} x={xScale(p.date.getTime())} y={H - 24} textAnchor="middle" fontSize={10} fill="#868e96">
          {format(p.date, 'MMM d')}
        </text>
      ))}
      <text x={M.left + innerW / 2} y={H - 6} textAnchor="middle" fontSize={11} fill="#495057">Session date</text>
      <text
        transform={`translate(12 ${M.top + innerH / 2}) rotate(-90)`}
        textAnchor="middle" fontSize={11} fill="#495057"
      >
        Birds / court
      </text>

      {/* Trend line */}
      <path d={linePath} fill="none" stroke="#4dabf7" strokeWidth={1.5} opacity={0.6} />

      {/* Points */}
      {data.map((p, i) => (
        <circle key={i} cx={xScale(p.date.getTime())} cy={yScale(p.value)} r={4} fill="#1c7ed6">
          <title>{`${format(p.date, 'PP')}: ${fmt(p.value)} birds/court`}</title>
        </circle>
      ))}
    </svg>
  );
}
