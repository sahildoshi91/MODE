import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { theme } from '../theme';
import { GlassSurface } from './glass/GlassSurface';

const VARIANT_STYLES = {
  primary: {
    fillColor: theme.colors.cta.primaryBg,
    borderColor: theme.colors.cta.primaryBorder,
    textColor: theme.colors.cta.primaryText,
    state: 'active',
  },
  secondary: {
    fillColor: theme.colors.cta.secondaryBg,
    borderColor: theme.colors.cta.secondaryBorder,
    textColor: theme.colors.cta.secondaryText,
    state: 'default',
  },
  ghost: {
    fillColor: 'rgba(0,0,0,0)',
    borderColor: theme.colors.cta.ghostBorder,
    textColor: theme.colors.cta.ghostText,
    state: 'muted',
  },
  destructive: {
    fillColor: theme.colors.cta.destructiveBg,
    borderColor: theme.colors.cta.destructiveBorder,
    textColor: theme.colors.cta.destructiveText,
    state: 'active',
  },
};

const SIZE_STYLES = {
  sm: {
    button: {
      minHeight: 40,
      paddingVertical: theme.spacing[1],
      paddingHorizontal: theme.spacing[2],
      borderRadius: theme.radii.s,
    },
    text: {
      fontSize: theme.typography.body2.fontSize,
      lineHeight: theme.typography.body2.lineHeight,
      fontWeight: '600',
      letterSpacing: 0.1,
    },
  },
  md: {
    button: {
      minHeight: 48,
      paddingVertical: theme.spacing[2],
      paddingHorizontal: theme.spacing[3],
      borderRadius: theme.radii.m,
    },
    text: {
      fontSize: theme.typography.button.fontSize,
      lineHeight: theme.typography.button.lineHeight,
      fontWeight: theme.typography.button.fontWeight,
      letterSpacing: theme.typography.button.letterSpacing,
    },
  },
  lg: {
    button: {
      minHeight: 56,
      paddingVertical: theme.spacing[3],
      paddingHorizontal: theme.spacing[4],
      borderRadius: theme.radii.m,
    },
    text: {
      fontSize: theme.typography.button.fontSize,
      lineHeight: theme.typography.button.lineHeight,
      fontWeight: theme.typography.button.fontWeight,
      letterSpacing: theme.typography.button.letterSpacing,
    },
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
        resolvedSize.button,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
        style,
      ]}
      android_ripple={{ color: theme.colors.accent.soft }}
    >
      <GlassSurface
        state={resolvedVariant.state}
        radius={resolvedSize.button.borderRadius}
        style={[
          styles.surface,
          {
            borderColor: resolvedVariant.borderColor,
            backgroundColor: resolvedVariant.fillColor,
          },
        ]}
        contentStyle={styles.surfaceContent}
        fillColor={resolvedVariant.fillColor}
        borderColor={resolvedVariant.borderColor}
        highlight={variant === 'primary' || variant === 'destructive'}
      >
        <Text
          style={[
            styles.text,
            resolvedSize.text,
            {
              color: resolvedVariant.textColor,
            },
            disabled && styles.textDisabled,
            textStyle,
          ]}
        >
          {title}
        </Text>
      </GlassSurface>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  base: {
    width: '100%',
  },
  surface: {
    width: '100%',
    minHeight: 40,
  },
  surfaceContent: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
  },
  disabled: {
    opacity: theme.interaction.disabledOpacity,
    shadowOpacity: 0,
    elevation: 0,
  },
  pressed: {
    transform: [{ scale: theme.interaction.pressedScale }],
    opacity: theme.interaction.pressedOpacity,
  },
  text: {
    fontFamily: theme.typography.fontFamily,
    textAlign: 'center',
    fontWeight: '600',
  },
  textDisabled: {
    color: theme.colors.text.disabled,
  },
});
