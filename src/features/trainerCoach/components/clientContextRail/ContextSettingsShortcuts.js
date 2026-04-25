import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';

import { ModeText } from '../../../../../lib/components';
import { theme } from '../../../../../lib/theme';

const SHORTCUTS = [
  {
    key: 'advanced_ai_context',
    title: 'Advanced AI Context',
    description: 'Review memory usage and context preview.',
  },
  {
    key: 'schedule_preferences',
    title: 'Schedule Preferences',
    description: 'Set recurring days and timing defaults.',
  },
  {
    key: 'client_details',
    title: 'Client Details',
    description: 'Open profile and recent status details.',
  },
];

export default function ContextSettingsShortcuts({
  onOpen,
  testIDPrefix = 'client-context-settings',
}) {
  return (
    <View style={styles.root}>
      <ModeText variant="bodySm" style={styles.title}>Settings</ModeText>
      <View style={styles.list}>
        {SHORTCUTS.map((item) => (
          <Pressable
            key={item.key}
            testID={`${testIDPrefix}-${item.key}`}
            accessibilityRole="button"
            accessibilityLabel={item.title}
            onPress={() => onOpen?.(item.key)}
            style={({ pressed }) => [
              styles.row,
              pressed && styles.rowPressed,
            ]}
          >
            <View style={styles.copyWrap}>
              <ModeText variant="bodySm" style={styles.rowTitle}>{item.title}</ModeText>
              <ModeText variant="caption" tone="secondary" numberOfLines={1}>{item.description}</ModeText>
            </View>
            <Feather name="chevron-right" size={16} color={theme.colors.text.secondary} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: theme.spacing[1],
  },
  title: {
    fontWeight: '700',
  },
  list: {
    gap: theme.spacing[1],
  },
  row: {
    minHeight: 48,
    borderRadius: theme.radii.l,
    borderWidth: 1,
    borderColor: theme.colors.glass.borderSoft,
    backgroundColor: 'rgba(255,255,255,0.03)',
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing[2],
  },
  rowPressed: {
    opacity: theme.interaction.pressedOpacity,
  },
  copyWrap: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontWeight: '600',
  },
});
