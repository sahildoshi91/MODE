import React from 'react';
import { StyleSheet } from 'react-native';

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
      style={styles.card}
      contentStyle={styles.content}
      highlight
      cornerGlow
    >
      <ModeText testID={`${testID}-text`} variant="h2" style={styles.summary}>
        {visibleText || ' '}
      </ModeText>
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    marginTop: theme.spacing[2],
  },
  content: {
    gap: 0,
  },
  summary: {
    color: theme.colors.text.primary,
    lineHeight: 32,
    letterSpacing: 0,
  },
});
