import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ModeText } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import ChatHistoryButton from './ChatHistoryButton';

function getDefaultTitle(role, readOnly) {
  if (readOnly) {
    return 'Chat history';
  }
  return role === 'trainer' ? 'Coach AI' : 'Coach';
}

export default function ChatHeader({
  role,
  title = null,
  subtitle = null,
  readOnly = false,
  isError = false,
  onBack = null,
  onOpenHistory = null,
  onContinue = null,
  onRetry = null,
  historyDisabled = false,
  testID = 'chat-header',
}) {
  const insets = useSafeAreaInsets();
  const resolvedTitle = title || getDefaultTitle(role, readOnly);

  const showStatusDot = !readOnly && role !== 'trainer';

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
      <ModeText variant="body3" style={styles.continueText}>Continue</ModeText>
    </Pressable>
  ) : (
    onOpenHistory ? (
      <ChatHistoryButton onPress={onOpenHistory} disabled={historyDisabled} />
    ) : null
  );

  return (
    <View testID={testID} style={[styles.header, { paddingTop: insets.top + theme.spacing[1] }]}>
      {onBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={onBack}
          style={({ pressed }) => [
            styles.backButton,
            pressed && styles.backButtonPressed,
          ]}
        >
          <ModeText style={styles.backChevron}>‹</ModeText>
        </Pressable>
      ) : (
        <View style={styles.backPlaceholder} />
      )}

      <View style={styles.titleBlock}>
        <ModeText style={styles.titleText} numberOfLines={1}>
          {resolvedTitle}
        </ModeText>
        {showStatusDot ? (
          <View style={styles.statusRow}>
            <View style={[
              styles.statusDot,
              isError ? styles.statusDotError : styles.statusDotOnline,
            ]} />
            <ModeText style={[
              styles.statusText,
              isError ? styles.statusTextError : styles.statusTextOnline,
            ]}>
              {isError ? 'not connected' : 'online'}
            </ModeText>
          </View>
        ) : subtitle ? (
          <ModeText style={styles.subtitleText} numberOfLines={1}>
            {subtitle}
          </ModeText>
        ) : null}
      </View>

      <View style={styles.rightSlot}>
        {rightSlot}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing[2],
    paddingBottom: theme.spacing[2],
    gap: theme.spacing[1],
  },
  backButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
  },
  backButtonPressed: {
    opacity: theme.interaction.pressedOpacity,
  },
  backChevron: {
    color: theme.colors.accent.primary,
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '300',
  },
  backPlaceholder: {
    width: 36,
  },
  titleBlock: {
    flex: 1,
    gap: 2,
  },
  titleText: {
    color: theme.colors.text.primary,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0,
    fontFamily: theme.typography.fontFamily,
  },
  subtitleText: {
    color: theme.colors.text.tertiary,
    fontSize: 11,
    fontWeight: '400',
    fontFamily: theme.typography.fontFamily,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusDotOnline: {
    backgroundColor: theme.colors.status.success,
  },
  statusDotError: {
    backgroundColor: theme.colors.status.error,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '500',
    fontFamily: theme.typography.fontFamily,
  },
  statusTextOnline: {
    color: theme.colors.status.success,
  },
  statusTextError: {
    color: theme.colors.status.error,
  },
  rightSlot: {
    width: 36,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  continueButton: {
    minHeight: 32,
    borderRadius: 16,
    paddingHorizontal: theme.spacing[2],
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(143,178,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(143,178,255,0.34)',
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
