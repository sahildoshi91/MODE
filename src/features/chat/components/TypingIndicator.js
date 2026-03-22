import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { theme } from '../../../../lib/theme';

export default function TypingIndicator() {
  return (
    <View style={styles.wrap}>
      <Text style={styles.text}>Coach is thinking…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'flex-start',
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radii.l,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    marginBottom: theme.spacing[2],
  },
  text: {
    color: theme.colors.textMedium,
    ...theme.typography.body2,
  },
});
