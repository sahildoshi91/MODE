import React from 'react';
import { StyleSheet, View } from 'react-native';

import { theme } from '../theme';
import { ModeText } from './ModeText';

export function SystemSectionHeader({
  title,
  trailing = null,
  style,
}) {
  return (
    <View style={[styles.row, style]}>
      <ModeText variant="label" tone="tertiary" style={styles.title}>
        {title}
      </ModeText>
      {trailing}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[2],
  },
  title: {
    textTransform: 'uppercase',
    letterSpacing: 0.72,
  },
});
