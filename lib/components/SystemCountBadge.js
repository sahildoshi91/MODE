import React from 'react';
import { StyleSheet, View } from 'react-native';

import { theme } from '../theme';
import { ModeText } from './ModeText';

const VARIANT_STYLES = {
  default: {
    backgroundColor: theme.colors.surface.elevated,
    borderColor: theme.colors.border.soft,
    textTone: 'secondary',
  },
  accent: {
    backgroundColor: theme.colors.nav.activeBg,
    borderColor: theme.colors.nav.activeBorder,
    textTone: 'accent',
  },
  warning: {
    backgroundColor: theme.colors.feedback.warningBg,
    borderColor: theme.colors.feedback.warningBorder,
    textTone: 'warning',
  },
  error: {
    backgroundColor: theme.colors.feedback.errorBg,
    borderColor: theme.colors.feedback.errorBorder,
    textTone: 'error',
  },
};

export function SystemCountBadge({
  value,
  variant = 'default',
  style,
}) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null;
  }

  const resolvedVariant = VARIANT_STYLES[variant] || VARIANT_STYLES.default;

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: resolvedVariant.backgroundColor,
          borderColor: resolvedVariant.borderColor,
        },
        style,
      ]}
    >
      <ModeText variant="caption" tone={resolvedVariant.textTone} style={styles.text}>
        {String(value)}
      </ModeText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    minWidth: 28,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontWeight: '700',
  },
});
