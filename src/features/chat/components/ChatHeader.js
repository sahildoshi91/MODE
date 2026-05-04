import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { HeaderBar } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import ChatHistoryButton from './ChatHistoryButton';

function getDefaultTitle(role, readOnly) {
  if (readOnly) {
    return 'Chat History';
  }
  return role === 'trainer' ? 'Coach AI' : 'Coach';
}

export default function ChatHeader({
  role,
  title = null,
  subtitle = null,
  readOnly = false,
  onBack = null,
  onOpenHistory = null,
  onContinue = null,
  historyDisabled = false,
  testID = 'chat-header',
}) {
  const resolvedTitle = title || getDefaultTitle(role, readOnly);
  const rightSlot = readOnly && onContinue ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Continue this chat"
      onPress={onContinue}
      style={({ pressed }) => [
        styles.continueButton,
        pressed && styles.continueButtonPressed,
      ]}
    >
      <Text style={styles.continueText}>Continue</Text>
    </Pressable>
  ) : (
    onOpenHistory ? (
      <ChatHistoryButton onPress={onOpenHistory} disabled={historyDisabled} />
    ) : null
  );

  return (
    <HeaderBar
      testID={testID}
      title={resolvedTitle}
      subtitle={subtitle}
      rightSlot={rightSlot}
      onBack={onBack}
    />
  );
}

const styles = StyleSheet.create({
  continueButton: {
    minHeight: 36,
    borderRadius: 18,
    paddingHorizontal: theme.spacing[3],
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(143, 178, 255, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(143, 178, 255, 0.34)',
  },
  continueButtonPressed: {
    opacity: theme.interaction.pressedOpacity,
    transform: [{ scale: theme.interaction.pressedScale }],
  },
  continueText: {
    color: theme.colors.text.primary,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.body3.fontSize,
    lineHeight: theme.typography.body3.lineHeight,
    fontWeight: '700',
  },
});
