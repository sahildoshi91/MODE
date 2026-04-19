import React from 'react';
import { StyleSheet, Text } from 'react-native';

import { theme } from '../../theme';
import { GlassSurface } from '../glass/GlassSurface';

export const PremiumChip = ({
  label,
  selected = false,
  disabled = false,
  onPress,
  style,
  textStyle,
  testID,
}) => {
  const isInteractive = typeof onPress === 'function';

  return (
    <GlassSurface
      testID={testID}
      state={selected ? 'active' : 'default'}
      radius={theme.radii.m}
      padding={0}
      disabled={disabled}
      onPress={isInteractive ? onPress : undefined}
      highlight={selected}
      style={[
        styles.chip,
        selected && styles.selectedChip,
        disabled && styles.disabledChip,
        style,
      ]}
      contentStyle={styles.content}
      fillColor={selected ? theme.colors.nav.activeBg : theme.colors.glass.base}
      borderColor={selected ? theme.colors.nav.activeBorder : theme.colors.glass.borderSoft}
    >
      <Text
        style={[
          styles.label,
          selected ? styles.selectedLabel : styles.idleLabel,
          disabled && styles.disabledLabel,
          textStyle,
        ]}
      >
        {label}
      </Text>
    </GlassSurface>
  );
};

const styles = StyleSheet.create({
  chip: {
    minHeight: 36,
    minWidth: 44,
  },
  content: {
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedChip: {
    shadowColor: theme.colors.accent.primary,
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },
  disabledChip: {
    opacity: theme.interaction.disabledOpacity,
  },
  label: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.body3.fontSize,
    lineHeight: theme.typography.body3.lineHeight,
    fontWeight: '600',
    textAlign: 'center',
  },
  idleLabel: {
    color: theme.colors.text.secondary,
  },
  selectedLabel: {
    color: theme.colors.text.primary,
    fontWeight: '700',
  },
  disabledLabel: {
    color: theme.colors.text.disabled,
  },
});

