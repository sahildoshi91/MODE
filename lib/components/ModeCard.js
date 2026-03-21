import React from 'react';
import { View, StyleSheet } from 'react-native';
import { theme } from '../theme';

export const ModeCard = ({ children, style, testID }) => {
  return (
    <View testID={testID} style={[styles.card, style]}>{children}</View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.l,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing[3],
    marginBottom: theme.spacing[2],
    ...theme.shadows.soft,
  },
});
