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
}

function computeNiceAxisScale(maxValue: number): {
  yMax: number;
  step: number;
  ticks: number[];
} {
  const safeMax = Math.max(0.5, maxValue * 1.12);

  let step = 100;
  if (safeMax <= 1) step = 0.1;
  else if (safeMax <= 2.5) step = 0.25;
  else if (safeMax <= 5) step = 0.5;
  else if (safeMax <= 10) step = 1;
  else if (safeMax <= 25) step = 2.5;
  else if (safeMax <= 50) step = 5;
  else if (safeMax <= 100) step = 10;
  else if (safeMax <= 250) step = 25;
  else if (safeMax <= 500) step = 50;
  else if (safeMax <= 1200) step = 100;
  else if (safeMax <= 2500) step = 250;
  else if (safeMax <= 5000) step = 500;
  else step = 1000;

  const numSteps = Math.max(5, Math.ceil(safeMax / step));
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

  // SVG coordinate geometry matching PRTG Network Monitor layout
  const svgW = 960;
  const svgH = 308;
  const plotLeft = 64;
  const plotRight = 944;
  const plotTop = 14;
  const plotBottom = 242;
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

  // Build SVG polyline strings for Total (#0d265c), Traffic In / Download (#2b998e), Traffic Out / Upload (#e04086)
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

  // Find Max and Min indices among real sampled points (or all points if none > 0)
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
      ? 1
      : count <= 60
      ? 2
      : count <= 120
      ? 4
      : Math.max(1, Math.floor(count / 24));

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
      className={`rounded border border-[#cfd6de] bg-[#fcfcfd] p-3.5 text-[#111827] shadow-md transition ${
        onClickGraph ? 'cursor-pointer hover:border-[#0275d8] hover:shadow-lg' : ''
      }`}
    >
      {/* Top PRTG-Style Breadcrumb Header */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="text-[13px] font-medium tracking-tight text-[#111827] sm:text-[14px]">
          {breadcrumbPath}
        </div>

        <div
          className="flex flex-wrap items-center gap-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          {onSelectPeriod && (
            <div className="flex items-center gap-1 rounded border border-[#d0d7de] bg-[#f3f4f6] p-0.5 text-[11px]">
              {(
                [
                  { id: 'Live2h', label: '2 Hours' },
                  { id: 'Daily', label: '24 Hours (5m)' },
                  { id: 'Weekly', label: '7 Days' },
                  { id: 'Monthly', label: '30 Days' },
                  { id: 'Yearly', label: '1 Year' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onSelectPeriod(tab.id)}
                  className={`rounded px-2 py-0.5 font-semibold transition ${
                    activePeriod === tab.id
                      ? 'bg-[#0d265c] text-white'
                      : 'text-[#374151] hover:bg-[#e5e7eb]'
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
              className="rounded border border-[#0d265c]/30 bg-[#0d265c]/10 px-2.5 py-0.5 text-[11px] font-semibold text-[#0d265c] hover:bg-[#0d265c] hover:text-white"
            >
              {clickHintText}
            </button>
          )}
        </div>
      </div>

      {/* Main White PRTG SVG Chart Canvas */}
      <div className="relative overflow-x-auto bg-white">
        <svg
          viewBox={`0 0 ${svgW} ${svgH}`}
          className="h-auto w-full min-w-[680px] select-none"
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
          {/* Plot Background */}
          <rect
            x={plotLeft}
            y={plotTop}
            width={plotW}
            height={plotH}
            fill="#ffffff"
            stroke="#cccccc"
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
                  stroke="#dcdcdc"
                  strokeWidth="1"
                />
                <line
                  x1={plotLeft - 5}
                  y1={y}
                  x2={plotLeft}
                  y2={y}
                  stroke="#333333"
                  strokeWidth="1"
                />
                <text
                  x={plotLeft - 8}
                  y={y + 3.5}
                  textAnchor="end"
                  fill="#333333"
                  fontSize="10.5"
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
                  stroke="#dcdcdc"
                  strokeWidth="1"
                />
                <line
                  x1={x}
                  y1={plotBottom}
                  x2={x}
                  y2={plotBottom + 5}
                  stroke="#333333"
                  strokeWidth="1"
                />
                <text
                  transform={`translate(${x + 3.5}, ${plotBottom + 10}) rotate(-90)`}
                  textAnchor="end"
                  fill="#333333"
                  fontSize="10"
                  fontFamily="Inter, system-ui, sans-serif"
                >
                  {displayTime}
                </text>
              </g>
            );
          })}

          {/* Rotated Y-Axis Unit Label "Mbit/s" */}
          <text
            transform={`translate(18, ${plotTop + plotH / 2}) rotate(-90)`}
            textAnchor="middle"
            fill="#444444"
            fontSize="11.5"
            fontFamily="Inter, system-ui, sans-serif"
          >
            Mbit/s
          </text>

          {/* 1. Shaded Area Fill under Traffic In / Download (#2b998e at 14% opacity) */}
          {downAreaPolygon && (
            <polygon points={downAreaPolygon} fill="rgba(43, 153, 142, 0.14)" />
          )}

          {/* 2. Traffic Out / Upload Line (Magenta / Rose Pink #e04086) */}
          {upPolyline && (
            <polyline
              fill="none"
              stroke="#e04086"
              strokeWidth="1.45"
              strokeLinejoin="round"
              strokeLinecap="round"
              points={upPolyline}
            />
          )}

          {/* 3. Traffic In / Download Line (Teal Green #2b998e) */}
          {downPolyline && (
            <polyline
              fill="none"
              stroke="#2b998e"
              strokeWidth="1.5"
              strokeLinejoin="round"
              strokeLinecap="round"
              points={downPolyline}
            />
          )}

          {/* 4. Total Traffic Line (Dark Navy Blue #0d265c) */}
          {totalPolyline && (
            <polyline
              fill="none"
              stroke="#0d265c"
              strokeWidth="1.6"
              strokeLinejoin="round"
              strokeLinecap="round"
              points={totalPolyline}
            />
          )}

          {/* Left Y-Axis and Bottom X-Axis Dark Spines */}
          <line
            x1={plotLeft}
            y1={plotTop}
            x2={plotLeft}
            y2={plotBottom}
            stroke="#333333"
            strokeWidth="1.2"
          />
          <line
            x1={plotLeft}
            y1={plotBottom}
            x2={plotRight}
            y2={plotBottom}
            stroke="#333333"
            strokeWidth="1.2"
          />

          {/* PRTG Watermark Title Inside Top-Left of Plot Box */}
          <text
            x={plotLeft + 8}
            y={plotTop + 23}
            fill="#555555"
            fontSize="19"
            fontWeight="500"
            fontFamily="Inter, system-ui, sans-serif"
          >
            {watermarkTitle}
          </text>

          {/* Max & Min Dots for Total (#0d265c), Download (#2b998e), Upload (#e04086) */}
          {maxTotIdx >= 0 && points[maxTotIdx] && (
            <circle
              cx={xAt(maxTotIdx)}
              cy={yAt(points[maxTotIdx].totalMbps)}
              r="3.6"
              fill="#0d265c"
            />
          )}
          {minTotIdx >= 0 && points[minTotIdx] && (
            <circle
              cx={xAt(minTotIdx)}
              cy={yAt(points[minTotIdx].totalMbps)}
              r="3.6"
              fill="#0d265c"
            />
          )}

          {maxUpIdx >= 0 && points[maxUpIdx] && (
            <circle
              cx={xAt(maxUpIdx)}
              cy={yAt(points[maxUpIdx].uploadMbps)}
              r="3.6"
              fill="#e04086"
            />
          )}
          {minUpIdx >= 0 && points[minUpIdx] && (
            <circle
              cx={xAt(minUpIdx)}
              cy={yAt(points[minUpIdx].uploadMbps)}
              r="3.6"
              fill="#e04086"
            />
          )}

          {maxDownIdx >= 0 && points[maxDownIdx] && (
            <g>
              <circle
                cx={xAt(maxDownIdx)}
                cy={yAt(points[maxDownIdx].downloadMbps)}
                r="3.8"
                fill="#2b998e"
              />
              {/* Floating "Max: XXX Mbit/s" label matching screenshot */}
              {(() => {
                const cx = Math.max(plotLeft + 52, Math.min(plotRight - 52, xAt(maxDownIdx)));
                const cy = Math.max(plotTop + 18, yAt(points[maxDownIdx].downloadMbps) - 10);
                return (
                  <g>
                    <rect
                      x={cx - 48}
                      y={cy - 11}
                      width="96"
                      height="15"
                      rx="2"
                      fill="rgba(255,255,255,0.85)"
                    />
                    <text
                      x={cx}
                      y={cy}
                      textAnchor="middle"
                      fill="#222222"
                      fontSize="10"
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
                  r="3.8"
                  fill="#2b998e"
                />
                {(() => {
                  const cx = Math.max(
                    plotLeft + 52,
                    Math.min(plotRight - 52, xAt(minDownIdx))
                  );
                  const cy = Math.min(
                    plotBottom - 6,
                    yAt(points[minDownIdx].downloadMbps) + 15
                  );
                  return (
                    <g>
                      <rect
                        x={cx - 48}
                        y={cy - 11}
                        width="96"
                        height="15"
                        rx="2"
                        fill="rgba(255,255,255,0.85)"
                      />
                      <text
                        x={cx}
                        y={cy}
                        textAnchor="middle"
                        fill="#222222"
                        fontSize="10"
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
                stroke="#0d265c"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
              <circle
                cx={xAt(hoverIdx)}
                cy={yAt(hoveredPoint.totalMbps)}
                r="4"
                fill="#0d265c"
                stroke="#ffffff"
                strokeWidth="1.2"
              />
              <circle
                cx={xAt(hoverIdx)}
                cy={yAt(hoveredPoint.downloadMbps)}
                r="4"
                fill="#2b998e"
                stroke="#ffffff"
                strokeWidth="1.2"
              />
              <circle
                cx={xAt(hoverIdx)}
                cy={yAt(hoveredPoint.uploadMbps)}
                r="4"
                fill="#e04086"
                stroke="#ffffff"
                strokeWidth="1.2"
              />
            </g>
          )}
        </svg>

        {/* Floating Hover Tooltip */}
        {hoveredPoint && (
          <div className="pointer-events-none absolute top-3 right-5 rounded border border-[#cbd5e1] bg-white/95 px-3 py-2 text-[11px] text-[#111827] shadow-lg">
            <div className="font-bold text-[#0d265c]">{hoveredPoint.label}</div>
            <div className="mt-1 flex items-center gap-3 font-mono">
              <span className="flex items-center gap-1 text-[#0d265c]">
                <span className="inline-block h-2 w-2 rounded-full bg-[#0d265c]" />
                Total: {formatMbitValue(hoveredPoint.totalMbps)}
              </span>
              <span className="flex items-center gap-1 text-[#2b998e]">
                <span className="inline-block h-2 w-2 rounded-full bg-[#2b998e]" />
                Traffic In: {formatMbitValue(hoveredPoint.downloadMbps)}
              </span>
              <span className="flex items-center gap-1 text-[#e04086]">
                <span className="inline-block h-2 w-2 rounded-full bg-[#e04086]" />
                Traffic Out: {formatMbitValue(hoveredPoint.uploadMbps)}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Legend + PRTG Footer */}
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 border-t border-[#e5e7eb] px-1 pt-2 text-[11px] text-[#4b5563]">
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex items-center gap-1.5 font-medium text-[#0d265c]">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#0d265c]" />
            Total: Now {formatMbitValue(curTotal)} (Max{' '}
            {formatMbitValue(series?.maxTotalMbps ?? maxTotal)})
          </span>
          <span className="flex items-center gap-1.5 font-medium text-[#2b998e]">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#2b998e]" />
            Traffic In (Download): Now {formatMbitValue(series?.curDownloadMbps ?? 0)} / Max{' '}
            {formatMbitValue(series?.maxDownloadMbps ?? 0)} / Avg{' '}
            {formatMbitValue(series?.avgDownloadMbps ?? 0)}
          </span>
          <span className="flex items-center gap-1.5 font-medium text-[#e04086]">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-[#e04086]" />
            Traffic Out (Upload): Now {formatMbitValue(series?.curUploadMbps ?? 0)} / Max{' '}
            {formatMbitValue(series?.maxUploadMbps ?? 0)} / Avg{' '}
            {formatMbitValue(series?.avgUploadMbps ?? 0)}
          </span>
        </div>

        <div className="flex items-center gap-3 font-mono text-[10.5px] text-[#6b7280]">
          <span>
            JetCyber Network Monitor (Real OLT Telemetry • {totalSamplesRecorded} samples)
          </span>
          <span>
            {polledAtStr || 'Asia/Jakarta WIB'} - ID {sensorId}
          </span>
        </div>
      </div>
    </div>
  );
};
