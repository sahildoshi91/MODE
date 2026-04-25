import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import Feather from '@expo/vector-icons/Feather';
import { LinearGradient } from 'expo-linear-gradient';

import { ModeText } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';
import { resolveAssistantDisplayName } from '../../messaging';

const COMPOSER_SURFACE_BORDER = 'rgba(255, 255, 255, 0.05)';
const COMPOSER_SURFACE_BASE = 'rgba(13, 22, 38, 0.86)';
const COMPOSER_SURFACE_FOCUSED_BORDER = 'rgba(143, 178, 255, 0.4)';
const COMPOSER_PLACEHOLDER = 'rgba(199, 214, 243, 0.74)';

const COMMANDS = [
  '/client',
  '/note',
];

export default function CoachComposerWithCommands({
  value,
  onChangeText,
  onSubmit,
  onCommandSelect,
  assistantDisplayName,
  disabled = false,
  isSubmitting = false,
}) {
  const resolvedAssistantDisplayName = useMemo(
    () => resolveAssistantDisplayName(assistantDisplayName),
    [assistantDisplayName],
  );
  const [isFocused, setIsFocused] = useState(false);
  const normalized = String(value || '').trim().toLowerCase();
  const commandSuggestions = useMemo(() => {
    if (!normalized.startsWith('/')) {
      return [];
    }
    return COMMANDS.filter((command) => command.startsWith(normalized)).slice(0, 5);
  }, [normalized]);
  const canSubmit = !disabled && !isSubmitting && normalized.length > 0;
  const sendButtonGradientColors = canSubmit
    ? [
      'rgba(250, 253, 255, 0.24)',
      'rgba(173, 205, 255, 0.10)',
      'rgba(18, 35, 62, 0.30)',
    ]
    : [
      'rgba(246, 251, 255, 0.11)',
      'rgba(246, 251, 255, 0.03)',
      'rgba(9, 18, 32, 0.20)',
    ];
  const sendButtonTopLight = canSubmit
    ? 'rgba(251, 254, 255, 0.28)'
    : 'rgba(247, 251, 255, 0.14)';

  return (
    <View style={styles.wrapper}>
      {commandSuggestions.length > 0 ? (
        <View style={styles.commandsWrap}>
          {commandSuggestions.map((command) => (
            <Pressable
              key={command}
              onPress={() => {
                if (disabled || isSubmitting) {
                  return;
                }
                onCommandSelect?.(command);
              }}
              disabled={disabled || isSubmitting}
              style={({ pressed }) => [
                styles.commandChip,
                (disabled || isSubmitting) && styles.commandChipDisabled,
                pressed && styles.commandChipPressed,
              ]}
            >
              <LinearGradient
                pointerEvents="none"
                colors={[
                  'rgba(241, 248, 255, 0.1)',
                  'rgba(241, 248, 255, 0.02)',
                  'rgba(7, 13, 24, 0.26)',
                ]}
                locations={[0, 0.52, 1]}
                start={{ x: 0.5, y: 0 }}
                end={{ x: 0.5, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
              <View pointerEvents="none" style={styles.commandChipTopLight} />
              <ModeText variant="caption" tone="secondary" style={styles.commandChipText}>
                {command}
              </ModeText>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View style={styles.composerShadowWrap}>
        <View
          style={[
            styles.composerSurface,
            isFocused && styles.composerSurfaceFocused,
          ]}
        >
          <LinearGradient
            pointerEvents="none"
            colors={[
              'rgba(244, 250, 255, 0.065)',
              'rgba(166, 198, 246, 0.025)',
              'rgba(5, 10, 19, 0.24)',
            ]}
            locations={[0.12, 0.56, 1]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View pointerEvents="none" style={styles.composerSeparator} />
          <LinearGradient
            pointerEvents="none"
            colors={[
              'rgba(255, 255, 255, 0)',
              'rgba(248, 252, 255, 0.12)',
              'rgba(255, 255, 255, 0)',
            ]}
            locations={[0, 0.52, 1]}
            start={{ x: 0, y: 0.3 }}
            end={{ x: 1, y: 0.9 }}
            style={styles.composerAmbientLight}
          />
          <LinearGradient
            pointerEvents="none"
            colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0)', 'rgba(6, 12, 22, 0.24)']}
            locations={[0, 0.56, 1]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={styles.composerLowerDepth}
          />
          <TextInput
            value={value}
            onChangeText={onChangeText}
            placeholder={`Message ${resolvedAssistantDisplayName} or type / for commands`}
            placeholderTextColor={COMPOSER_PLACEHOLDER}
            style={styles.input}
            multiline
            editable={!disabled && !isSubmitting}
            maxLength={1400}
            textAlignVertical="top"
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            selectionColor={theme.colors.accent.primary}
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
            <LinearGradient
              pointerEvents="none"
              colors={sendButtonGradientColors}
              locations={[0, 0.52, 1]}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <View
              pointerEvents="none"
              style={[
                styles.sendButtonTopLight,
                {
                  backgroundColor: sendButtonTopLight,
                },
              ]}
            />
            {isSubmitting ? (
              <ActivityIndicator
                size="small"
                color={theme.colors.text.inverse}
                style={styles.sendButtonIcon}
              />
            ) : (
              <Feather
                name="arrow-up"
                size={16}
                color={canSubmit ? theme.colors.text.inverse : theme.colors.text.disabled}
                style={styles.sendButtonIcon}
              />
            )}
          </Pressable>
        </View>
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
    borderColor: 'rgba(220, 236, 255, 0.18)',
    backgroundColor: 'rgba(10, 19, 33, 0.82)',
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 5,
    overflow: 'hidden',
  },
  commandChipTopLight: {
    position: 'absolute',
    left: 8,
    right: 8,
    top: 2,
    height: 1,
    borderRadius: 1,
    backgroundColor: 'rgba(248, 252, 255, 0.16)',
  },
  commandChipText: {
    zIndex: 2,
    fontWeight: '600',
  },
  commandChipPressed: {
    opacity: theme.interaction.pressedOpacity,
  },
  commandChipDisabled: {
    opacity: theme.interaction.disabledOpacity,
  },
  composerShadowWrap: {
    borderRadius: theme.radii.xl,
    shadowColor: '#020A14',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 18,
    elevation: 6,
  },
  composerSurface: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: theme.spacing[1],
    borderRadius: theme.radii.xl,
    backgroundColor: COMPOSER_SURFACE_BASE,
    borderWidth: 1,
    borderColor: COMPOSER_SURFACE_BORDER,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    overflow: 'hidden',
  },
  composerSurfaceFocused: {
    borderColor: COMPOSER_SURFACE_FOCUSED_BORDER,
  },
  composerSeparator: {
    position: 'absolute',
    left: theme.spacing[2],
    right: theme.spacing[2],
    top: 0,
    height: 1,
    backgroundColor: 'rgba(232, 243, 255, 0.11)',
  },
  composerAmbientLight: {
    position: 'absolute',
    left: 10,
    right: 10,
    top: 7,
    height: 44,
    borderRadius: 20,
  },
  composerLowerDepth: {
    ...StyleSheet.absoluteFillObject,
  },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 120,
    fontSize: theme.typography.body1.fontSize,
    lineHeight: theme.typography.body1.lineHeight,
    color: 'rgba(235, 243, 255, 0.96)',
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[1],
  },
  sendButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: theme.colors.cta.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
    overflow: 'hidden',
  },
  sendButtonDisabled: {
    backgroundColor: theme.colors.surface.base,
  },
  sendButtonTopLight: {
    position: 'absolute',
    left: 5,
    right: 5,
    top: 2,
    height: 1,
    borderRadius: 1,
  },
  sendButtonIcon: {
    zIndex: 2,
  },
  sendButtonPressed: {
    opacity: theme.interaction.pressedOpacity,
    transform: [{ scale: theme.interaction.pressedScale }],
  },
});
