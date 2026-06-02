import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';

import { ModeText } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import { METRIC_CONFIG } from '../config/metricConfig';

export function MetricRow({ dimensionKey, dimension, onPress }) {
  const config = METRIC_CONFIG[dimensionKey];
  if (!config || !dimension) {
    return null;
  }

  const hasInsight = dimension.coach_insight_triggered;

  const valueColor = dimension.status === 'flagged'
    ? theme.colors.status.error
    : dimension.status === 'watch'
      ? theme.colors.status.warning
      : theme.colors.text.primary;

  return (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      activeOpacity={0.72}
      hitSlop={{ top: 4, bottom: 4, left: 0, right: 0 }}
      accessibilityRole="button"
      accessibilityLabel={`${config.label}: ${dimension.surface_value}, status ${dimension.status}`}
      accessibilityHint="Tap for details"
    >
      <View style={styles.left}>
        <View style={[styles.iconWrap, { backgroundColor: config.iconBg }]}>
          <Feather name={config.icon} size={16} color={config.iconColor} />
        </View>
        <View style={styles.labelBlock}>
          <View style={styles.labelRow}>
            <ModeText variant="body2" tone="primary" style={styles.label}>
              {config.label}
            </ModeText>
            {hasInsight ? (
              <View style={styles.insightDot} />
            ) : null}
          </View>
          <ModeText variant="caption" tone="tertiary">
            {config.subtitle}
          </ModeText>
        </View>
      </View>

      <View style={styles.right}>
        <View style={styles.valueBlock}>
          <ModeText variant="body1" tone="primary" style={[styles.value, { color: valueColor }]}>
            {dimension.surface_value}
          </ModeText>
          <ModeText variant="caption" tone="tertiary" style={styles.trendLabel}>
            {dimension.trend_label}
          </ModeText>
        </View>
        <ModeText variant="body2" tone="tertiary" style={styles.chevronText}>›</ModeText>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    minHeight: 64,
  },
  left: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  labelBlock: {
    flex: 1,
    gap: 2,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  label: {
    fontWeight: '500',
  },
  insightDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: theme.colors.accent.primary,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[1],
  },
  valueBlock: {
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 1,
    minWidth: 56,
  },
  value: {
    fontWeight: '600',
  },
  trendLabel: {
    textAlign: 'right',
  },
  chevronText: {
    fontSize: 18,
    lineHeight: 22,
    marginLeft: 2,
  },
});
