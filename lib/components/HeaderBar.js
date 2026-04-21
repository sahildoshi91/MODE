import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Feather from '@expo/vector-icons/Feather';

import { theme } from '../theme';
import { GlassSurface } from './glass/GlassSurface';

const HEADER_SURFACE_BORDER = 'rgba(255, 255, 255, 0.05)';

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
      <View style={styles.headerShadowWrap}>
        <GlassSurface
          state="elevated"
          radius="l"
          padding={theme.spacing[2]}
          style={styles.headerSurface}
          contentStyle={styles.row}
          fillColor={theme.colors.surface.elevated}
          borderColor={HEADER_SURFACE_BORDER}
        >
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
        </GlassSurface>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    backgroundColor: 'transparent',
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[1],
    paddingHorizontal: theme.spacing[3],
  },
  headerShadowWrap: {
    borderRadius: theme.radii.l,
    ...theme.shadows.soft,
  },
  headerSurface: {
    marginBottom: 0,
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
    borderColor: theme.colors.glass.borderDefault,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface.base,
    flexShrink: 0,
    marginTop: 2,
  },
  backButtonPressed: {
    opacity: theme.interaction.pressedOpacity,
    transform: [{ scale: theme.interaction.pressedScale }],
  },
  copyWrap: {
    flex: 1,
  },
  title: {
    color: theme.colors.text.primary,
    ...theme.typography.h2,
    fontFamily: theme.typography.fontFamily,
    fontWeight: '700',
  },
  subtitle: {
    color: theme.colors.text.secondary,
    ...theme.typography.body2,
    marginTop: theme.spacing[1],
    fontFamily: theme.typography.fontFamily,
  },
});
