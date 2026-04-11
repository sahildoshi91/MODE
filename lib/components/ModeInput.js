import React from 'react';
import { TextInput, StyleSheet } from 'react-native';

import { theme } from '../theme';

export const ModeInput = ({
  value,
  onChangeText,
  placeholder,
  secureTextEntry = false,
  keyboardType = 'default',
  editable = true,
  style,
  testID,
  multiline = false,
}) => {
  return (
    <TextInput
      testID={testID}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={theme.colors.text.tertiary}
      secureTextEntry={secureTextEntry}
      keyboardType={keyboardType}
      editable={editable}
      style={[
        styles.input,
        multiline && styles.multiline,
        !editable && styles.disabled,
        style,
      ]}
      autoCapitalize="none"
      autoCorrect={false}
      multiline={multiline}
    />
  );
};

const styles = StyleSheet.create({
  input: {
    width: '100%',
    minHeight: 52,
    borderRadius: theme.radii.s,
    borderWidth: 1,
    borderColor: theme.colors.border.soft,
    backgroundColor: theme.colors.surface.base,
    color: theme.colors.text.primary,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.body1.fontSize,
    lineHeight: theme.typography.body1.lineHeight,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    marginVertical: theme.spacing[1],
  },
  multiline: {
    minHeight: 110,
    textAlignVertical: 'top',
  },
  disabled: {
    backgroundColor: theme.colors.surface.muted,
    color: theme.colors.text.disabled,
    opacity: 0.8,
  },
});
