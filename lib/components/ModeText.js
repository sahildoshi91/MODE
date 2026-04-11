import React from 'react';
import { Text, StyleSheet } from 'react-native';

import { theme } from '../theme';

const TEXT_VARIANTS = {
  display: theme.typography.display,
  h1: theme.typography.h1,
  h2: theme.typography.h2,
  h3: theme.typography.h3,
  body: theme.typography.body1,
  bodySm: theme.typography.body2,
  caption: theme.typography.body3,
  label: theme.typography.label,
};

const TONES = {
  primary: theme.colors.text.primary,
  secondary: theme.colors.text.secondary,
  tertiary: theme.colors.text.tertiary,
  inverse: theme.colors.text.inverse,
  success: theme.colors.status.success,
  warning: theme.colors.status.warning,
  error: theme.colors.status.error,
  accent: theme.colors.brand.progressCore,
};

export const ModeText = ({
  variant = 'body',
  tone = 'primary',
  style,
  children,
  numberOfLines,
  testID,
}) => {
  const textVariant = TEXT_VARIANTS[variant] || TEXT_VARIANTS.body;
  const textTone = TONES[tone] || TONES.primary;

  return (
    <Text
      testID={testID}
      numberOfLines={numberOfLines}
      style={[
        styles.base,
        textVariant,
        { color: textTone },
        style,
      ]}
    >
      {children}
    </Text>
  );
};

const styles = StyleSheet.create({
  base: {
    fontFamily: theme.typography.fontFamily,
  },
});
