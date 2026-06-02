import React from 'react';
import { View } from 'react-native';
import { G, Rect, Svg } from 'react-native-svg';

import { theme } from '../../../../lib/theme';

const GAP = 3;
const MIN_BAR_H = 3;
const PAD_H = 4;
const PAD_V = 4;

export function MetricBarChart({
  sparkline = [],
  status = 'watch',
  width = 300,
  height = 80,
}) {
  const values = Array.isArray(sparkline) ? sparkline : [];
  const defined = values.filter((v) => v !== null && v !== undefined);

  const lineColor = status === 'flagged'
    ? theme.colors.status.error
    : status === 'watch'
      ? theme.colors.status.warning
      : theme.colors.accent.primary;

  if (values.length === 0) {
    return <View style={{ width, height }} />;
  }

  const n = values.length;
  const chartW = width - PAD_H * 2;
  const chartH = height - PAD_V * 2;
  const barW = Math.max(2, (chartW - (n - 1) * GAP) / n);
  const maxV = defined.length > 0 ? Math.max(...defined) : 1;
  const range = maxV || 1;

  return (
    <Svg width={width} height={height}>
      <G>
        {values.map((v, i) => {
          const x = PAD_H + i * (barW + GAP);
          const isNull = v === null || v === undefined;
          const barH = isNull
            ? 0
            : Math.max(MIN_BAR_H, (v / range) * chartH);
          const barY = PAD_V + chartH - barH;

          return (
            <G key={i}>
              {/* Ghost slot — always shown */}
              <Rect
                x={x}
                y={PAD_V}
                width={barW}
                height={chartH}
                rx={2}
                fill={lineColor}
                opacity={0.07}
              />
              {/* Value bar — only for non-null */}
              {!isNull ? (
                <Rect
                  x={x}
                  y={barY}
                  width={barW}
                  height={barH}
                  rx={2}
                  fill={lineColor}
                  opacity={0.78}
                />
              ) : null}
            </G>
          );
        })}
      </G>
    </Svg>
  );
}
