import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ModeText } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';

const MAX_PIPS = 5;

function getPipColor(value, total) {
  const filled = typeof value === 'number' ? Math.round(value) : 0;
  if (filled >= total * 0.8) {
    return theme.colors.status.success;
  }
  if (filled >= total * 0.5) {
    return theme.colors.status.warning;
  }
  return theme.colors.status.error;
}

export function MetricPipRow({
  label,
  value,
  maxValue = MAX_PIPS,
  showLabel = true,
}) {
  const safeValue = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  const filledCount = Math.min(Math.max(Math.round(safeValue), 0), maxValue);
  const pipColor = getPipColor(filledCount, maxValue);

  return (
    <View style={styles.row} accessibilityLabel={`${label}: ${filledCount} out of ${maxValue}`}>
      {showLabel ? (
        <ModeText variant="caption" tone="tertiary" style={styles.label} numberOfLines={1}>
          {label}
        </ModeText>
      ) : null}
      <View style={styles.pips}>
        {Array.from({ length: maxValue }, (_, i) => (
          <View
            key={i}
            style={[
              styles.pip,
              i < filledCount
                ? { backgroundColor: pipColor, opacity: 1 }
                : styles.pipEmpty,
            ]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
  },
  label: {
    width: 80,
    flexShrink: 0,
  },
  pips: {
    flexDirection: 'row',
    gap: 4,
    alignItems: 'center',
  },
  pip: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  pipEmpty: {
    backgroundColor: theme.colors.glass.borderDefault,
    opacity: 0.5,
  },
});
