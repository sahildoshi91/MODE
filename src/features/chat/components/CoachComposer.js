import React from 'react';
import { StyleSheet, View } from 'react-native';

import { ModeButton, ModeInput } from '../../../../lib/components';
import { theme } from '../../../../lib/theme';

export default function CoachComposer({
  value,
  onChangeText,
  onSend,
  disabled = false,
}) {
  return (
    <View style={styles.container}>
      <ModeInput
        value={value}
        onChangeText={onChangeText}
        placeholder="Tell your coach what you need..."
        editable={!disabled}
        style={styles.input}
      />
      <ModeButton
        title={disabled ? 'Sending...' : 'Send'}
        onPress={onSend}
        disabled={disabled}
        style={styles.button}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: theme.spacing[2],
  },
  input: {
    height: 56,
    textAlignVertical: 'top',
  },
  button: {
    marginTop: theme.spacing[1],
  },
});
