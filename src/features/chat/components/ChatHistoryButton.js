import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { History } from 'lucide-react-native';

import { theme } from '../../../../lib/theme';

export default function ChatHistoryButton({
  onPress,
  disabled = false,
  testID = 'chat-history-button',
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel="Open chat history"
      disabled={disabled}
      hitSlop={10}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <History size={20} color={theme.colors.text.primary} strokeWidth={2.2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
    borderWidth: 1,
    borderColor: 'rgba(214, 230, 255, 0.16)',
  },
  pressed: {
    opacity: theme.interaction.pressedOpacity,
    transform: [{ scale: theme.interaction.pressedScale }],
  },
  disabled: {
    opacity: theme.interaction.disabledOpacity,
  },
});
