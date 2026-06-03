import React from 'react';
import { StyleSheet, View } from 'react-native';
import { G, Rect, Svg } from 'react-native-svg';

import { ModeText } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';

const GAP = 4;
const MIN_BAR_H = 3;
const PAD_H = 4;
const PAD_V = 4;

export function MetricBarChart({
  sparkline = [],
  status = 'watch',
  width = 300,
  height = 80,
  xLabels = null,
  highlightToday = true,
  maxValue = 5,
}) {
  const values = Array.isArray(sparkline) ? sparkline : [];

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
  const range = maxValue || 1;

  // Index of the last non-null value (today's bar)
  let lastDefinedIndex = -1;
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i] !== null && values[i] !== undefined) {
      lastDefinedIndex = i;
      break;
    }
  }

  return (
    <View style={{ width }}>
      <Svg width={width} height={height}>
        <G>
          {values.map((v, i) => {
            const x = PAD_H + i * (barW + GAP);
            const isNull = v === null || v === undefined;

            if (isNull) {
              // 4px stub at bottom for missing/zero days
              return (
                <Rect
                  key={i}
                  x={x}
                  y={PAD_V + chartH - 4}
                  width={barW}
                  height={4}
                  rx={2}
                  fill={lineColor}
                  opacity={0.06}
                />
              );
            }

            const barH = Math.max(MIN_BAR_H, (v / range) * chartH);
            const barY = PAD_V + chartH - barH;
            const isTodayBar = highlightToday && i === lastDefinedIndex;
            const barColor = isTodayBar ? theme.colors.status.success : lineColor;

            return (
              <G key={i}>
                {/* Ghost slot for defined values */}
                <Rect
                  x={x}
                  y={PAD_V}
                  width={barW}
                  height={chartH}
                  rx={2}
                  fill={lineColor}
                  opacity={0.07}
                />
                {/* Value bar */}
                <Rect
                  x={x}
                  y={barY}
                  width={barW}
                  height={barH}
                  rx={2}
                  fill={barColor}
                  opacity={0.78}
                />
              </G>
            );
          })}
        </G>
      </Svg>

      {xLabels && xLabels.length > 0 ? (
        <View style={[styles.labelsRow, { paddingHorizontal: PAD_H }]}>
          {xLabels.map((label, i) => (
            <ModeText key={i} variant="caption" tone="tertiary" style={styles.barLabel}>
              {label}
            </ModeText>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  labelsRow: {
    flexDirection: 'row',
    marginTop: 4,
  },
  barLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 10,
  },
});
