import React from 'react';
import { StyleSheet, View } from 'react-native';

import {
  GlassSurface,
  ModeText,
} from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import { useStreamingMessage } from '../../chat/hooks/useStreamingMessage';

export default function AlgorithmSummaryCard({
  summaryText,
  animate = true,
  testID = 'algorithm-summary-card',
  textTestID = `${testID}-text`,
  label = null,
  accentColor = theme.colors.accent.primary,
  fillColor,
  borderColor,
  onPress,
  headerTrailing = null,
  children = null,
  accessibilityLabel,
  style,
}) {
  const text = String(summaryText || '').trim();
  const {
    displayedText,
    reducedMotion,
  } = useStreamingMessage({
    text,
    enabled: animate,
    speed: 44,
  });
  const visibleText = reducedMotion || !animate ? text : displayedText;

  return (
    <GlassSurface
      testID={testID}
      state="hero"
      radius="xl"
      padding={theme.spacing[4]}
      style={[styles.card, style]}
      contentStyle={styles.content}
      fillColor={fillColor}
      borderColor={borderColor}
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      highlight
      cornerGlow
    >
      {label || headerTrailing ? (
        <View style={styles.headerRow}>
          {label ? (
            <ModeText variant="label" style={[styles.label, { color: accentColor }]}>
              {label}
            </ModeText>
          ) : <View />}
          {headerTrailing}
        </View>
      ) : null}
      {children || (
        <ModeText testID={textTestID} variant="bodySm" style={styles.summary}>
          {visibleText || ' '}
        </ModeText>
      )}
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    marginTop: theme.spacing[2],
  },
  content: {
    gap: theme.spacing[2],
  },
  headerRow: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[2],
  },
  label: {
    textTransform: 'uppercase',
    letterSpacing: 0,
    flexShrink: 1,
  },
  summary: {
    color: theme.colors.text.primary,
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 22,
    letterSpacing: 0,
  },
});
