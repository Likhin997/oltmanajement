import React, { useState } from 'react';

export interface PrtgTrafficPoint {
  timestampMs: number;
  label: string;
  shortLabel: string;
  totalMbps?: number;
  downloadMbps: number;
  uploadMbps: number;
  sampleCount: number;
  isLive: boolean;
}

export interface PrtgTrafficSeries {
  period: string;
  intervalLabel: string;
  points: PrtgTrafficPoint[];
  curTotalMbps?: number;
  maxTotalMbps?: number;
  minTotalMbps?: number;
  avgTotalMbps?: number;
  curDownloadMbps: number;
  maxDownloadMbps: number;
  minDownloadMbps?: number;
  avgDownloadMbps: number;
  curUploadMbps: number;
  maxUploadMbps: number;
  minUploadMbps?: number;
  avgUploadMbps: number;
}

interface PrtgTrafficGraphProps {
  breadcrumbPath: string;
  watermarkTitle: string;
  series: PrtgTrafficSeries | undefined;
  sensorId: number | string;
  polledAtStr?: string;
  activePeriod?: string;
  onSelectPeriod?: (period: 'Live2h' | 'Daily' | 'Weekly' | 'Monthly' | 'Yearly') => void;
  onClickGraph?: () => void;
  clickHintText?: string;
  compact?: boolean;
}

function computeNiceAxisScale(maxValue: number): {
  yMax: number;
  step: number;
  ticks: number[];
} {
  const safeMax = Math.max(0.5, maxValue * 1.15);

  let step = 100;
  if (safeMax <= 1) step = 0.2;
  else if (safeMax <= 2.5) step = 0.5;
  else if (safeMax <= 5) step = 1;
  else if (safeMax <= 10) step = 2;
  else if (safeMax <= 25) step = 5;
  else if (safeMax <= 50) step = 10;
  else if (safeMax <= 100) step = 20;
  else if (safeMax <= 250) step = 50;
  else if (safeMax <= 500) step = 100;
  else if (safeMax <= 1200) step = 200;
  else if (safeMax <= 2500) step = 500;
  else if (safeMax <= 5000) step = 1000;
  else step = 2000;

  const numSteps = Math.max(4, Math.min(8, Math.ceil(safeMax / step)));
  const yMax = Number((numSteps * step).toFixed(2));
  const ticks: number[] = [];
  for (let i = 0; i <= numSteps; i++) {
    ticks.push(Number((i * step).toFixed(2)));
  }
  return { yMax, step, ticks };
}

function formatMbitValue(val: number): string {
  if (val >= 100) return `${Math.round(val)} Mbit/s`;
  if (val >= 10) return `${val.toFixed(1)} Mbit/s`;
  return `${val.toFixed(2)} Mbit/s`;
}

function formatTickNumber(val: number): string {
  if (Number.isInteger(val)) return String(val);
  if (val * 10 === Math.round(val * 10)) return val.toFixed(1);
  return val.toFixed(2);
}

