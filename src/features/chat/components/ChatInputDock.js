import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ModeText } from '../../../../lib/components';
import { GlassInputBar, GlassSurface } from '../../../../lib/components/glass';
import { theme } from '../../../../lib/theme';

export default function ChatInputDock({
  disabled = false,
  isSending = false,
  readOnly = false,
  onSend,
  onCancel,
  bottomInset = 0,
  placeholder = 'Tell your coach what you need...',
  testID = 'chat-input-dock',
}) {
  const [value, setValue] = useState('');

  const handleSend = useCallback(async () => {
    const nextMessage = value.trim();
    if (!nextMessage || disabled || readOnly) {
      return;
    }
    setValue('');
    const sent = await onSend?.(nextMessage);
    if (sent === false) {
      setValue(nextMessage);
    }
  }, [disabled, onSend, readOnly, value]);

  if (readOnly) {
    return (
      <View
        testID={`${testID}-readonly`}
        style={[
          styles.dock,
          { paddingBottom: Math.max(bottomInset, theme.spacing[2]) },
        ]}
      >
        <GlassSurface
          state="default"
          radius="l"
          blur="input"
          style={styles.readOnlySurface}
          contentStyle={styles.readOnlyContent}
          fillColor="rgba(255, 255, 255, 0.055)"
          borderColor="rgba(214, 230, 255, 0.12)"
        >
          <ModeText variant="caption" tone="secondary" style={styles.readOnlyText}>
            Archived conversation
          </ModeText>
        </GlassSurface>
      </View>
    );
  }

  return (
    <View
      testID={testID}
      style={[
        styles.dock,
        { paddingBottom: Math.max(bottomInset, theme.spacing[2]) },
      ]}
    >
      <GlassInputBar
        value={value}
        onChangeText={setValue}
        onSend={handleSend}
        onCancel={onCancel}
        isSending={isSending}
        disabled={disabled}
        placeholder={placeholder}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[2],
    backgroundColor: 'transparent',
  },
  readOnlySurface: {
    marginBottom: 0,
  },
  readOnlyContent: {
    minHeight: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  readOnlyText: {
    fontWeight: '600',
  },
});
