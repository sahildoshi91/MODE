import React from 'react';
import { StyleSheet, View } from 'react-native';

import { theme } from '../theme';
import { ModeText } from './ModeText';
import { GlassPill } from './glass/GlassControls';

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
      <GlassPill
        testID={testID}
        label={label}
        selected={selected}
        style={style}
      />
    );
  }

  return (
    <GlassPill
      testID={testID}
      label={label}
      selected={selected}
      onPress={onPress}
      style={style}
      textStyle={styles.label}
    />
  );
};

const LegacyStaticChip = ({ label, selected, style, testID }) => {
  return (
    <View testID={testID} style={[styles.chipLegacy, selected && styles.chipLegacySelected, style]}>
      <ModeText variant="caption" tone={selected ? 'inverse' : 'secondary'} style={styles.label}>
        {label}
      </ModeText>
    </View>
  );
};

export const ModeChipLegacy = LegacyStaticChip;

const styles = StyleSheet.create({
  chipLegacy: {
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    borderColor: theme.colors.border.default,
    backgroundColor: theme.colors.surface.elevated,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    minHeight: 32,
    justifyContent: 'center',
  },
  chipLegacySelected: {
    borderColor: theme.colors.accent.primary,
    backgroundColor: theme.colors.accent.primary,
  },
  label: {
    fontWeight: '600',
    textAlign: 'center',
  },
});
