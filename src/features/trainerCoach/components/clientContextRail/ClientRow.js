import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ModeText } from '../../../../../lib/components';
import { theme } from '../../../../../lib/theme';

function formatContext(client) {
  if (client?.isToday && client?.nextSessionTime) {
    const timeLabel = new Date(client.nextSessionTime).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });
    const location = client?.sessionLocation ? ` | ${client.sessionLocation}` : '';
    return `Today ${timeLabel}${location}`;
  }
  if (client?.isToday) {
    return 'Today';
  }
  if (client?.nextSessionTime) {
    const timeLabel = new Date(client.nextSessionTime).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });
    return `Upcoming ${timeLabel}`;
  }
  return 'No upcoming session';
}

export default function ClientRow({
  client,
  selected = false,
  onPress,
  testID,
}) {
  if (!client) {
    return null;
  }
  const microContext = formatContext(client);
  const accessibilityLabel = selected
    ? `${client.name}, selected. ${microContext}`
    : `${client.name}. ${microContext}`;

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        styles.row,
        selected && styles.selectedRow,
        pressed && styles.rowPressed,
      ]}
    >
      <View style={[styles.avatarWrap, selected && styles.avatarWrapSelected]}>
        <ModeText variant="caption" tone={selected ? 'primary' : 'secondary'} style={styles.avatarText}>
          {client.initials || 'C'}
        </ModeText>
      </View>
      <View style={styles.copyWrap}>
        <ModeText variant="bodySm" numberOfLines={1} style={styles.nameLabel}>{client.name}</ModeText>
        <ModeText variant="caption" tone="secondary" numberOfLines={1}>{microContext}</ModeText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 48,
    borderRadius: theme.radii.l,
    borderWidth: 1,
    borderColor: theme.colors.glass.borderSoft,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[2],
  },
  rowPressed: {
    opacity: theme.interaction.pressedOpacity,
  },
  selectedRow: {
    borderColor: theme.colors.nav.activeBorder,
    backgroundColor: theme.colors.nav.activeBg,
  },
  avatarWrap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: theme.colors.glass.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  avatarWrapSelected: {
    borderColor: theme.colors.nav.activeBorder,
  },
  avatarText: {
    fontWeight: '700',
  },
  copyWrap: {
    flex: 1,
    gap: 2,
  },
  nameLabel: {
    fontWeight: '600',
  },
});
