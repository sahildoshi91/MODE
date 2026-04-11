import React from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';

import { theme } from '../../../../lib/theme';

export default function CoachComposer({
  value,
  onChangeText,
  onSend,
  disabled = false,
  onFocus,
}) {
  const hasDraft = typeof value === 'string' && value.trim().length > 0;
  const sendDisabled = disabled || !hasDraft;

  return (
    <View style={[styles.container, disabled && styles.containerDisabled]}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onFocus={onFocus}
        placeholder="Tell your coach what you need..."
        placeholderTextColor={theme.colors.text.tertiary}
        editable={!disabled}
        multiline
        style={styles.input}
        maxLength={1200}
        maxFontSizeMultiplier={1.1}
        textAlignVertical="top"
        autoCapitalize="sentences"
        autoCorrect
        blurOnSubmit={false}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={disabled ? 'Sending message' : 'Send message'}
        onPress={onSend}
        disabled={sendDisabled}
        hitSlop={10}
        style={({ pressed }) => [
          styles.sendButton,
          sendDisabled && styles.sendButtonDisabled,
          pressed && !sendDisabled && styles.sendButtonPressed,
        ]}
      >
        <Feather
          name="arrow-up"
          size={16}
          color={sendDisabled ? theme.colors.text.disabled : theme.colors.text.inverse}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    backgroundColor: theme.colors.surface.base,
    borderRadius: theme.radii.xl,
    borderWidth: 1,
    borderColor: theme.colors.border.soft,
    ...theme.shadows.soft,
  },
  containerDisabled: {
    opacity: 0.95,
  },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 112,
    color: theme.colors.text.primary,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.body1.fontSize,
    lineHeight: theme.typography.body1.lineHeight,
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[1],
  },
  sendButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
    backgroundColor: theme.colors.brand.progressCore,
  },
  sendButtonDisabled: {
    backgroundColor: theme.colors.surface.subtle,
    borderWidth: 1,
    borderColor: theme.colors.border.soft,
  },
  sendButtonPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.97 }],
  },
});