export const PrtgTrafficGraph: React.FC<PrtgTrafficGraphProps> = ({
  breadcrumbPath,
  watermarkTitle,
  series,
  sensorId,
  polledAtStr,
  activePeriod,
  onSelectPeriod,
  onClickGraph,
  clickHintText,
  compact = false,
}) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const rawPoints = series?.points || [];
  const points = rawPoints.map((p) => {
    const down = Number(p.downloadMbps || 0);
    const up = Number(p.uploadMbps || 0);
    const tot =
      p.totalMbps !== undefined && p.totalMbps !== null
        ? Number(p.totalMbps)
        : Number((down + up).toFixed(2));
    return {
      ...p,
      downloadMbps: down,
      uploadMbps: up,
      totalMbps: tot,
    };
  });

  const maxTotal = Math.max(
    0,
    ...points.map((p) => p.totalMbps),
    series?.maxTotalMbps || 0,
    (series?.maxDownloadMbps || 0) + (series?.maxUploadMbps || 0)
  );

  const { yMax, ticks } = computeNiceAxisScale(maxTotal);

  // SVG coordinate geometry harmonized with the app's dark navy dashboard
  const svgW = 860;
  const svgH = compact ? 255 : 285;
  const plotLeft = 58;
  const plotRight = 844;
  const plotTop = 14;
  const plotBottom = compact ? 198 : 224;
  const plotW = plotRight - plotLeft;
  const plotH = plotBottom - plotTop;

  const count = points.length;
  const xAt = (idx: number): number => {
    if (count <= 1) return plotLeft + plotW / 2;
    return Number((plotLeft + (idx / (count - 1)) * plotW).toFixed(2));
  };
  const yAt = (val: number): number => {
    const clamped = Math.max(0, Math.min(yMax, val));
    return Number((plotBottom - (clamped / yMax) * plotH).toFixed(2));
  };

  // Build SVG polyline strings for Total (#60a5fa), Traffic In / Download (#2dd4bf), Traffic Out / Upload (#f472b6)
  const totalPolyline = points
    .map((p, idx) => `${xAt(idx)},${yAt(p.totalMbps)}`)
    .join(' ');
  const downPolyline = points
    .map((p, idx) => `${xAt(idx)},${yAt(p.downloadMbps)}`)
    .join(' ');
  const upPolyline = points
    .map((p, idx) => `${xAt(idx)},${yAt(p.uploadMbps)}`)
    .join(' ');

  const downAreaPolygon =
    points.length > 0
      ? `${xAt(0)},${plotBottom} ${downPolyline} ${xAt(points.length - 1)},${plotBottom}`
      : '';

  // Find Max and Min indices among real sampled points
  const hasNonZero = points.some((p) => p.totalMbps > 0 || p.sampleCount > 0);
  let maxTotIdx = -1;
  let minTotIdx = -1;
  let maxDownIdx = -1;
  let minDownIdx = -1;
  let maxUpIdx = -1;
  let minUpIdx = -1;

  if (points.length > 0) {
    let bestMaxTot = -Infinity;
    let bestMinTot = Infinity;
    let bestMaxDown = -Infinity;
    let bestMinDown = Infinity;
    let bestMaxUp = -Infinity;
    let bestMinUp = Infinity;

    points.forEach((p, idx) => {
      const eligibleForMin = hasNonZero ? p.sampleCount > 0 || p.totalMbps > 0 : true;
      if (p.totalMbps > bestMaxTot) {
        bestMaxTot = p.totalMbps;
        maxTotIdx = idx;
      }
      if (eligibleForMin && p.totalMbps < bestMinTot) {
        bestMinTot = p.totalMbps;
        minTotIdx = idx;
      }
      if (p.downloadMbps > bestMaxDown) {
        bestMaxDown = p.downloadMbps;
        maxDownIdx = idx;
      }
      if (eligibleForMin && p.downloadMbps < bestMinDown) {
        bestMinDown = p.downloadMbps;
        minDownIdx = idx;
      }
      if (p.uploadMbps > bestMaxUp) {
        bestMaxUp = p.uploadMbps;
        maxUpIdx = idx;
      }
      if (eligibleForMin && p.uploadMbps < bestMinUp) {
        bestMinUp = p.uploadMbps;
        minUpIdx = idx;
      }
    });
  }

  // Decide which X-axis indices get vertical grid lines and rotated timestamp labels
  const xTickStep =
    count <= 28
      ? compact
        ? 2
        : 1
      : count <= 60
      ? compact
        ? 4
        : 2
      : count <= 120
      ? 6
      : Math.max(1, Math.floor(count / (compact ? 12 : 20)));

  const xTickIndices: number[] = [];
  for (let i = 0; i < count; i += xTickStep) {
    xTickIndices.push(i);
  }
  if (count > 1 && xTickIndices[xTickIndices.length - 1] !== count - 1) {
    xTickIndices.push(count - 1);
  }

  const totalSamplesRecorded = points.reduce((acc, p) => acc + (p.sampleCount || 0), 0);
  const curTotal =
    series?.curTotalMbps ??
    Number(((series?.curDownloadMbps || 0) + (series?.curUploadMbps || 0)).toFixed(2));
  const maxDownVal = series?.maxDownloadMbps ?? 0;
  const minDownVal = series?.minDownloadMbps ?? 0;

  const hoveredPoint =
    hoverIdx !== null && hoverIdx >= 0 && hoverIdx < points.length
      ? points[hoverIdx]
      : null;

  return (
    <div
      onClick={onClickGraph}
      className={`flex flex-col justify-between rounded-xl border border-slate-800/90 bg-[#0b1526]/95 text-slate-200 shadow-lg transition ${
        compact ? 'p-3' : 'p-4'
      } ${
        onClickGraph
          ? 'cursor-pointer hover:border-sky-500/60 hover:bg-[#0d192d] hover:shadow-sky-950/30'
          : ''
      }`}
    >
      {/* Top Breadcrumb Header */}
      <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
        <div
          className={`truncate font-medium tracking-tight text-slate-200 ${
            compact ? 'max-w-full text-[11px]' : 'text-xs sm:text-[13px]'
          }`}
          title={breadcrumbPath}
        >
          {breadcrumbPath}
        </div>

        <div
          className="flex flex-wrap items-center gap-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          {onSelectPeriod && !compact && (
            <div className="flex items-center gap-0.5 rounded-lg border border-slate-800 bg-[#060c17] p-0.5 text-[10.5px]">
              {(
                [
                  { id: 'Live2h', label: '2h' },
                  { id: 'Daily', label: '24h' },
                  { id: 'Weekly', label: '7d' },
                  { id: 'Monthly', label: '30d' },
                  { id: 'Yearly', label: '1y' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onSelectPeriod(tab.id)}
                  className={`rounded-md px-2 py-0.5 font-semibold transition ${
                    activePeriod === tab.id
                      ? 'bg-sky-600 text-white'
                      : 'text-slate-400 hover:bg-slate-800/80 hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}

          {clickHintText && onClickGraph && (
            <button
              type="button"
              onClick={onClickGraph}
              className="rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[10.5px] font-semibold text-sky-300 transition hover:bg-sky-600 hover:text-white"
            >
              {compact ? 'Detail →' : clickHintText}
            </button>
          )}
        </div>
      </div>

      {/* Main Dark Harmonized PRTG SVG Chart Canvas */}
      <div className="relative overflow-hidden rounded-lg border border-slate-800/90 bg-[#060c17]">
        <svg
          viewBox={`0 0 ${svgW} ${svgH}`}
          className="h-auto w-full select-none"
          onMouseLeave={() => setHoverIdx(null)}
          onMouseMove={(e) => {
            if (points.length === 0) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const relX = ((e.clientX - rect.left) / rect.width) * svgW;
            if (relX < plotLeft || relX > plotRight) {
              setHoverIdx(null);
              return;
            }
            const ratio = (relX - plotLeft) / plotW;
            const idx = Math.max(
              0,
              Math.min(points.length - 1, Math.round(ratio * (points.length - 1)))
            );
            setHoverIdx(idx);
          }}
        >
          {/* Plot Background matching app dark surface */}
          <rect
            x={plotLeft}
            y={plotTop}
            width={plotW}
            height={plotH}
            fill="#07101f"
            stroke="#16263d"
            strokeWidth="1"
          />

          {/* Horizontal Grid Lines + Left Y-Axis Ticks & Labels */}
          {ticks.map((tVal, i) => {
            const y = yAt(tVal);
            return (
              <g key={`y-tick-${i}`}>
                <line
                  x1={plotLeft}
                  y1={y}
                  x2={plotRight}
                  y2={y}
                  stroke="#132238"
                  strokeWidth="1"
                />
                <line
                  x1={plotLeft - 4}
                  y1={y}
                  x2={plotLeft}
                  y2={y}
                  stroke="#334e73"
                  strokeWidth="1"
                />
                <text
                  x={plotLeft - 7}
                  y={y + 3.5}
                  textAnchor="end"
                  fill="#94a3b8"
                  fontSize="10"
                  fontFamily="Inter, system-ui, sans-serif"
                >
                  {formatTickNumber(tVal)}
                </text>
              </g>
            );
          })}

          {/* Vertical Grid Lines + Bottom X-Axis Rotated WIB Timestamps */}
          {xTickIndices.map((ptIdx) => {
            const pt = points[ptIdx];
            if (!pt) return null;
            const x = xAt(ptIdx);
            const displayTime =
              pt.shortLabel ||
              pt.label.replace(/\s*WIB$/i, '').split(' - ').pop() ||
              '';
            return (
              <g key={`x-tick-${ptIdx}`}>
                <line
                  x1={x}
                  y1={plotTop}
                  x2={x}
                  y2={plotBottom}
                  stroke="#132238"
                  strokeWidth="1"
                />
                <line
                  x1={x}
                  y1={plotBottom}
                  x2={x}
                  y2={plotBottom + 4}
                  stroke="#334e73"
                  strokeWidth="1"
                />
                <text
                  transform={`translate(${x + 3}, ${plotBottom + 8}) rotate(-90)`}
                  textAnchor="end"
                  fill="#94a3b8"
                  fontSize="9.5"
                  fontFamily="Inter, system-ui, sans-serif"
                >
                  {displayTime}
                </text>
              </g>
            );
          })}

          {/* Rotated Y-Axis Unit Label "Mbit/s" */}
          <text
            transform={`translate(15, ${plotTop + plotH / 2}) rotate(-90)`}
            textAnchor="middle"
            fill="#64748b"
            fontSize="10.5"
            fontFamily="Inter, system-ui, sans-serif"
          >
            Mbit/s
          </text>

          {/* 1. Shaded Area Fill under Traffic In / Download (Teal #2dd4bf at 13% opacity) */}
          {downAreaPolygon && (
            <polygon points={downAreaPolygon} fill="rgba(45, 212, 191, 0.13)" />
          )}

          {/* 2. Traffic Out / Upload Line (Rose Magenta #f472b6) */}
          {upPolyline && (
            <polyline
              fill="none"
              stroke="#f472b6"
              strokeWidth="1.5"
              strokeLinejoin="round"
              strokeLinecap="round"
              points={upPolyline}
            />
          )}

          {/* 3. Traffic In / Download Line (Teal Green #2dd4bf) */}
          {downPolyline && (
            <polyline
              fill="none"
              stroke="#2dd4bf"
              strokeWidth="1.55"
              strokeLinejoin="round"
              strokeLinecap="round"
              points={downPolyline}
            />
          )}

          {/* 4. Total Traffic Line (Sky Blue #60a5fa) */}
          {totalPolyline && (
            <polyline
              fill="none"
              stroke="#60a5fa"
              strokeWidth="1.65"
              strokeLinejoin="round"
              strokeLinecap="round"
              points={totalPolyline}
            />
          )}

          {/* Left Y-Axis and Bottom X-Axis Spines */}
          <line
            x1={plotLeft}
            y1={plotTop}
            x2={plotLeft}
            y2={plotBottom}
            stroke="#334e73"
            strokeWidth="1.2"
          />
          <line
            x1={plotLeft}
            y1={plotBottom}
            x2={plotRight}
            y2={plotBottom}
            stroke="#334e73"
            strokeWidth="1.2"
          />

          {/* Watermark Title Inside Top-Left of Plot Box */}
          <text
            x={plotLeft + 10}
            y={plotTop + 21}
            fill="#64748b"
            fontSize={compact ? '14' : '16'}
            fontWeight="600"
            fontFamily="Inter, system-ui, sans-serif"
          >
            {watermarkTitle}
          </text>

          {/* Max & Min Dots for Total (#60a5fa), Download (#2dd4bf), Upload (#f472b6) */}
          {maxTotIdx >= 0 && points[maxTotIdx] && (
            <circle
              cx={xAt(maxTotIdx)}
              cy={yAt(points[maxTotIdx].totalMbps)}
              r="3.4"
              fill="#60a5fa"
            />
          )}
          {minTotIdx >= 0 && points[minTotIdx] && (
            <circle
              cx={xAt(minTotIdx)}
              cy={yAt(points[minTotIdx].totalMbps)}
              r="3.4"
              fill="#60a5fa"
            />
          )}

          {maxUpIdx >= 0 && points[maxUpIdx] && (
            <circle
              cx={xAt(maxUpIdx)}
              cy={yAt(points[maxUpIdx].uploadMbps)}
              r="3.4"
              fill="#f472b6"
            />
          )}
          {minUpIdx >= 0 && points[minUpIdx] && (
            <circle
              cx={xAt(minUpIdx)}
              cy={yAt(points[minUpIdx].uploadMbps)}
              r="3.4"
              fill="#f472b6"
            />
          )}

          {maxDownIdx >= 0 && points[maxDownIdx] && (
            <g>
              <circle
                cx={xAt(maxDownIdx)}
                cy={yAt(points[maxDownIdx].downloadMbps)}
                r="3.6"
                fill="#2dd4bf"
              />
              {/* Floating "Max: XXX Mbit/s" label */}
              {(() => {
                const cx = Math.max(
                  plotLeft + 48,
                  Math.min(plotRight - 48, xAt(maxDownIdx))
                );
                const cy = Math.max(
                  plotTop + 16,
                  yAt(points[maxDownIdx].downloadMbps) - 9
                );
                return (
                  <g>
                    <rect
                      x={cx - 46}
                      y={cy - 10.5}
                      width="92"
                      height="14"
                      rx="3"
                      fill="rgba(11, 21, 38, 0.88)"
                      stroke="#1e3a5f"
                      strokeWidth="0.8"
                    />
                    <text
                      x={cx}
                      y={cy - 1}
                      textAnchor="middle"
                      fill="#e2e8f0"
                      fontSize="9.5"
                      fontFamily="Inter, system-ui, sans-serif"
                    >
                      Max: {formatMbitValue(maxDownVal)}
                    </text>
                  </g>
                );
              })()}
            </g>
          )}

          {minDownIdx >= 0 &&
            minDownIdx !== maxDownIdx &&
            points[minDownIdx] && (
              <g>
                <circle
                  cx={xAt(minDownIdx)}
                  cy={yAt(points[minDownIdx].downloadMbps)}
                  r="3.6"
                  fill="#2dd4bf"
                />
                {(() => {
                  const cx = Math.max(
                    plotLeft + 48,
                    Math.min(plotRight - 48, xAt(minDownIdx))
                  );
                  const cy = Math.min(
                    plotBottom - 6,
                    yAt(points[minDownIdx].downloadMbps) + 14
                  );
                  return (
                    <g>
                      <rect
                        x={cx - 46}
                        y={cy - 10.5}
                        width="92"
                        height="14"
                        rx="3"
                        fill="rgba(11, 21, 38, 0.88)"
                        stroke="#1e3a5f"
                        strokeWidth="0.8"
                      />
                      <text
                        x={cx}
                        y={cy - 1}
                        textAnchor="middle"
                        fill="#e2e8f0"
                        fontSize="9.5"
                        fontFamily="Inter, system-ui, sans-serif"
                      >
                        Min: {formatMbitValue(minDownVal)}
                      </text>
                    </g>
                  );
                })()}
              </g>
            )}

          {/* Hover Vertical Crosshair */}
          {hoverIdx !== null && hoveredPoint && (
            <g>
              <line
                x1={xAt(hoverIdx)}
                y1={plotTop}
                x2={xAt(hoverIdx)}
                y2={plotBottom}
                stroke="#60a5fa"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
              <circle
                cx={xAt(hoverIdx)}
                cy={yAt(hoveredPoint.totalMbps)}
                r="4"
                fill="#60a5fa"
                stroke="#060c17"
                strokeWidth="1.2"
              />
              <circle
                cx={xAt(hoverIdx)}
                cy={yAt(hoveredPoint.downloadMbps)}
                r="4"
                fill="#2dd4bf"
                stroke="#060c17"
                strokeWidth="1.2"
              />
              <circle
                cx={xAt(hoverIdx)}
                cy={yAt(hoveredPoint.uploadMbps)}
                r="4"
                fill="#f472b6"
                stroke="#060c17"
                strokeWidth="1.2"
              />
            </g>
          )}
        </svg>

        {/* Floating Hover Tooltip */}
        {hoveredPoint && (
          <div className="pointer-events-none absolute top-2.5 right-3 rounded-lg border border-slate-700/90 bg-[#0b1526]/95 px-2.5 py-1.5 text-[10.5px] text-slate-100 shadow-xl backdrop-blur-xs">
            <div className="font-semibold text-sky-300">{hoveredPoint.label}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2.5 font-mono">
              <span className="flex items-center gap-1 text-sky-400">
                <span className="inline-block h-2 w-2 rounded-full bg-sky-400" />
                Total: {formatMbitValue(hoveredPoint.totalMbps)}
              </span>
              <span className="flex items-center gap-1 text-teal-300">
                <span className="inline-block h-2 w-2 rounded-full bg-teal-400" />
                In: {formatMbitValue(hoveredPoint.downloadMbps)}
              </span>
              <span className="flex items-center gap-1 text-pink-400">
                <span className="inline-block h-2 w-2 rounded-full bg-pink-400" />
                Out: {formatMbitValue(hoveredPoint.uploadMbps)}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Legend + Footer */}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-1.5 border-t border-slate-800/80 pt-2 text-[10.5px] text-slate-400">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono">
          <span className="flex items-center gap-1 text-sky-400">
            <span className="inline-block h-2 w-2 rounded-full bg-sky-400" />
            Total: {formatMbitValue(curTotal)}
          </span>
          <span className="flex items-center gap-1 text-teal-300">
            <span className="inline-block h-2 w-2 rounded-full bg-teal-400" />
            In: {formatMbitValue(series?.curDownloadMbps ?? 0)}
            {!compact && ` (Max ${formatMbitValue(series?.maxDownloadMbps ?? 0)})`}
          </span>
          <span className="flex items-center gap-1 text-pink-400">
            <span className="inline-block h-2 w-2 rounded-full bg-pink-400" />
            Out: {formatMbitValue(series?.curUploadMbps ?? 0)}
            {!compact && ` (Max ${formatMbitValue(series?.maxUploadMbps ?? 0)})`}
          </span>
        </div>

        <div className="flex items-center gap-2 font-mono text-[10px] text-slate-500">
          {!compact && <span>Real OLT ({totalSamplesRecorded} sampel)</span>}
          <span>
            {polledAtStr || 'WIB'} • ID {sensorId}
          </span>
        </div>
      </div>
    </div>
  );
};
