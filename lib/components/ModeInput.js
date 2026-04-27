import React, { forwardRef, useCallback, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { theme } from '../theme';
import { GlassSurface } from './glass/GlassSurface';

export const ModeInput = forwardRef(function ModeInput({
  value,
  onChangeText,
  placeholder,
  secureTextEntry = false,
  keyboardType = 'default',
  editable = true,
  style,
  inputStyle,
  testID,
  multiline = false,
  maxLength,
  onFocus,
  onBlur,
  onSubmitEditing,
  returnKeyType,
  blurOnSubmit,
  autoFocus = false,
  autoCapitalize = 'none',
  autoCorrect = false,
}, ref) {
  const [isFocused, setIsFocused] = useState(false);

  const handleFocus = useCallback((event) => {
    setIsFocused(true);
    onFocus?.(event);
  }, [onFocus]);

  const handleBlur = useCallback((event) => {
    setIsFocused(false);
    onBlur?.(event);
  }, [onBlur]);

  return (
    <GlassSurface
      state={isFocused ? 'active' : 'default'}
      radius="s"
      padding={0}
      highlight={false}
      style={[
        styles.shell,
        multiline && styles.multilineShell,
        isFocused && styles.shellFocused,
        !editable && styles.disabled,
        style,
      ]}
      fillColor={isFocused ? theme.colors.glass.active : theme.colors.glass.base}
      borderColor={isFocused ? theme.colors.glass.borderActive : theme.colors.glass.borderDefault}
      contentStyle={styles.shellContent}
    >
      <View style={styles.inputWrap}>
        <TextInput
          ref={ref}
          testID={testID}
          value={value}
          onChangeText={onChangeText}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={placeholder}
          placeholderTextColor={isFocused ? theme.colors.text.secondary : theme.colors.text.muted}
          selectionColor={theme.colors.accent.primary}
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          editable={editable}
          maxLength={maxLength}
          style={[
            styles.input,
            multiline && styles.multiline,
            !editable && styles.disabledText,
            inputStyle,
          ]}
          autoCapitalize={autoCapitalize}
          autoCorrect={autoCorrect}
          autoFocus={autoFocus}
          multiline={multiline}
          onSubmitEditing={onSubmitEditing}
          returnKeyType={returnKeyType}
          blurOnSubmit={blurOnSubmit}
        />
      </View>
    </GlassSurface>
  );
});

const styles = StyleSheet.create({
  shell: {
    width: '100%',
    minHeight: 52,
    marginVertical: theme.spacing[1],
  },
  shellFocused: {
    shadowColor: theme.colors.accent.primary,
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  shellContent: {
    padding: 0,
  },
  inputWrap: {
    width: '100%',
  },
  input: {
    width: '100%',
    minHeight: 52,
    color: theme.colors.text.primary,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.body1.fontSize,
    lineHeight: theme.typography.body1.lineHeight,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
  },
  multilineShell: {
    minHeight: 110,
  },
  multiline: {
    minHeight: 110,
    textAlignVertical: 'top',
  },
  disabled: {
    opacity: theme.interaction.disabledOpacity,
  },
  disabledText: {
    color: theme.colors.text.disabled,
  },
});
