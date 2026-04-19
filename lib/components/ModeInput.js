import React from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { theme } from '../theme';
import { GlassSurface } from './glass/GlassSurface';

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
    <GlassSurface
      state="default"
      radius="s"
      padding={0}
      highlight={false}
      style={[
        styles.shell,
        multiline && styles.multilineShell,
        !editable && styles.disabled,
        style,
      ]}
      contentStyle={styles.shellContent}
    >
      <View style={styles.inputWrap}>
        <TextInput
          testID={testID}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.text.muted}
          selectionColor={theme.colors.accent.primary}
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          editable={editable}
          style={[
            styles.input,
            multiline && styles.multiline,
            !editable && styles.disabledText,
          ]}
          autoCapitalize="none"
          autoCorrect={false}
          multiline={multiline}
        />
      </View>
    </GlassSurface>
  );
};

const styles = StyleSheet.create({
  shell: {
    width: '100%',
    minHeight: 52,
    marginVertical: theme.spacing[1],
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
