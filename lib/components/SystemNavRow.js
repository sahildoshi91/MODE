import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';

import { theme } from '../theme';
import { ModeText } from './ModeText';
import { SystemCountBadge } from './SystemCountBadge';

export function SystemNavRow({
  icon = 'circle',
  title,
  subtitle = null,
  badge = null,
  badgeVariant = 'default',
  onPress,
  testID,
  style,
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.row,
        pressed && styles.rowPressed,
        style,
      ]}
    >
      <View style={styles.leadingIconWrap}>
        <Feather name={icon} size={16} color={theme.colors.text.secondary} />
      </View>

      <View style={styles.copyWrap}>
        <ModeText variant="bodySm" style={styles.title}>
          {title}
        </ModeText>
        {subtitle ? (
          <ModeText variant="caption" tone="secondary" numberOfLines={1}>
            {subtitle}
          </ModeText>
        ) : null}
      </View>

      <View style={styles.trailingWrap}>
        <SystemCountBadge value={badge} variant={badgeVariant} />
        <Feather name="chevron-right" size={16} color={theme.colors.text.tertiary} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
    borderRadius: theme.radii.s,
    paddingHorizontal: theme.spacing[1] + 4,
    paddingVertical: 10,
  },
  rowPressed: {
    backgroundColor: theme.colors.surface.elevated,
  },
  leadingIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: theme.colors.border.soft,
    backgroundColor: theme.colors.surface.base,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copyWrap: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontWeight: '600',
  },
  trailingWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    minWidth: 42,
  },
});
