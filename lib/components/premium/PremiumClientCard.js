import React from 'react';
import { StyleSheet, View } from 'react-native';

import { theme } from '../../theme';
import { PremiumGlassCard } from './PremiumGlassCard';

export const PremiumClientCard = ({
  children,
  style,
  contentStyle,
  testID,
  onPress,
  disabled = false,
  emphasis = 'default',
}) => {
  const isFocus = emphasis === 'focus';

  return (
    <PremiumGlassCard
      testID={testID}
      variant={isFocus ? 'hero' : 'surface'}
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.card,
        isFocus && styles.focusCard,
        style,
      ]}
      contentStyle={[styles.content, contentStyle]}
    >
      <View style={styles.inner}>
        {children}
      </View>
    </PremiumGlassCard>
  );
};

const styles = StyleSheet.create({
  card: {
    marginBottom: theme.spacing[2],
  },
  focusCard: {
    shadowColor: theme.colors.accent.primary,
    shadowOpacity: 0.16,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 7 },
    elevation: 5,
  },
  content: {
    padding: theme.spacing[3],
  },
  inner: {
    gap: theme.spacing[2],
  },
});

