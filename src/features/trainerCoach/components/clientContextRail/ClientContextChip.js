import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';

import { ModeText } from '../../../../../lib/components';
import { theme } from '../../../../../lib/theme';
import { summarizeClientDisplay } from '../../services/coachClientContextApi';

export default function ClientContextChip({
  selectedClient,
  onPress,
  testID = 'client-context-chip',
}) {
  const label = selectedClient
    ? `Client: ${summarizeClientDisplay(selectedClient, { includeTodayPrefix: true })}`
    : 'Select client';

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.chip,
        pressed && styles.chipPressed,
      ]}
    >
      <View style={styles.leadingIconWrap}>
        <Feather
          name={selectedClient ? 'user-check' : 'user'}
          size={13}
          color={theme.colors.text.secondary}
        />
      </View>
      <ModeText
        variant="caption"
        tone={selectedClient ? 'primary' : 'secondary'}
        style={styles.label}
        numberOfLines={1}
      >
        {label}
      </ModeText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 40,
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    borderColor: theme.colors.glass.borderSoft,
    backgroundColor: 'rgba(9, 17, 30, 0.82)',
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing[1],
  },
  chipPressed: {
    opacity: theme.interaction.pressedOpacity,
  },
  leadingIconWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: theme.colors.glass.borderSoft,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    flex: 1,
    fontWeight: '600',
  },
});
