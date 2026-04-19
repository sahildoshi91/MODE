import React, { useMemo } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import Feather from '@expo/vector-icons/Feather';

import { ModeText } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';

const COMMANDS = [
  '/program',
  '/memory',
  '/flag',
  '/drafts',
  '/client',
  '/rules',
];

export default function CoachComposerWithCommands({
  value,
  onChangeText,
  onSubmit,
  onCommandSelect,
  disabled = false,
}) {
  const normalized = String(value || '').trim().toLowerCase();
  const commandSuggestions = useMemo(() => {
    if (!normalized.startsWith('/')) {
      return [];
    }
    return COMMANDS.filter((command) => command.startsWith(normalized)).slice(0, 5);
  }, [normalized]);
  const canSubmit = !disabled && normalized.length > 0;

  return (
    <View style={styles.wrapper}>
      {commandSuggestions.length > 0 ? (
        <View style={styles.commandsWrap}>
          {commandSuggestions.map((command) => (
            <Pressable
              key={command}
              onPress={() => onCommandSelect?.(command)}
              style={({ pressed }) => [
                styles.commandChip,
                pressed && styles.commandChipPressed,
              ]}
            >
              <ModeText variant="caption" tone="secondary">{command}</ModeText>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={styles.composer}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder="Ask coach or type / for commands"
          placeholderTextColor={theme.colors.text.tertiary}
          style={styles.input}
          multiline
          editable={!disabled}
          maxLength={1400}
          textAlignVertical="top"
        />
        <Pressable
          onPress={onSubmit}
          disabled={!canSubmit}
          style={({ pressed }) => [
            styles.sendButton,
            !canSubmit && styles.sendButtonDisabled,
            pressed && canSubmit && styles.sendButtonPressed,
          ]}
        >
          <Feather
            name="arrow-up"
            size={16}
            color={canSubmit ? theme.colors.text.inverse : theme.colors.text.disabled}
          />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: theme.spacing[1],
  },
  commandsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing[1],
  },
  commandChip: {
    borderRadius: theme.radii.pill,
    borderWidth: 1,
    borderColor: theme.colors.border.default,
    backgroundColor: theme.colors.surface.elevated,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 6,
  },
  commandChipPressed: {
    opacity: theme.interaction.pressedOpacity,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: theme.spacing[1],
    borderRadius: theme.radii.xl,
    borderWidth: 1,
    borderColor: theme.colors.border.default,
    backgroundColor: theme.colors.surface.elevated,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    fontSize: theme.typography.body1.fontSize,
    lineHeight: theme.typography.body1.lineHeight,
    color: theme.colors.text.primary,
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[1],
  },
  sendButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: theme.colors.cta.primaryBorder,
    backgroundColor: theme.colors.cta.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  sendButtonDisabled: {
    backgroundColor: theme.colors.surface.base,
    borderColor: theme.colors.border.subtle,
  },
  sendButtonPressed: {
    opacity: theme.interaction.pressedOpacity,
    transform: [{ scale: theme.interaction.pressedScale }],
  },
});

