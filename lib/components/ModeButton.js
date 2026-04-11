import React from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';

import { theme } from '../theme';

const VARIANT_STYLES = {
  primary: {
    backgroundColor: theme.colors.brand.progressCore,
    borderColor: theme.colors.brand.progressCore,
    textColor: theme.colors.text.inverse,
  },
  secondary: {
    backgroundColor: theme.colors.surface.subtle,
    borderColor: theme.colors.border.soft,
    textColor: theme.colors.text.primary,
  },
  ghost: {
    backgroundColor: 'transparent',
    borderColor: theme.colors.border.soft,
    textColor: theme.colors.brand.progressDeep,
  },
  destructive: {
    backgroundColor: theme.colors.emotional.dustyRose,
    borderColor: theme.colors.emotional.dustyRose,
    textColor: theme.colors.text.inverse,
  },
};

const SIZE_STYLES = {
  md: {
    minHeight: 48,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
  },
  lg: {
    minHeight: 56,
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
};

export const ModeButton = ({
  variant = 'primary',
  size = 'md',
  disabled = false,
  title,
  onPress,
  style,
  textStyle,
  testID,
}) => {
  const resolvedVariant = VARIANT_STYLES[variant] || VARIANT_STYLES.primary;
  const resolvedSize = SIZE_STYLES[size] || SIZE_STYLES.md;

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.base,
        resolvedSize,
        {
          backgroundColor: resolvedVariant.backgroundColor,
          borderColor: resolvedVariant.borderColor,
        },
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
        style,
      ]}
      android_ripple={{ color: 'rgba(31, 61, 54, 0.08)' }}
    >
      <Text
        style={[
          styles.text,
          {
            color: resolvedVariant.textColor,
          },
          disabled && styles.textDisabled,
          textStyle,
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  base: {
    borderRadius: theme.radii.m,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    ...theme.shadows.soft,
  },
  disabled: {
    opacity: 0.55,
    shadowOpacity: 0,
    elevation: 0,
  },
  pressed: {
    transform: [{ scale: 0.985 }],
    opacity: 0.92,
  },
  text: {
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.button.fontSize,
    lineHeight: theme.typography.button.lineHeight,
    fontWeight: theme.typography.button.fontWeight,
    textAlign: 'center',
  },
  textDisabled: {
    color: theme.colors.text.disabled,
  },
});
