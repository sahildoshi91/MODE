import React from 'react';
import { StyleSheet, Text } from 'react-native';

import { theme } from '../../../../lib/theme';
import { GlassSurface } from '../../../../lib/components/glass';

export default function TypingIndicator({
  text = 'Coach is thinking…',
}) {
  return (
    <GlassSurface state="default" radius={20} style={styles.wrap} contentStyle={styles.content}>
      <Text style={styles.text}>{text}</Text>
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'flex-start',
  },
  content: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1] + 1,
    marginBottom: theme.spacing[1],
  },
  text: {
    color: theme.colors.text.secondary,
    ...theme.typography.body3,
    fontFamily: theme.typography.fontFamily,
  },
});
