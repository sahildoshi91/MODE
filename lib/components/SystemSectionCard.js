import React from 'react';
import { StyleSheet, View } from 'react-native';

import { theme } from '../theme';

export function SystemSectionCard({
  children,
  style,
  testID,
}) {
  return (
    <View testID={testID} style={[styles.card, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: theme.radii.m,
    borderWidth: 1,
    borderColor: theme.colors.border.soft,
    backgroundColor: theme.colors.background.appAlt,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    gap: 6,
  },
});
