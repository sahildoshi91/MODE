import React from 'react';
import { StyleSheet } from 'react-native';

import { GlassInputBar } from '../../../../lib/components/glass';

export default function CoachComposer({
  value,
  onChangeText,
  onSend,
  onCancel,
  isSending = false,
  disabled = false,
  onFocus,
}) {
  return (
    <GlassInputBar
      value={value}
      onChangeText={onChangeText}
      onFocus={onFocus}
      onSend={onSend}
      onCancel={onCancel}
      isSending={isSending}
      disabled={disabled}
      style={styles.container}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 0,
  },
});
