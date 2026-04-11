import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { theme } from '../theme';
import { ModeText } from './ModeText';

export const ModeChip = ({
  label,
  selected = false,
  onPress,
  style,
  testID,
}) => {
  const isInteractive = typeof onPress === 'function';

  if (!isInteractive) {
    return (
      <View testID={testID} style={[styles.chip, selected && styles.chipSelected, style]}>
        <ModeText variant="caption" tone={selected ? 'inverse' : 'secondary'} style={styles.label}>
          {label}
        </ModeText>
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        selected && styles.chipSelected,
        pressed && styles.chipPressed,
        style,
      ]}
    >
      <ModeText variant="caption" tone={selected ? 'inverse' : 'secondary'} style={styles.label}>
        {label}
      </ModeText>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  chip: {
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    borderColor: theme.colors.border.soft,
    backgroundColor: theme.colors.surface.subtle,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    minHeight: 32,
    justifyContent: 'center',
  },
  chipSelected: {
    borderColor: theme.colors.brand.progressCore,
    backgroundColor: theme.colors.brand.progressCore,
  },
  chipPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.98 }],
  },
  label: {
    fontWeight: '600',
    textAlign: 'center',
  },
});
