import React from 'react';
import { TextInput, StyleSheet } from 'react-native';
import { theme } from '../theme';

export const ModeInput = ({ value, onChangeText, placeholder, secureTextEntry = false, keyboardType = 'default', editable = true, style, testID }) => {
  return (
    <TextInput
      testID={testID}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={theme.colors.textMedium}
      secureTextEntry={secureTextEntry}
      keyboardType={keyboardType}
      editable={editable}
      style={[styles.input, !editable && styles.disabled, style]}
      autoCapitalize="none"
      autoCorrect={false}
    />
  );
};

const styles = StyleSheet.create({
  input: {
    width: '100%',
    height: 50,
    borderRadius: theme.radii.s,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.bg.secondary,
    color: theme.colors.textHigh,
    fontFamily: theme.typography.fontFamily,
    fontSize: theme.typography.body1.fontSize,
    lineHeight: theme.typography.body1.lineHeight,
    paddingHorizontal: theme.spacing[2],
    marginVertical: theme.spacing[1],
  },
  disabled: {
    backgroundColor: 'rgba(26,30,42,0.65)',
    color: theme.colors.textDisabled,
    borderColor: theme.colors.border,
    opacity: 0.65,
  },
});
