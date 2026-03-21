import React from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { theme } from '../theme';

export const ModeButton = ({ variant = 'primary', disabled = false, title, onPress, style, testID }) => {
  const themeStyle = variant === 'secondary' ? styles.secondary : styles.primary;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.base,
        themeStyle,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
        style,
      ]}
      android_ripple={{ color: 'rgba(255,255,255,0.12)' }}
    >
      <Text style={[styles.text, disabled && styles.textDisabled]}>{title}</Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  base: {
    borderRadius: theme.radii.m,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 12,
    elevation: 4,
  },
  primary: {
    backgroundColor: theme.colors.primary,
  },
  secondary: {
    backgroundColor: theme.colors.surfaceSoft,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  disabled: {
    backgroundColor: theme.colors.surface,
    opacity: 0.6,
    shadowOpacity: 0,
  },
  pressed: {
    transform: [{ scale: 0.98 }],
    opacity: 0.92,
  },
  text: {
    color: theme.colors.onPrimary,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.button.fontSize,
    lineHeight: theme.typography.button.lineHeight,
    fontWeight: theme.typography.button.fontWeight,
  },
  textDisabled: {
    color: theme.colors.textDisabled,
  },
});
