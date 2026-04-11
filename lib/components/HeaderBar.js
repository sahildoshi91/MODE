import React from 'react';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from '@expo/vector-icons/Feather';

import { theme } from '../theme';

export const HeaderBar = ({
  title,
  subtitle,
  style,
  testID,
  rightSlot = null,
  onBack = null,
  backAccessibilityLabel = 'Go back',
}) => {
  return (
    <SafeAreaView
      testID={testID}
      style={[
        styles.container,
        style,
      ]}
      edges={['top']}
    >
      <View style={styles.row}>
        {onBack ? (
          <Pressable
            accessibilityLabel={backAccessibilityLabel}
            accessibilityRole="button"
            hitSlop={10}
            onPress={onBack}
            style={({ pressed }) => [
              styles.backButton,
              pressed && styles.backButtonPressed,
            ]}
          >
            <Feather name="arrow-left" size={18} color={theme.colors.text.primary} />
          </Pressable>
        ) : null}
        <View style={styles.copyWrap}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {rightSlot}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    backgroundColor: theme.colors.surface.canvas,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.divider,
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[2],
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: theme.colors.border.soft,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface.raised,
    flexShrink: 0,
    marginTop: 2,
  },
  backButtonPressed: {
    opacity: 0.78,
  },
  copyWrap: {
    flex: 1,
  },
  title: {
    color: theme.colors.text.primary,
    ...theme.typography.h2,
    fontFamily: theme.typography.fontFamily,
  },
  subtitle: {
    color: theme.colors.text.secondary,
    ...theme.typography.body2,
    marginTop: theme.spacing[1],
    fontFamily: theme.typography.fontFamily,
  },
});
