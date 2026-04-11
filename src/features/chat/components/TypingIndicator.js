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
    backgroundColor: theme.colors.surface.raised,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.colors.border.soft,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    marginBottom: theme.spacing[1],
  },
  text: {
    color: theme.colors.text.secondary,
    ...theme.typography.body3,
    fontFamily: theme.typography.fontFamily,
  },
});
