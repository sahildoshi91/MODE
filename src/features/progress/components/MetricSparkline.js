import React from 'react';
import { View } from 'react-native';
import { Circle, G, Path, Svg } from 'react-native-svg';

import { theme } from '../../../../lib/theme';

const SPARKLINE_HEIGHT = 36;
const SPARKLINE_WIDTH = 80;
const STROKE_WIDTH = 1.5;
const DOT_RADIUS = 2;

function buildPath(points) {
  if (points.length === 0) {
    return '';
  }
  return points
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(' ');
}

function buildAreaPath(points, chartBottom) {
  if (points.length < 2) {
    return '';
  }
  const line = buildPath(points);
  const last = points[points.length - 1];
  const first = points[0];
  return `${line} L${last[0].toFixed(1)},${chartBottom.toFixed(1)} L${first[0].toFixed(1)},${chartBottom.toFixed(1)} Z`;
}

export function MetricSparkline({
  sparkline = [],
  status = 'watch',
  width = SPARKLINE_WIDTH,
  height = SPARKLINE_HEIGHT,
}) {
  const values = Array.isArray(sparkline) ? sparkline : [];
  const defined = values.filter((v) => v !== null && v !== undefined);

  const lineColor = status === 'flagged'
    ? theme.colors.status.error
    : status === 'watch'
      ? theme.colors.status.warning
      : theme.colors.accent.primary;

  if (defined.length < 2) {
    return <View style={{ width, height }} />;
  }

  const minV = Math.min(...defined);
  const maxV = Math.max(...defined);
  const range = maxV - minV || 1;
  const padV = 4;
  const padH = 4;
  const chartW = width - padH * 2;
  const chartH = height - padV * 2;

  const segments = [];
  let currentSegment = [];

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null || v === undefined) {
      if (currentSegment.length > 0) {
        segments.push(currentSegment);
        currentSegment = [];
      }
    } else {
      const x = padH + (i / (values.length - 1)) * chartW;
      const y = padV + chartH - ((v - minV) / range) * chartH;
      currentSegment.push([x, y]);
    }
  }
  if (currentSegment.length > 0) {
    segments.push(currentSegment);
  }

  const drawableSegments = segments.filter((seg) => seg.length >= 2);
  const singlePoints = segments.filter((seg) => seg.length === 1).map((seg) => seg[0]);
  const lastSegment = segments[segments.length - 1];
  const lastPoint = lastSegment ? lastSegment[lastSegment.length - 1] : null;
  const chartBottom = height - padV;

  return (
    <Svg width={width} height={height}>
      <G>
        {drawableSegments.map((seg, si) => (
          <Path
            key={`area-${si}`}
            d={buildAreaPath(seg, chartBottom)}
            fill={lineColor}
            stroke="none"
            opacity={0.12}
          />
        ))}
        {drawableSegments.map((seg, si) => (
          <Path
            key={`seg-${si}`}
            d={buildPath(seg)}
            stroke={lineColor}
            strokeWidth={STROKE_WIDTH}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            opacity={0.8}
          />
        ))}
        {singlePoints.map(([cx, cy], i) => (
          <Circle
            key={`isolated-${i}`}
            cx={cx}
            cy={cy}
            r={DOT_RADIUS}
            fill={lineColor}
            opacity={0.7}
          />
        ))}
        {lastPoint ? (
          <Circle
            cx={lastPoint[0]}
            cy={lastPoint[1]}
            r={DOT_RADIUS}
            fill={lineColor}
            opacity={0.95}
          />
        ) : null}
      </G>
    </Svg>
  );
}
